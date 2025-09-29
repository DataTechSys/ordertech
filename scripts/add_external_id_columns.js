#!/usr/bin/env node

// Add external_id columns to database tables for Foodics integration

const { Pool } = require('pg');

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

// Add external_id columns
async function addExternalIdColumns() {
    console.log('🔄 Adding external_id columns to database tables...\n');

    const pool = createDbPool();
    
    try {
        // Add external_id to products table
        console.log('📦 Adding external_id to products table...');
        await db(pool, `
            ALTER TABLE products 
            ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
        `);
        
        await db(pool, `
            CREATE INDEX IF NOT EXISTS ix_products_external_id 
            ON products(tenant_id, external_id);
        `);
        console.log('✅ Added external_id to products table');

        // Add external_id to modifier_groups table
        console.log('🏷️ Adding external_id to modifier_groups table...');
        await db(pool, `
            ALTER TABLE modifier_groups 
            ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
        `);
        
        await db(pool, `
            CREATE INDEX IF NOT EXISTS ix_modifier_groups_external_id 
            ON modifier_groups(tenant_id, external_id);
        `);
        console.log('✅ Added external_id to modifier_groups table');

        // Add external_id to modifier_options table
        console.log('⚙️ Adding external_id to modifier_options table...');
        await db(pool, `
            ALTER TABLE modifier_options 
            ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
        `);
        
        await db(pool, `
            CREATE INDEX IF NOT EXISTS ix_modifier_options_external_id 
            ON modifier_options(tenant_id, external_id);
        `);
        console.log('✅ Added external_id to modifier_options table');

        // Ensure tenant_external_mappings table exists
        console.log('🔗 Ensuring tenant_external_mappings table exists...');
        await db(pool, `
            CREATE TABLE IF NOT EXISTS tenant_external_mappings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                provider VARCHAR(50) NOT NULL,
                entity_type VARCHAR(50) NOT NULL,
                entity_id UUID NOT NULL,
                external_id VARCHAR(255) NOT NULL,
                external_reference VARCHAR(255),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(tenant_id, provider, entity_type, entity_id)
            );
        `);
        
        await db(pool, `
            CREATE INDEX IF NOT EXISTS ix_tenant_external_mappings_lookup 
            ON tenant_external_mappings(tenant_id, provider, entity_type, external_id);
        `);
        console.log('✅ Ensured tenant_external_mappings table exists');

        console.log('\n🎉 Successfully added all external_id columns and indexes!');
        
    } catch (error) {
        console.error('💥 Error adding external_id columns:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the migration if this script is executed directly
if (require.main === module) {
    addExternalIdColumns().catch(error => {
        console.error('💥 Migration failed:', error);
        process.exit(1);
    });
}

module.exports = { addExternalIdColumns };