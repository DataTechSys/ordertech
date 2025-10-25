#!/usr/bin/env node

// scripts/test_foodics_integration.js
// Test script to verify Foodics integration and show sample data

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Configuration
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, '../ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
    FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

if (!FOODICS_TOKEN) {
    console.error('❌ Foodics token not found. Set FOODICS_TOKEN env var or ensure ios/foodics_token.txt exists');
    process.exit(1);
}

// Database connection
function createDbPool() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('❌ DATABASE_URL environment variable not set');
        process.exit(1);
    }
    
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: false
    });
    
    return pool;
}

// Database helper
async function db(pool, sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows;
    } finally {
        client.release();
    }
}

// Test database schema
async function testDatabaseSchema(pool) {
    console.log('📋 Testing database schema...');
    
    const tables = [
        'sales_orders',
        'sales_order_items', 
        'sales_order_payments',
        'customers',
        'external_mappings',
        'integration_sync_runs',
        'integration_cursors'
    ];
    
    for (const table of tables) {
        try {
            const [result] = await db(pool, `SELECT count(*) as count FROM ${table} LIMIT 1`);
            console.log(`  ✅ ${table}: ${result.count} records`);
        } catch (error) {
            console.log(`  ❌ ${table}: ${error.message}`);
        }
    }
}

// Test Foodics API connectivity
async function testFoodicsAPI() {
    console.log('\n🌐 Testing Foodics API connectivity...');
    
    try {
        const { makeClient } = require('../server/integrations/foodics.js');
        const client = makeClient(FOODICS_TOKEN);
        
        // Test simple API call
        const result = await client.listOrders({ limit: 1 });
        console.log('  ✅ API connection successful');
        console.log(`  📊 Found ${result.items?.length || 0} sample orders`);
        
        if (result.items && result.items.length > 0) {
            const order = result.items[0];
            console.log(`  📝 Sample order: ${order.id} - ${order.status} - ${order.total} ${order.currency}`);
        }
        
        return true;
    } catch (error) {
        console.log(`  ❌ API connection failed: ${error.message}`);
        return false;
    }
}

// Show current sync status
async function showSyncStatus(pool, tenantId) {
    console.log('\n📈 Current sync status...');
    
    try {
        // Check sync runs
        const syncRuns = await db(pool, `
            SELECT provider, started_at, finished_at, ok, 
                   stats->>'processed' as processed,
                   stats->>'errors' as errors
            FROM integration_sync_runs 
            WHERE provider LIKE 'foodics%' 
            ORDER BY started_at DESC 
            LIMIT 5
        `);
        
        if (syncRuns.length > 0) {
            console.log('  📋 Recent sync runs:');
            syncRuns.forEach(run => {
                const status = run.ok ? '✅' : (run.ok === false ? '❌' : '🔄');
                const processed = run.processed || '0';
                const errors = run.errors || '0';
                console.log(`    ${status} ${run.provider}: ${processed} processed, ${errors} errors (${run.started_at})`);
            });
        } else {
            console.log('  ℹ️  No sync runs found');
        }
        
        // Check cursor position
        const cursors = await db(pool, `
            SELECT provider, cursor_value, updated_at
            FROM integration_cursors 
            WHERE tenant_id = $1 AND provider LIKE 'foodics%'
        `, [tenantId]);
        
        if (cursors.length > 0) {
            console.log('  🎯 Sync cursors:');
            cursors.forEach(cursor => {
                console.log(`    ${cursor.provider}: ${cursor.cursor_value} (${cursor.updated_at})`);
            });
        } else {
            console.log('  ℹ️  No sync cursors found');
        }
        
    } catch (error) {
        console.log(`  ❌ Error checking sync status: ${error.message}`);
    }
}

// Show sample imported data
async function showSampleData(pool, tenantId) {
    console.log('\n📊 Sample imported data...');
    
    try {
        // Show customer count
        const [customerCount] = await db(pool, 'SELECT count(*) as count FROM customers WHERE tenant_id = $1', [tenantId]);
        console.log(`  👥 Customers: ${customerCount.count}`);
        
        // Show orders count
        const [ordersCount] = await db(pool, 'SELECT count(*) as count FROM sales_orders WHERE tenant_id = $1', [tenantId]);
        console.log(`  📦 Sales Orders: ${ordersCount.count}`);
        
        // Show recent orders
        const recentOrders = await db(pool, `
            SELECT 
                so.external_id,
                so.status,
                so.total,
                so.currency,
                so.created_at,
                c.name as customer_name,
                c.phone as customer_phone
            FROM sales_orders so
            LEFT JOIN customers c ON so.customer_id = c.id
            WHERE so.tenant_id = $1
            ORDER BY so.created_at DESC
            LIMIT 5
        `, [tenantId]);
        
        if (recentOrders.length > 0) {
            console.log('  📋 Recent orders:');
            recentOrders.forEach(order => {
                const customer = order.customer_name ? `(${order.customer_name})` : '';
                console.log(`    ${order.external_id}: ${order.status} - ${order.total} ${order.currency} ${customer}`);
            });
        } else {
            console.log('  ℹ️  No orders found');
        }
        
        // Show order items count
        const [itemsCount] = await db(pool, 'SELECT count(*) as count FROM sales_order_items soi JOIN sales_orders so ON soi.order_id = so.id WHERE so.tenant_id = $1', [tenantId]);
        console.log(`  🛍️  Order Items: ${itemsCount.count}`);
        
        // Show payments count  
        const [paymentsCount] = await db(pool, 'SELECT count(*) as count FROM sales_order_payments sop JOIN sales_orders so ON sop.order_id = so.id WHERE so.tenant_id = $1', [tenantId]);
        console.log(`  💳 Payments: ${paymentsCount.count}`);
        
    } catch (error) {
        console.log(`  ❌ Error showing sample data: ${error.message}`);
    }
}

// Test manual sync trigger
async function testManualSync(tenantId) {
    console.log('\n🚀 Testing manual sync trigger...');
    
    try {
        const response = await fetch(`http://localhost:8080/admin/tenants/${tenantId}/integrations/foodics/sync-sales`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Note: In production, you'd need proper authentication headers
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('  ✅ Manual sync triggered successfully');
            console.log(`  📋 Run ID: ${result.runId || 'N/A'}`);
        } else {
            console.log(`  ❌ Manual sync failed: ${response.status} ${response.statusText}`);
        }
        
    } catch (error) {
        console.log(`  ❌ Error testing manual sync: ${error.message}`);
        console.log('  ℹ️  Make sure server is running on localhost:8080');
    }
}

// Main test function
async function runTests() {
    const tenantId = process.argv[2] || DEFAULT_TENANT_ID;
    
    console.log('🧪 Foodics Integration Test Suite\n');
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Foodics Token: ${FOODICS_TOKEN ? '[PRESENT]' : '[MISSING]'}\n`);
    
    const pool = createDbPool();
    
    try {
        // Run tests
        await testDatabaseSchema(pool);
        await testFoodicsAPI();
        await showSyncStatus(pool, tenantId);
        await showSampleData(pool, tenantId);
        await testManualSync(tenantId);
        
        console.log('\n🎉 Test suite completed!');
        
        console.log('\n📝 Next Steps:');
        console.log('  1. If no data: Run historical backfill with --dry-run first');
        console.log('  2. Check admin interface at /admin/tenant-orders or create new Foodics view');
        console.log('  3. Set up Cloud Scheduler for continuous sync');
        console.log('  4. Monitor sync status via admin APIs');
        
    } catch (error) {
        console.error('\n💥 Test suite failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the tests
if (require.main === module) {
    runTests().catch(error => {
        console.error('💥 Critical error:', error);
        process.exit(1);
    });
}

module.exports = { runTests };