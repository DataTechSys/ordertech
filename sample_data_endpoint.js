// Sample data insertion endpoint for Cloud Run
// Add this to your server.js file

app.post('/admin/insert-sample-data/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    
    try {
        console.log(`Inserting sample data for tenant ${tenantId}`);
        
        // Check if tenant exists
        const tenantResult = await pool.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
        if (tenantResult.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        // Insert sample local orders (paid_orders table)
        const localOrdersSQL = `
            INSERT INTO paid_orders (
                tenant_id, basket_id, osn, cashier_name, customer_name, source, location, branch, items, total, currency, paid_at
            ) VALUES 
            ($1, 'BASKET_001', 'OSN001', 'Ahmad Ahmed', 'Walk-in Customer', 'local', 'Koobs Main Branch', 'Main',
             '[{"name": "Chicken Sandwich", "price": 2.500, "quantity": 2}, {"name": "French Fries", "price": 1.200, "quantity": 1}, {"name": "Coca Cola", "price": 0.800, "quantity": 2}]'::jsonb,
             7.800, 'KWD', NOW() - INTERVAL '2 hours'),
            ($1, 'BASKET_002', 'OSN002', 'Fatima Al-Zahra', 'Mohammed Ali', 'local', 'Koobs Main Branch', 'Main',
             '[{"name": "Beef Burger", "price": 3.200, "quantity": 1}, {"name": "Onion Rings", "price": 1.500, "quantity": 1}, {"name": "Orange Juice", "price": 1.000, "quantity": 1}]'::jsonb,
             5.700, 'KWD', NOW() - INTERVAL '1 hour'),
            ($1, 'BASKET_003', 'OSN003', 'Ahmad Ahmed', 'Sarah Hassan', 'local', 'Koobs Main Branch', 'Main',
             '[{"name": "Fish Sandwich", "price": 2.800, "quantity": 1}, {"name": "Coleslaw", "price": 1.000, "quantity": 1}, {"name": "Water", "price": 0.500, "quantity": 2}]'::jsonb,
             4.800, 'KWD', NOW() - INTERVAL '30 minutes'),
            ($1, 'BASKET_004', 'OSN004', 'Khaled Omar', 'Walk-in Customer', 'local', 'Koobs Main Branch', 'Main',
             '[{"name": "Grilled Chicken", "price": 4.500, "quantity": 1}, {"name": "Rice", "price": 1.500, "quantity": 1}, {"name": "Salad", "price": 2.000, "quantity": 1}]'::jsonb,
             8.000, 'KWD', NOW() - INTERVAL '6 hours'),
            ($1, 'BASKET_005', 'OSN005', 'Fatima Al-Zahra', 'Ali Mohammed', 'local', 'Koobs Main Branch', 'Main',
             '[{"name": "Pizza Slice", "price": 2.200, "quantity": 3}, {"name": "Pepsi", "price": 0.800, "quantity": 2}]'::jsonb,
             8.200, 'KWD', NOW() - INTERVAL '4 hours')
            ON CONFLICT DO NOTHING
        `;
        
        await pool.query(localOrdersSQL, [tenantId, tenantId, tenantId, tenantId, tenantId]);
        
        // Insert sample customers
        const customersSQL = `
            INSERT INTO customers (tenant_id, external_id, full_name, first_name, last_name, phone, email) VALUES 
            ($1, 'CUST_001', 'Ahmed Al-Rashid', 'Ahmed', 'Al-Rashid', '+96599123456', 'ahmed@example.com'),
            ($1, 'CUST_002', 'Nour Al-Sabah', 'Nour', 'Al-Sabah', '+96599789012', 'nour@example.com'),
            ($1, 'CUST_003', 'Salem Al-Ahmad', 'Salem', 'Al-Ahmad', '+96599345678', 'salem@example.com')
            ON CONFLICT (tenant_id, external_id) DO NOTHING
        `;
        
        await pool.query(customersSQL, [tenantId, tenantId, tenantId]);
        
        // Get customer IDs for references
        const customers = await pool.query('SELECT customer_id, external_id FROM customers WHERE tenant_id = $1', [tenantId]);
        const customerMap = {};
        customers.rows.forEach(c => customerMap[c.external_id] = c.customer_id);
        
        // Insert sample Foodics orders
        const foodicsOrdersSQL = `
            INSERT INTO sales_orders (
                tenant_id, external_id, external_ref, currency, status, source_channel, service_type, 
                order_no, receipt_no, subtotal, tax_total, total, paid_total, 
                placed_at, paid_at, closed_at, pos_created_at, pos_updated_at, customer_id
            ) VALUES 
            ($1, 'FDX_001', 'REF_001', 'KWD', 'closed', 'online', 'delivery', 'ORD-001', 'RCP-001',
             12.500, 1.250, 13.750, 13.750, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours 50 minutes',
             NOW() - INTERVAL '2 hours 30 minutes', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours 30 minutes', $2),
            ($1, 'FDX_002', 'REF_002', 'KWD', 'closed', 'dine_in', 'dine_in', 'ORD-002', 'RCP-002',
             8.500, 0.850, 9.350, 9.350, NOW() - INTERVAL '1 hour 30 minutes', NOW() - INTERVAL '1 hour 20 minutes',
             NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour 30 minutes', NOW() - INTERVAL '1 hour', $3),
            ($1, 'FDX_003', 'REF_003', 'KWD', 'closed', 'takeaway', 'takeaway', 'ORD-003', 'RCP-003',
             15.200, 1.520, 16.720, 16.720, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours 45 minutes',
             NOW() - INTERVAL '4 hours 30 minutes', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours 30 minutes', $4),
            ($1, 'FDX_004', 'REF_004', 'KWD', 'paid', 'online', 'delivery', 'ORD-004', 'RCP-004',
             22.800, 2.280, 25.080, 25.080, NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '30 minutes',
             NULL, NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '30 minutes', $2),
            ($1, 'FDX_005', 'REF_005', 'KWD', 'closed', 'dine_in', 'dine_in', 'ORD-005', 'RCP-005',
             6.750, 0.675, 7.425, 7.425, NOW() - INTERVAL '7 hours', NOW() - INTERVAL '6 hours 50 minutes',
             NOW() - INTERVAL '6 hours 30 minutes', NOW() - INTERVAL '7 hours', NOW() - INTERVAL '6 hours 30 minutes', $3)
            ON CONFLICT (tenant_id, external_id) DO NOTHING
        `;
        
        await pool.query(foodicsOrdersSQL, [
            tenantId, customerMap['CUST_001'], customerMap['CUST_002'], 
            customerMap['CUST_003'], tenantId
        ]);
        
        // Insert sample order items and payments for a few orders
        const orders = await pool.query('SELECT order_id, external_id FROM sales_orders WHERE tenant_id = $1', [tenantId]);
        const orderMap = {};
        orders.rows.forEach(o => orderMap[o.external_id] = o.order_id);
        
        if (orderMap['FDX_001']) {
            await pool.query(`
                INSERT INTO sales_order_items (tenant_id, order_id, external_id, line_no, product_name, product_ref, sku, qty, unit_price, base_price, tax_total, total) VALUES 
                ($1, $2, 'ITEM_001_001', 1, 'Chicken Shawarma', 'PROD_SHWR_CHK', 'CHK-SHWR-001', 2, 3.500, 3.500, 0.700, 7.700),
                ($1, $2, 'ITEM_001_002', 2, 'Hummus', 'PROD_HUMMUS', 'HUMMUS-001', 1, 2.000, 2.000, 0.200, 2.200),
                ($1, $2, 'ITEM_001_003', 3, 'Arabic Bread', 'PROD_BREAD_AR', 'BREAD-AR-001', 2, 1.250, 1.250, 0.250, 2.750)
                ON CONFLICT (tenant_id, order_id, external_id) DO NOTHING
            `, [tenantId, orderMap['FDX_001']]);
            
            await pool.query(`
                INSERT INTO sales_payments (tenant_id, order_id, external_id, method, provider, reference, amount, currency, paid_at) VALUES 
                ($1, $2, 'PAY_001', 'card', 'knet', 'KNET123456', 13.750, 'KWD', NOW() - INTERVAL '2 hours 50 minutes')
                ON CONFLICT (tenant_id, external_id) DO NOTHING
            `, [tenantId, orderMap['FDX_001']]);
        }
        
        // Get summary stats
        const localOrdersResult = await pool.query('SELECT COUNT(*) as count, SUM(total) as total_amount FROM paid_orders WHERE tenant_id = $1', [tenantId]);
        const foodicsOrdersResult = await pool.query('SELECT COUNT(*) as count, SUM(total) as total_amount FROM sales_orders WHERE tenant_id = $1', [tenantId]);
        const itemsResult = await pool.query('SELECT COUNT(*) as count FROM sales_order_items WHERE tenant_id = $1', [tenantId]);
        
        res.json({
            success: true,
            message: 'Sample data inserted successfully',
            data: {
                tenant: tenantResult.rows[0].name || 'N/A',
                localOrders: {
                    count: parseInt(localOrdersResult.rows[0].count),
                    totalAmount: parseFloat(localOrdersResult.rows[0].total_amount || 0)
                },
                foodicsOrders: {
                    count: parseInt(foodicsOrdersResult.rows[0].count),
                    totalAmount: parseFloat(foodicsOrdersResult.rows[0].total_amount || 0)
                },
                orderItems: parseInt(itemsResult.rows[0].count)
            }
        });
        
    } catch (error) {
        console.error('Error inserting sample data:', error);
        res.status(500).json({ 
            error: 'Failed to insert sample data', 
            details: error.message 
        });
    }
});