#!/usr/bin/env node

const { Pool } = require('pg');

// Database configuration
const dbConfig = {
    connectionString: process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/ordertech',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const pool = new Pool(dbConfig);

async function debugModifierGroups() {
    console.log('🔍 Debugging modifier group queries...');
    
    try {
        const client = await pool.connect();
        
        const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
        
        // Check if modifier groups exist
        console.log('\n1. Checking existing modifier groups:');
        const allGroups = await client.query(
            'SELECT id, reference, name, tenant_id FROM modifier_groups ORDER BY reference'
        );
        console.log(`Found ${allGroups.rows.length} total modifier groups:`);
        allGroups.rows.forEach(group => {
            console.log(`  - ${group.reference}: ${group.name} (tenant: ${group.tenant_id})`);
        });
        
        // Check tenant-specific modifier groups
        console.log(`\n2. Checking tenant-specific modifier groups for ${tenantId}:`);
        const tenantGroups = await client.query(
            'SELECT id, reference, name FROM modifier_groups WHERE tenant_id = $1',
            [tenantId]
        );
        console.log(`Found ${tenantGroups.rows.length} groups for this tenant:`);
        tenantGroups.rows.forEach(group => {
            console.log(`  - ${group.reference}: ${group.name} (id: ${group.id})`);
        });
        
        // Test specific lookups that the sync script is doing
        console.log('\n3. Testing specific modifier reference lookups:');
        const testReferences = ['extra', 'delivery', 'milk_medium', 'coffee_shot'];
        
        for (const ref of testReferences) {
            const result = await client.query(
                'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND reference = $2',
                [tenantId, ref]
            );
            const rows = result.rows || result;
            if (rows.length > 0) {
                console.log(`  ✅ ${ref} -> ${rows[0].id}`);
            } else {
                console.log(`  ❌ ${ref} -> NOT FOUND`);
            }
        }
        
        // Check products table
        console.log('\n4. Checking sample products:');
        const sampleProducts = await client.query(
            'SELECT id, sku, name FROM products WHERE tenant_id = $1 LIMIT 5',
            [tenantId]
        );
        console.log(`Found ${sampleProducts.rows.length} sample products:`);
        sampleProducts.rows.forEach(product => {
            console.log(`  - ${product.sku}: ${product.name} (id: ${product.id})`);
        });
        
        // Check the table schema
        console.log('\n5. Checking product_modifier_groups table schema:');
        const schemaQuery = `
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'product_modifier_groups' 
            ORDER BY ordinal_position
        `;
        const schemaResult = await client.query(schemaQuery);
        console.log('Columns in product_modifier_groups:');
        schemaResult.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
        });
        
        client.release();
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

// Run the debug
debugModifierGroups().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});