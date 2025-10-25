-- SQL script to manually link Koobs products to modifier groups
-- This is a workaround since Foodics sync is timing out

-- Koobs tenant ID
-- f8578f9c-782b-4d31-b04f-3b2d890c5896

-- First, let's see what we're working with
SELECT 'Products count:' AS info, COUNT(*) AS count 
FROM products 
WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

SELECT 'Modifier groups count:' AS info, COUNT(*) AS count 
FROM modifier_groups 
WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

SELECT 'Current product-modifier links:' AS info, COUNT(*) AS count 
FROM product_modifier_groups pmg
JOIN modifier_groups mg ON mg.id = pmg.group_id
WHERE mg.tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

-- Let's see the available modifier groups
SELECT name, reference, id 
FROM modifier_groups 
WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
ORDER BY name;

-- Let's see some sample products  
SELECT id, name, sku 
FROM products 
WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
LIMIT 5;

-- Strategy: Link all coffee/drink products to basic modifier groups
-- We'll identify key groups and link them to all products

WITH key_groups AS (
  SELECT id, name, reference
  FROM modifier_groups 
  WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
  AND name IN (
    'Coffee | Shots',    -- For coffee strength
    'Cups',             -- For cup size/type  
    'Extra',            -- For add-ons
    'Hot Milk'          -- For milk options
  )
),
sample_products AS (
  SELECT id, name, sku
  FROM products 
  WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
  LIMIT 3  -- Start with just 3 products for testing
)
-- Insert product-modifier relationships
INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
SELECT 
  p.id AS product_id,
  g.id AS group_id,
  CASE g.name
    WHEN 'Coffee | Shots' THEN 1
    WHEN 'Hot Milk' THEN 2  
    WHEN 'Cups' THEN 3
    WHEN 'Extra' THEN 4
  END AS sort_order,
  CASE g.name
    WHEN 'Coffee | Shots' THEN true
    ELSE false
  END AS required,
  CASE g.name
    WHEN 'Coffee | Shots' THEN 1
    ELSE 0
  END AS min_select,
  CASE g.name
    WHEN 'Extra' THEN 10
    ELSE 1
  END AS max_select
FROM sample_products p
CROSS JOIN key_groups g
ON CONFLICT (product_id, group_id) DO UPDATE SET
  sort_order = EXCLUDED.sort_order,
  required = EXCLUDED.required,
  min_select = EXCLUDED.min_select,
  max_select = EXCLUDED.max_select;

-- Verify the results
SELECT 'Links created:' AS info, COUNT(*) AS count 
FROM product_modifier_groups pmg
JOIN modifier_groups mg ON mg.id = pmg.group_id
WHERE mg.tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

-- Show a sample of what was created
SELECT 
  p.name AS product_name,
  p.sku AS product_sku,
  mg.name AS modifier_group,
  pmg.sort_order,
  pmg.required,
  pmg.min_select,
  pmg.max_select
FROM product_modifier_groups pmg
JOIN products p ON p.id = pmg.product_id
JOIN modifier_groups mg ON mg.id = pmg.group_id
WHERE mg.tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
ORDER BY p.name, pmg.sort_order
LIMIT 20;