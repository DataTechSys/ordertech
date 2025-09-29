#!/usr/bin/env node

// Check what modifier groups exist in the database

const { Pool } = require('pg');

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Database connection using environment variables from Cloud Run
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

async function checkModifierGroups() {
    console.log('🔍 Checking existing modifier groups in database...\n');

    const pool = createDbPool();
    
    try {
        const groups = await db(pool, 
            'SELECT id, name, reference FROM modifier_groups WHERE tenant_id = $1 ORDER BY name',
            [DEFAULT_TENANT_ID]
        );
        
        if (groups.length === 0) {
            console.log('❌ No modifier groups found in database!');
        } else {
            console.log(`✅ Found ${groups.length} modifier groups:\n`);
            groups.forEach(group => {
                console.log(`  • ${group.name} (reference: ${group.reference || 'null'})`);
            });
        }
        
    } finally {
        await pool.end();
    }
}

// Run the check if this script is executed directly
if (require.main === module) {
    checkModifierGroups().catch(error => {
        console.error('💥 Check failed:', error);
        process.exit(1);
    });
}

module.exports = { checkModifierGroups };