#!/usr/bin/env node

// check_orders_data.js
// Check orders data for Koobs tenant

const { Pool } = require('pg');

const KOOBS_TENANT_ID = '494675';

// Create database connection using same method as server
async function checkOrdersData() {
    console.log('🔍 Checking Orders Data for Koobs Tenant\n');
    console.log(`Tenant ID: ${KOOBS_TENANT_ID}\n`);
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgres://ordertech:Ordertech.2020@/ordertech?host=/cloudsql/smart-order-469705:me-central1:ordertech-db',
        ssl: false
    });
    
    try {
        // Test connection
        await pool.query('SELECT 1');
        console.log('✅ Database connection successful\n');
        
        // Check tenant exists
        console.log('📋 Checking tenant...');
        const tenantResult = await pool.query('SELECT * FROM tenants WHERE id = $1', [KOOBS_TENANT_ID]);
        if (tenantResult.rows.length > 0) {
            const tenant = tenantResult.rows[0];
            console.log(`  ✅ Tenant found: ${tenant.name || 'N/A'} (${tenant.id})`);
        } else {
            console.log(`  ❌ Tenant ${KOOBS_TENANT_ID} not found`);
            return;
        }
        
        // Check orders table structure
        console.log('\n🗂️  Orders table structure:');
        const columnsResult = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'orders' 
            ORDER BY ordinal_position
        `);
        
        if (columnsResult.rows.length > 0) {
            columnsResult.rows.forEach(col => {
                console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
            });
        } else {
            console.log('  ❌ Orders table not found');
            return;
        }
        
        // Check existing orders for Koobs
        console.log('\n📊 Checking orders data...');
        const ordersCount = await pool.query('SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1', [KOOBS_TENANT_ID]);
        console.log(`  Total orders: ${ordersCount.rows[0].count}`);
        
        if (ordersCount.rows[0].count > 0) {
            // Sample orders
            const sampleOrders = await pool.query(`
                SELECT id, source, status, total_amount, created_at, updated_at
                FROM orders 
                WHERE tenant_id = $1 
                ORDER BY created_at DESC 
                LIMIT 5
            `, [KOOBS_TENANT_ID]);
            
            console.log('\n📝 Recent orders:');
            sampleOrders.rows.forEach(order => {
                console.log(`  - ID: ${order.id}, Source: ${order.source}, Status: ${order.status}, Total: ${order.total_amount}, Date: ${order.created_at}`);
            });
            
            // Orders by source
            const sourceStats = await pool.query(`
                SELECT source, COUNT(*) as count, SUM(total_amount) as total_amount
                FROM orders 
                WHERE tenant_id = $1 
                GROUP BY source 
                ORDER BY count DESC
            `, [KOOBS_TENANT_ID]);
            
            console.log('\n📈 Orders by source:');
            sourceStats.rows.forEach(stat => {
                console.log(`  - ${stat.source}: ${stat.count} orders, Total: ${stat.total_amount}`);
            });
        }
        
        // Check if there are any other order-related tables
        console.log('\n🔍 Checking other order tables...');
        const orderTables = [
            'sales_orders',
            'paid_orders',
            'order_items',
            'sales_order_items'
        ];
        
        for (const tableName of orderTables) {
            try {
                const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName} WHERE tenant_id = $1`, [KOOBS_TENANT_ID]);
                console.log(`  ${tableName}: ${result.rows[0].count} records`);
            } catch (error) {
                console.log(`  ${tableName}: Table not found or error (${error.message})`);
            }
        }
        
        console.log('\n✅ Orders data check complete');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

// Run the check
if (require.main === module) {
    checkOrdersData().catch(console.error);
}

module.exports = { checkOrdersData };