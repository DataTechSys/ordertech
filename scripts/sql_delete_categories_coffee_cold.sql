-- Delete categories "Coffee" and "Cold drinks" and all dependent products and order items
-- TENANT_ID: 3feff9a3-4721-4ff2-a716-11eb93873fae

-- 1) Delete order_items for products in the target categories
DELETE FROM order_items oi
USING products p, categories c
WHERE oi.product_id = p.id
  AND p.category_id = c.id
  AND p.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND c.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND lower(c.name) IN ('coffee','cold drinks');

-- 2) Delete products in those categories
DELETE FROM products p
USING categories c
WHERE p.category_id = c.id
  AND p.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND c.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND lower(c.name) IN ('coffee','cold drinks');

-- 3) Delete the categories themselves
DELETE FROM categories c
WHERE c.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND lower(c.name) IN ('coffee','cold drinks');

