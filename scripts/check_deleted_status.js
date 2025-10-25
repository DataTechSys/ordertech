#!/usr/bin/env node

// Script to check current deleted status in database

const { Pool } = require('pg');

// Configuration
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Database connection
function createDbPool() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('❌ DATABASE_URL environment variable not set');
        process.exit(1);
    }
    
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: false // Cloud SQL Proxy handles SSL
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

async function checkDeletedStatus() {
    console.log('🔍 Checking current deleted status in database...\n');

    const pool = createDbPool();
    
    try {
        // Check modifier groups
        console.log('🏷️  MODIFIER GROUPS:');
        const groupStats = await db(pool, `
            SELECT 
                COUNT(*) as total,
                COUNT(deleted_at) as deleted,
                COUNT(*) - COUNT(deleted_at) as active,
                COUNT(external_id) as with_external_id
            FROM modifier_groups 
            WHERE tenant_id = $1
        `, [DEFAULT_TENANT_ID]);
        
        console.log(`   Total: ${groupStats[0].total}`);
        console.log(`   Active: ${groupStats[0].active}`);
        console.log(`   Deleted: ${groupStats[0].deleted}`);
        console.log(`   With external_id: ${groupStats[0].with_external_id}`);

        // Check modifier options
        console.log('\n⚙️  MODIFIER OPTIONS:');
        const optionStats = await db(pool, `
            SELECT 
                COUNT(*) as total,
                COUNT(deleted_at) as deleted,
                COUNT(*) - COUNT(deleted_at) as active,
                COUNT(external_id) as with_external_id
            FROM modifier_options 
            WHERE tenant_id = $1
        `, [DEFAULT_TENANT_ID]);
        
        console.log(`   Total: ${optionStats[0].total}`);
        console.log(`   Active: ${optionStats[0].active}`);
        console.log(`   Deleted: ${optionStats[0].deleted}`);
        console.log(`   With external_id: ${optionStats[0].with_external_id}`);

        // Check products
        console.log('\n📦 PRODUCTS:');
        const productStats = await db(pool, `
            SELECT 
                COUNT(*) as total,
                COUNT(deleted_at) as deleted,
                COUNT(*) - COUNT(deleted_at) as active,
                COUNT(external_id) as with_external_id
            FROM products 
            WHERE tenant_id = $1
        `, [DEFAULT_TENANT_ID]);
        
        console.log(`   Total: ${productStats[0].total}`);
        console.log(`   Active: ${productStats[0].active}`);
        console.log(`   Deleted: ${productStats[0].deleted}`);
        console.log(`   With external_id: ${productStats[0].with_external_id}`);

        console.log('\n' + '='.repeat(50));

        // Show some sample records
        console.log('\n📝 SAMPLE MODIFIER GROUPS (first 5):');
        const sampleGroups = await db(pool, `
            SELECT name, deleted_at, external_id 
            FROM modifier_groups 
            WHERE tenant_id = $1 
            ORDER BY name 
            LIMIT 5
        `, [DEFAULT_TENANT_ID]);
        
        sampleGroups.forEach(group => {
            console.log(`   ${group.name} | deleted_at: ${group.deleted_at || 'NULL'} | external_id: ${group.external_id || 'NULL'}`);
        });

        console.log('\n📝 SAMPLE MODIFIER OPTIONS (first 5):');
        const sampleOptions = await db(pool, `
            SELECT name, deleted_at, external_id 
            FROM modifier_options 
            WHERE tenant_id = $1 
            ORDER BY name 
            LIMIT 5
        `, [DEFAULT_TENANT_ID]);
        
        sampleOptions.forEach(option => {
            console.log(`   ${option.name} | deleted_at: ${option.deleted_at || 'NULL'} | external_id: ${option.external_id || 'NULL'}`);
        });

    } catch (error) {
        console.error('💥 Check operation failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the check operation if this script is executed directly
if (require.main === module) {
    checkDeletedStatus().catch(error => {
        console.error('💥 Check operation failed:', error);
        process.exit(1);
    });
}

module.exports = { checkDeletedStatus };