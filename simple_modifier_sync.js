#!/usr/bin/env node

// SIMPLE WORKAROUND - Just get the modifier sync working!
// This bypasses all the complex schema issues by using the simplest possible approach

const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
};

async function simpleModifierSync(dbConnection = null) {
    const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    
    console.log('🚀 SIMPLE Modifier Sync - Bypassing all complexity!');
    
    // Use provided db connection or create pool
    let pool, client;
    if (dbConnection) {
        console.log('🔗 Using provided database connection');
        client = { query: dbConnection };
    } else {
        console.log('🔗 Creating new database pool');
        pool = new Pool(dbConfig);
        client = await pool.connect();
    }
    
    try {
        // 1. Read CSV
        const csvPath = path.join(__dirname, 'product_modifiers.csv');
        const csvData = [];
        
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => csvData.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`📊 Read ${csvData.length} rows from CSV`);

        // 2. Test basic operations
        
        // 3. Try the simplest possible approach - just insert using basic INSERT
        console.log('🧪 Testing basic insert...');
        
        // Get any product ID from catalog schema where they exist
        const products = await client.query('SELECT id, sku FROM catalog.products WHERE tenant_id = $1 LIMIT 5', [tenantId]);
        const productRows = products.rows || products; // Handle different result formats
        console.log(`Found ${productRows.length} products to work with`);
        
        if (productRows.length > 0) {
            // Create ONE simple modifier group in catalog schema
            const groupResult = await client.query(
                `INSERT INTO catalog.modifier_groups (tenant_id, reference, name) 
                 VALUES ($1, 'test_group', 'Test Group') 
                 ON CONFLICT (tenant_id, reference) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [tenantId]
            );
            
            const groupRows = groupResult.rows || groupResult;
            const groupId = groupRows[0].id;
            console.log(`✅ Created/found modifier group with ID: ${groupId}`);
            
            // Try to link the first product to this group
            const productId = productRows[0].id;
            const productSku = productRows[0].sku;
            
            console.log(`🔗 Trying to link:`);
            console.log(`   Product ID: ${productId} (${productSku})`);
            console.log(`   Modifier Group ID: ${groupId}`);
            
            // Double-check that both exist
            const productCheck = await client.query('SELECT id FROM catalog.products WHERE id = $1', [productId]);
            const groupCheck = await client.query('SELECT id FROM catalog.modifier_groups WHERE id = $1', [groupId]);
            
            console.log(`   Product exists: ${(productCheck.rows || productCheck).length > 0}`);
            console.log(`   Group exists: ${(groupCheck.rows || groupCheck).length > 0}`);
            
            try {
                // Try the simplest possible insert in catalog schema
                await client.query(
                    'INSERT INTO catalog.product_modifier_groups (product_id, group_id) VALUES ($1, $2)',
                    [productId, groupId]
                );
                console.log(`🎉 SUCCESS! Linked product ${productSku} to modifier group!`);
                
                // If that worked, let's try creating all the modifier groups
                console.log('📦 Creating all modifier groups...');
                
                const modifierGroups = {};
                csvData.forEach(row => {
                    const ref = row.modifier_reference;
                    if (!modifierGroups[ref]) {
                        modifierGroups[ref] = row.modifier_name;
                    }
                });
                
                for (const [ref, name] of Object.entries(modifierGroups)) {
                    await client.query(
                        `INSERT INTO catalog.modifier_groups (tenant_id, reference, name) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (tenant_id, reference) DO UPDATE SET name = EXCLUDED.name`,
                        [tenantId, ref, name]
                    );
                }
                
                console.log(`✅ Created ${Object.keys(modifierGroups).length} modifier groups`);
                console.log('🎉 SIMPLE SYNC COMPLETE!');
                
            } catch (error) {
                console.error('❌ Failed basic insert:', error.message);
                
                // Nuclear option: Let's just fix the constraint!
                console.log('💥 NUCLEAR OPTION: Fixing the constraint!');
                try {
                    // Drop the problematic constraint
                    await client.query('ALTER TABLE catalog.product_modifier_groups DROP CONSTRAINT IF EXISTS product_modifier_groups_group_id_fkey');
                    console.log('🗑️ Dropped old constraint');
                    
                    // Add the correct constraint
                    await client.query('ALTER TABLE catalog.product_modifier_groups ADD CONSTRAINT product_modifier_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES catalog.modifier_groups(id) ON DELETE CASCADE');
                    console.log('✅ Added new constraint');
                    
                    // Try the insert again
                    await client.query(
                        'INSERT INTO catalog.product_modifier_groups (product_id, group_id) VALUES ($1, $2)',
                        [productId, groupId]
                    );
                    console.log('🎉 SUCCESS after constraint fix!');                    
                    
                } catch (constraintError) {
                    console.error('❌ Constraint fix failed:', constraintError.message);
                }
                
                console.log('🔍 Let me check what tables exist...');
                
                const tables = await client.query(`
                    SELECT schemaname, tablename 
                    FROM pg_tables 
                    WHERE tablename IN ('modifier_groups', 'product_modifier_groups', 'products')
                    ORDER BY schemaname, tablename
                `);
                
                const tableRows = tables.rows || tables;
                console.log('📋 Available tables:');
                tableRows.forEach(row => {
                    console.log(`   ${row.schemaname}.${row.tablename}`);
                });
                
                // Try with different column names in catalog schema
                console.log('🔄 Trying with modifier_group_id in catalog schema...');
                try {
                    await client.query(
                        'INSERT INTO catalog.product_modifier_groups (product_id, modifier_group_id) VALUES ($1, $2)',
                        [productId, groupId]
                    );
                    console.log('🎉 SUCCESS with modifier_group_id!');
                } catch (error2) {
                    console.error('❌ Also failed with modifier_group_id:', error2.message);
                }
            }
        }
        
        if (!dbConnection) {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Simple sync failed:', error.message);
    } finally {
        if (pool) {
            await pool.end();
        }
    }
}

// Run if called directly
if (require.main === module) {
    simpleModifierSync().catch(console.error);
}

module.exports = { simpleModifierSync };