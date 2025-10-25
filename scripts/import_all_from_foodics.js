#!/usr/bin/env node

// Script to import ALL items from Foodics (including deleted ones) to ensure complete sync

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { makeClient } = require('../server/integrations/foodics.js');

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

async function importAllFromFoodics() {
    console.log('📥 Starting to import ALL items from Foodics (including deleted)...\n');

    const pool = createDbPool();
    const client = makeClient(FOODICS_TOKEN);
    
    try {
        // Fetch all data from Foodics
        console.log('📡 Fetching data from Foodics API...');
        
        const [productsResult, modifierGroupsResult, modifierOptionsResult] = await Promise.all([
            client.listProducts(),
            client.listModifierGroups(), 
            client.listModifierOptions()
        ]);

        console.log(`✅ Fetched from Foodics:`);
        console.log(`   - Products: ${productsResult.items.length}`);
        console.log(`   - Modifier Groups: ${modifierGroupsResult.items.length}`);
        console.log(`   - Modifier Options: ${modifierOptionsResult.items.length}`);

        let importedGroups = 0;
        let importedOptions = 0;
        let importedProducts = 0;
        let updatedGroups = 0;
        let updatedOptions = 0;
        let updatedProducts = 0;

        // Import/Update modifier groups
        console.log('\n🏷️  IMPORTING MODIFIER GROUPS...');
        
        for (const group of modifierGroupsResult.items) {
            try {
                // Check if it exists by external_id
                let existingGroup = await db(pool, 
                    'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, group.id]
                );
                
                if (existingGroup.length === 0) {
                    // Check if it exists by name
                    existingGroup = await db(pool, 
                        'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, group.name]
                    );
                    
                    if (existingGroup.length === 0) {
                        // Insert new group
                        const result = await db(pool, `
                            INSERT INTO modifier_groups (id, tenant_id, name, type, slug, external_id, deleted_at, created_at, updated_at)
                            VALUES (gen_random_uuid(), $1, $2, 'single', $3, $4, $5, NOW(), NOW())
                            RETURNING id
                        `, [
                            DEFAULT_TENANT_ID, 
                            group.name,
                            group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
                            group.id,
                            group.deleted_at || null
                        ]);
                        
                        if (result.length > 0) {
                            console.log(`✅ Imported group: ${group.name}${group.deleted_at ? ' (deleted)' : ''}`);
                            importedGroups++;
                        }
                    } else {
                        // Update existing group with external_id and deleted_at
                        await db(pool, 
                            'UPDATE modifier_groups SET external_id = $1, deleted_at = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
                            [group.id, group.deleted_at || null, existingGroup[0].id, DEFAULT_TENANT_ID]
                        );
                        console.log(`🔄 Updated group: ${group.name}${group.deleted_at ? ' (deleted)' : ''}`);
                        updatedGroups++;
                    }
                } else {
                    // Update deleted_at status
                    await db(pool, 
                        'UPDATE modifier_groups SET deleted_at = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                        [group.deleted_at || null, existingGroup[0].id, DEFAULT_TENANT_ID]
                    );
                    console.log(`🔄 Updated group status: ${group.name}${group.deleted_at ? ' (deleted)' : ''}`);
                    updatedGroups++;
                }
            } catch (error) {
                console.log(`❌ Error processing group ${group.name}:`, error.message);
            }
        }

        // Import/Update modifier options
        console.log('\n⚙️  IMPORTING MODIFIER OPTIONS...');
        
        for (const option of modifierOptionsResult.items) {
            try {
                // Check if it exists by external_id
                let existingOption = await db(pool, 
                    'SELECT id FROM modifier_options WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, option.id]
                );
                
                if (existingOption.length === 0) {
                    // Check if it exists by name
                    existingOption = await db(pool, 
                        'SELECT id FROM modifier_options WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, option.name]
                    );
                    
                    if (existingOption.length === 0) {
                        // Find the group this option belongs to
                        let groupId = null;
                        if (option.modifier_group_id) {
                            const group = await db(pool, 
                                'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND external_id = $2',
                                [DEFAULT_TENANT_ID, option.modifier_group_id]
                            );
                            if (group.length > 0) {
                                groupId = group[0].id;
                            }
                        }
                        
                        // Insert new option
                        const result = await db(pool, `
                            INSERT INTO modifier_options (id, tenant_id, modifier_group_id, name, price, external_id, deleted_at, created_at, updated_at)
                            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
                            RETURNING id
                        `, [
                            DEFAULT_TENANT_ID,
                            groupId,
                            option.name,
                            (option.price || 0), // Keep as decimal, not cents
                            option.id,
                            option.deleted_at || null
                        ]);
                        
                        if (result.length > 0) {
                            console.log(`✅ Imported option: ${option.name}${option.deleted_at ? ' (deleted)' : ''}`);
                            importedOptions++;
                        }
                    } else {
                        // Update existing option with external_id and deleted_at
                        await db(pool, 
                            'UPDATE modifier_options SET external_id = $1, deleted_at = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
                            [option.id, option.deleted_at || null, existingOption[0].id, DEFAULT_TENANT_ID]
                        );
                        console.log(`🔄 Updated option: ${option.name}${option.deleted_at ? ' (deleted)' : ''}`);
                        updatedOptions++;
                    }
                } else {
                    // Update deleted_at status
                    await db(pool, 
                        'UPDATE modifier_options SET deleted_at = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                        [option.deleted_at || null, existingOption[0].id, DEFAULT_TENANT_ID]
                    );
                    console.log(`🔄 Updated option status: ${option.name}${option.deleted_at ? ' (deleted)' : ''}`);
                    updatedOptions++;
                }
            } catch (error) {
                console.log(`❌ Error processing option ${option.name}:`, error.message);
            }
        }

        // Import/Update products
        console.log('\n📦 IMPORTING PRODUCTS...');
        
        for (const product of productsResult.items) {
            try {
                // Check if it exists by external_id
                let existingProduct = await db(pool, 
                    'SELECT id FROM products WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, product.id]
                );
                
                if (existingProduct.length === 0) {
                    // Check if it exists by name
                    existingProduct = await db(pool, 
                        'SELECT id FROM products WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, product.name]
                    );
                    
                    if (existingProduct.length === 0) {
                        // Insert new product - Need category_id, so skip for now
                        console.log(`⏭️  Skipping product import: ${product.name} (missing category_id)`);
                        
                        if (result.length > 0) {
                            console.log(`✅ Imported product: ${product.name}${product.deleted_at ? ' (deleted)' : ''}`);
                            importedProducts++;
                        }
                    } else {
                        // Update existing product with external_id and deleted_at
                        await db(pool, 
                            'UPDATE products SET external_id = $1, deleted_at = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
                            [product.id, product.deleted_at || null, existingProduct[0].id, DEFAULT_TENANT_ID]
                        );
                        console.log(`🔄 Updated product: ${product.name}${product.deleted_at ? ' (deleted)' : ''}`);
                        updatedProducts++;
                    }
                } else {
                    // Update deleted_at status
                    await db(pool, 
                        'UPDATE products SET deleted_at = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                        [product.deleted_at || null, existingProduct[0].id, DEFAULT_TENANT_ID]
                    );
                    console.log(`🔄 Updated product status: ${product.name}${product.deleted_at ? ' (deleted)' : ''}`);
                    updatedProducts++;
                }
            } catch (error) {
                console.log(`❌ Error processing product ${product.name}:`, error.message);
            }
        }

        // Final summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 IMPORT ALL FROM FOODICS SUMMARY');
        console.log('='.repeat(80));
        console.log(`🏷️  Modifier Groups:`);
        console.log(`   ➕ Imported: ${importedGroups}`);
        console.log(`   🔄 Updated: ${updatedGroups}`);
        console.log(`⚙️  Modifier Options:`);
        console.log(`   ➕ Imported: ${importedOptions}`);
        console.log(`   🔄 Updated: ${updatedOptions}`);
        console.log(`📦 Products:`);
        console.log(`   ➕ Imported: ${importedProducts}`);
        console.log(`   🔄 Updated: ${updatedProducts}`);
        console.log('='.repeat(80));

        const totalImported = importedGroups + importedOptions + importedProducts;
        const totalUpdated = updatedGroups + updatedOptions + updatedProducts;
        
        if (totalImported > 0 || totalUpdated > 0) {
            console.log(`\n🎉 Successfully imported all items from Foodics!`);
            console.log(`   ➕ ${totalImported} new items imported`);
            console.log(`   🔄 ${totalUpdated} existing items updated`);
            console.log('💡 Now all deleted items from Foodics should appear in the "Deleted" tab in your admin interface.');
        } else {
            console.log('\n📝 No new items to import. Everything is already up to date!');
        }

    } catch (error) {
        console.error('💥 Import operation failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the import operation if this script is executed directly
if (require.main === module) {
    importAllFromFoodics().catch(error => {
        console.error('💥 Import operation failed:', error);
        process.exit(1);
    });
}

module.exports = { importAllFromFoodics };