-- create_sample_orders.sql
-- Create sample orders data for Koobs tenant (494675)

BEGIN;

-- First verify the tenant exists
SELECT 'Checking tenant 494675' as status;
SELECT id, name FROM tenants WHERE id = '494675';

-- Insert sample paid_orders (local orders)
INSERT INTO paid_orders (
    tenant_id,
    basket_id,
    osn,
    cashier_name,
    customer_name,
    source,
    location,
    branch,
    items,
    total,
    currency,
    paid_at
) VALUES 
(
    '494675',
    'BASKET_001',
    'OSN001',
    'Ahmad Ahmed',
    'Walk-in Customer',
    'local',
    'Koobs Main Branch',
    'Main',
    '[
        {"name": "Chicken Sandwich", "price": 2.500, "quantity": 2},
        {"name": "French Fries", "price": 1.200, "quantity": 1},
        {"name": "Coca Cola", "price": 0.800, "quantity": 2}
    ]'::jsonb,
    7.800,
    'KWD',
    NOW() - INTERVAL '2 hours'
),
(
    '494675',
    'BASKET_002',
    'OSN002',
    'Fatima Al-Zahra',
    'Mohammed Ali',
    'local',
    'Koobs Main Branch',
    'Main',
    '[
        {"name": "Beef Burger", "price": 3.200, "quantity": 1},
        {"name": "Onion Rings", "price": 1.500, "quantity": 1},
        {"name": "Orange Juice", "price": 1.000, "quantity": 1}
    ]'::jsonb,
    5.700,
    'KWD',
    NOW() - INTERVAL '1 hour'
),
(
    '494675',
    'BASKET_003',
    'OSN003',
    'Ahmad Ahmed',
    'Sarah Hassan',
    'local',
    'Koobs Main Branch',
    'Main',
    '[
        {"name": "Fish Sandwich", "price": 2.800, "quantity": 1},
        {"name": "Coleslaw", "price": 1.000, "quantity": 1},
        {"name": "Water", "price": 0.500, "quantity": 2}
    ]'::jsonb,
    4.800,
    'KWD',
    NOW() - INTERVAL '30 minutes'
),
(
    '494675',
    'BASKET_004',
    'OSN004',
    'Khaled Omar',
    'Walk-in Customer',
    'local',
    'Koobs Main Branch',
    'Main',
    '[
        {"name": "Grilled Chicken", "price": 4.500, "quantity": 1},
        {"name": "Rice", "price": 1.500, "quantity": 1},
        {"name": "Salad", "price": 2.000, "quantity": 1}
    ]'::jsonb,
    8.000,
    'KWD',
    NOW() - INTERVAL '6 hours'
),
(
    '494675',
    'BASKET_005',
    'OSN005',
    'Fatima Al-Zahra',
    'Ali Mohammed',
    'local',
    'Koobs Main Branch',
    'Main',
    '[
        {"name": "Pizza Slice", "price": 2.200, "quantity": 3},
        {"name": "Pepsi", "price": 0.800, "quantity": 2}
    ]'::jsonb,
    8.200,
    'KWD',
    NOW() - INTERVAL '4 hours'
);

-- Insert sample customers for Foodics orders
INSERT INTO customers (
    tenant_id,
    external_id,
    full_name,
    first_name,
    last_name,
    phone,
    email
) VALUES 
(
    '494675',
    'CUST_001',
    'Ahmed Al-Rashid',
    'Ahmed',
    'Al-Rashid',
    '+96599123456',
    'ahmed@example.com'
),
(
    '494675',
    'CUST_002',
    'Nour Al-Sabah',
    'Nour',
    'Al-Sabah',
    '+96599789012',
    'nour@example.com'
),
(
    '494675',
    'CUST_003',
    'Salem Al-Ahmad',
    'Salem',
    'Al-Ahmad',
    '+96599345678',
    'salem@example.com'
) ON CONFLICT (tenant_id, external_id) DO NOTHING;

-- Insert sample sales_orders (Foodics orders)
INSERT INTO sales_orders (
    tenant_id,
    external_id,
    external_ref,
    currency,
    status,
    source_channel,
    service_type,
    order_no,
    receipt_no,
    subtotal,
    tax_total,
    total,
    paid_total,
    placed_at,
    paid_at,
    closed_at,
    pos_created_at,
    pos_updated_at,
    customer_id
) VALUES 
(
    '494675',
    'FDX_001',
    'REF_001',
    'KWD',
    'closed',
    'online',
    'delivery',
    'ORD-001',
    'RCP-001',
    12.500,
    1.250,
    13.750,
    13.750,
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '2 hours 50 minutes',
    NOW() - INTERVAL '2 hours 30 minutes',
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '2 hours 30 minutes',
    (SELECT customer_id FROM customers WHERE tenant_id = '494675' AND external_id = 'CUST_001')
),
(
    '494675',
    'FDX_002',
    'REF_002',
    'KWD',
    'closed',
    'dine_in',
    'dine_in',
    'ORD-002',
    'RCP-002',
    8.500,
    0.850,
    9.350,
    9.350,
    NOW() - INTERVAL '1 hour 30 minutes',
    NOW() - INTERVAL '1 hour 20 minutes',
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '1 hour 30 minutes',
    NOW() - INTERVAL '1 hour',
    (SELECT customer_id FROM customers WHERE tenant_id = '494675' AND external_id = 'CUST_002')
),
(
    '494675',
    'FDX_003',
    'REF_003',
    'KWD',
    'closed',
    'takeaway',
    'takeaway',
    'ORD-003',
    'RCP-003',
    15.200,
    1.520,
    16.720,
    16.720,
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '4 hours 45 minutes',
    NOW() - INTERVAL '4 hours 30 minutes',
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '4 hours 30 minutes',
    (SELECT customer_id FROM customers WHERE tenant_id = '494675' AND external_id = 'CUST_003')
),
(
    '494675',
    'FDX_004',
    'REF_004',
    'KWD',
    'paid',
    'online',
    'delivery',
    'ORD-004',
    'RCP-004',
    22.800,
    2.280,
    25.080,
    25.080,
    NOW() - INTERVAL '45 minutes',
    NOW() - INTERVAL '30 minutes',
    NULL,
    NOW() - INTERVAL '45 minutes',
    NOW() - INTERVAL '30 minutes',
    (SELECT customer_id FROM customers WHERE tenant_id = '494675' AND external_id = 'CUST_001')
),
(
    '494675',
    'FDX_005',
    'REF_005',
    'KWD',
    'closed',
    'dine_in',
    'dine_in',
    'ORD-005',
    'RCP-005',
    6.750,
    0.675,
    7.425,
    7.425,
    NOW() - INTERVAL '7 hours',
    NOW() - INTERVAL '6 hours 50 minutes',
    NOW() - INTERVAL '6 hours 30 minutes',
    NOW() - INTERVAL '7 hours',
    NOW() - INTERVAL '6 hours 30 minutes',
    (SELECT customer_id FROM customers WHERE tenant_id = '494675' AND external_id = 'CUST_002')
);

-- Insert sample sales_order_items for the Foodics orders
INSERT INTO sales_order_items (
    tenant_id,
    order_id,
    external_id,
    line_no,
    product_name,
    product_ref,
    sku,
    qty,
    unit_price,
    base_price,
    tax_total,
    total
) VALUES 
-- Items for FDX_001
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_001'),
    'ITEM_001_001',
    1,
    'Chicken Shawarma',
    'PROD_SHWR_CHK',
    'CHK-SHWR-001',
    2,
    3.500,
    3.500,
    0.700,
    7.700
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_001'),
    'ITEM_001_002',
    2,
    'Hummus',
    'PROD_HUMMUS',
    'HUMMUS-001',
    1,
    2.000,
    2.000,
    0.200,
    2.200
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_001'),
    'ITEM_001_003',
    3,
    'Arabic Bread',
    'PROD_BREAD_AR',
    'BREAD-AR-001',
    2,
    1.250,
    1.250,
    0.250,
    2.750
),

-- Items for FDX_002  
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_002'),
    'ITEM_002_001',
    1,
    'Falafel Plate',
    'PROD_FALAFEL',
    'FALAFEL-001',
    1,
    4.500,
    4.500,
    0.450,
    4.950
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_002'),
    'ITEM_002_002',
    2,
    'Tabbouleh Salad',
    'PROD_TABBOULEH',
    'TABBOULEH-001',
    1,
    3.000,
    3.000,
    0.300,
    3.300
),

-- Items for FDX_003
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_003'),
    'ITEM_003_001',
    1,
    'Mixed Grill',
    'PROD_MIXED_GRILL',
    'GRILL-MIX-001',
    1,
    12.000,
    12.000,
    1.200,
    13.200
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_003'),
    'ITEM_003_002',
    2,
    'Garlic Sauce',
    'PROD_GARLIC',
    'GARLIC-001',
    2,
    0.800,
    0.800,
    0.160,
    1.760
);

-- Insert sample sales_payments for Foodics orders
INSERT INTO sales_payments (
    tenant_id,
    order_id,
    external_id,
    method,
    provider,
    reference,
    amount,
    currency,
    paid_at
) VALUES 
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_001'),
    'PAY_001',
    'card',
    'knet',
    'KNET123456',
    13.750,
    'KWD',
    NOW() - INTERVAL '2 hours 50 minutes'
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_002'),
    'PAY_002',
    'cash',
    'cash',
    'CASH001',
    9.350,
    'KWD',
    NOW() - INTERVAL '1 hour 20 minutes'
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_003'),
    'PAY_003',
    'card',
    'visa',
    'VISA789012',
    16.720,
    'KWD',
    NOW() - INTERVAL '4 hours 45 minutes'
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_004'),
    'PAY_004',
    'online',
    'tap_payments',
    'TAP345678',
    25.080,
    'KWD',
    NOW() - INTERVAL '30 minutes'
),
(
    '494675',
    (SELECT order_id FROM sales_orders WHERE external_id = 'FDX_005'),
    'PAY_005',
    'cash',
    'cash',
    'CASH002',
    7.425,
    'KWD',
    NOW() - INTERVAL '6 hours 50 minutes'
);

-- Verify the data was created
SELECT 'Sample data created successfully!' as result;

SELECT 'Local Orders (paid_orders):' as info, COUNT(*) as count, SUM(total) as total_amount 
FROM paid_orders WHERE tenant_id = '494675';

SELECT 'Foodics Orders (sales_orders):' as info, COUNT(*) as count, SUM(total) as total_amount 
FROM sales_orders WHERE tenant_id = '494675';

SELECT 'Foodics Order Items:' as info, COUNT(*) as count, SUM(total) as total_amount 
FROM sales_order_items WHERE tenant_id = '494675';

SELECT 'Foodics Payments:' as info, COUNT(*) as count, SUM(amount) as total_amount 
FROM sales_payments WHERE tenant_id = '494675';

COMMIT;