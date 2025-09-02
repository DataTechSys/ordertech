-- Preview impact of deleting categories "Coffee" and "Cold drinks" and their dependent data
-- Tenant scope: default Koobs Café
-- TENANT_ID: 3feff9a3-4721-4ff2-a716-11eb93873fae

-- List the categories (id, name)
SELECT id, name
FROM categories
WHERE tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND lower(name) IN ('coffee','cold drinks')
ORDER BY name;

-- Count products in those categories
SELECT COUNT(*) AS products_to_delete
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND c.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND lower(c.name) IN ('coffee','cold drinks');

-- Count order_items that reference those products
SELECT COUNT(*) AS order_items_to_delete
FROM order_items oi
JOIN products p ON p.id = oi.product_id
JOIN categories c ON c.id = p.category_id
WHERE p.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND c.tenant_id = '3feff9a3-4721-4ff2-a716-11eb93873fae'
  AND lower(c.name) IN ('coffee','cold drinks');

