#!/usr/bin/env node

// scripts/test_koobs_foodics.js
// Test script for Koobs tenant Foodics integration

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Configuration for Koobs
const KOOBS_TENANT_ID = '494675';  // Koobs tenant ID

// Load Foodics token from file
const FOODICS_TOKEN_PATH = path.join(__dirname, '../ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
    FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

if (!FOODICS_TOKEN) {
    console.error('❌ Foodics token not found. Set FOODICS_TOKEN env var or ensure ios/foodics_token.txt exists');
    process.exit(1);
}

// Database connection using local proxy
function createDbPool() {
    const dbPassword = process.env.DB_PASSWORD;
    if (!dbPassword) {
        console.error('❌ DB_PASSWORD environment variable not set');
        console.log('Usage: DB_PASSWORD=your_db_password node scripts/test_koobs_foodics.js');
        process.exit(1);
    }
    
    const pool = new Pool({
        connectionString: `postgresql://ordertech:${dbPassword}@localhost:6555/ordertech`,
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

// Test Foodics API
async function testFoodicsAPI() {
    console.log('🌐 Testing Foodics API for Koobs...');
    
    try {
        const { makeClient } = require('../server/integrations/foodics.js');
        const client = makeClient(FOODICS_TOKEN);
        
        // Test orders endpoint with recent date range
        const result = await client.listOrders({ 
            limit: 5,
            updated_at_from: '2024-10-15T00:00:00Z'
        });
        
        console.log('  ✅ API connection successful');
        console.log(`  📊 Found ${result.items?.length || 0} recent orders`);
        
        if (result.items && result.items.length > 0) {
            result.items.forEach((order, i) => {
                console.log(`  📝 Order ${i+1}: ${order.id} - ${order.status} - ${order.total} ${order.currency} - ${order.created_at}`);
            });
        }
        
        return result.items || [];
    } catch (error) {
        console.log(`  ❌ API connection failed: ${error.message}`);
        return [];
    }
}

// Check database status for Koobs tenant
async function checkDatabaseStatus(pool) {
    console.log('\n📋 Checking database status for Koobs tenant...');
    
    try {
        // Check if tenant exists
        const [tenant] = await db(pool, 'SELECT name FROM tenants WHERE code = $1 OR tenant_id::text = $1', [KOOBS_TENANT_ID]);
        if (tenant) {
            console.log(`  ✅ Found tenant: ${tenant.name}`);
        } else {
            console.log(`  ⚠️  Tenant ${KOOBS_TENANT_ID} not found in database`);
        }
        
        // Check Foodics integration tables
        const tables = [
            'sales_orders',
            'customers',
            'sales_order_items',
            'sales_order_payments'
        ];
        
        for (const table of tables) {
            try {
                const [result] = await db(pool, `SELECT count(*) as count FROM ${table} WHERE tenant_id = $1`, [KOOBS_TENANT_ID]);
                console.log(`  📊 ${table}: ${result.count} records`);
            } catch (error) {
                console.log(`  ❌ ${table}: ${error.message}`);
            }
        }
        
        // Check existing paid orders for comparison
        const [paidOrders] = await db(pool, `SELECT count(*) as count FROM paid_orders WHERE tenant_id = $1`, [KOOBS_TENANT_ID]);
        console.log(`  💰 paid_orders: ${paidOrders.count} records`);
        
    } catch (error) {
        console.error('  ❌ Database check failed:', error.message);
    }
}

// Main test function
async function runKoobsTest() {
    console.log('🧪 Koobs Foodics Integration Test\n');
    console.log(`Tenant ID: ${KOOBS_TENANT_ID}`);
    console.log(`Foodics Token: ${FOODICS_TOKEN ? '[PRESENT]' : '[MISSING]'}\n`);
    
    const pool = createDbPool();
    
    try {
        // Test API connectivity
        const sampleOrders = await testFoodicsAPI();
        
        // Check database status
        await checkDatabaseStatus(pool);
        
        console.log('\n🎯 Test Results Summary:');
        
        if (sampleOrders.length > 0) {
            console.log(`  ✅ Foodics API is working with ${sampleOrders.length} sample orders`);
            console.log('  📈 Ready to import data');
        } else {
            console.log('  ⚠️  No recent orders found or API issues');
        }
        
        console.log('\n📝 Next Steps:');
        console.log('  1. Open the admin interface:');
        console.log(`     https://ordertech-715493130630.me-central1.run.app/admin/unified-orders?id=${KOOBS_TENANT_ID}`);
        console.log('  2. Try importing some test data:');
        console.log(`     DB_PASSWORD=your_password node scripts/import_foodics_sales_backfill.js --tenant ${KOOBS_TENANT_ID} --from 2024-10-15 --dry-run`);
        
    } catch (error) {
        console.error('\n💥 Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the test
if (require.main === module) {
    runKoobsTest().catch(error => {
        console.error('💥 Critical error:', error);
        process.exit(1);
    });
}

module.exports = { runKoobsTest };