#!/usr/bin/env node

// Script to sync deleted status from Foodics to our database
// This will mark items as deleted in our DB if they are deleted in Foodics

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

async function syncDeletedFromFoodics() {
    console.log('🔄 Starting to sync deleted status from Foodics...\n');

    const pool = createDbPool();
    const client = makeClient(FOODICS_TOKEN);
    
    try {
        // Fetch all data from Foodics
        console.log('📥 Fetching data from Foodics API...');
        
        const [productsResult, modifierGroupsResult, modifierOptionsResult] = await Promise.all([
            client.listProducts(),
            client.listModifierGroups(), 
            client.listModifierOptions()
        ]);

        console.log(`✅ Fetched from Foodics:`);
        console.log(`   - Products: ${productsResult.items.length}`);
        console.log(`   - Modifier Groups: ${modifierGroupsResult.items.length}`);
        console.log(`   - Modifier Options: ${modifierOptionsResult.items.length}`);

        let markedGroups = 0;
        let markedOptions = 0;
        let markedProducts = 0;
        let unmarkedGroups = 0;
        let unmarkedOptions = 0;
        let unmarkedProducts = 0;

        // Process modifier groups
        console.log('\n🏷️  SYNCING MODIFIER GROUPS...');
        
        // Get deleted groups from Foodics
        const deletedGroups = modifierGroupsResult.items.filter(g => g.deleted_at);
        const activeGroups = modifierGroupsResult.items.filter(g => !g.deleted_at);
        
        console.log(`📋 Found ${deletedGroups.length} deleted groups and ${activeGroups.length} active groups in Foodics`);

        // Mark deleted groups in our DB
        for (const group of deletedGroups) {
            try {
                // Find by external_id first, then by name/reference
                let dbGroup = await db(pool, 
                    'SELECT id, name FROM modifier_groups WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, group.id]
                );
                
                if (!dbGroup.length) {
                    // Try to find by name and reference
                    dbGroup = await db(pool, 
                        'SELECT id, name FROM modifier_groups WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, group.name]
                    );
                }
                
                if (dbGroup.length > 0) {
                    // Mark as deleted with the Foodics deleted_at timestamp
                    const result = await db(pool, 
                        'UPDATE modifier_groups SET deleted_at = $1, external_id = $2 WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL',
                        [group.deleted_at, group.id, dbGroup[0].id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Marked group as deleted: ${group.name}`);
                        markedGroups++;
                    }
                }
            } catch (error) {
                console.log(`❌ Error processing group ${group.name}:`, error.message);
            }
        }

        // Unmark active groups (clear deleted_at if they're active in Foodics)
        for (const group of activeGroups) {
            try {
                let dbGroup = await db(pool, 
                    'SELECT id, name FROM modifier_groups WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, group.id]
                );
                
                if (!dbGroup.length) {
                    dbGroup = await db(pool, 
                        'SELECT id, name FROM modifier_groups WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, group.name]
                    );
                }
                
                if (dbGroup.length > 0) {
                    // Clear deleted_at if it's set and update external_id
                    const result = await db(pool, 
                        'UPDATE modifier_groups SET deleted_at = NULL, external_id = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NOT NULL',
                        [group.id, dbGroup[0].id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Unmarked group deletion: ${group.name}`);
                        unmarkedGroups++;
                    } else {
                        // Just update external_id if needed
                        await db(pool, 
                            'UPDATE modifier_groups SET external_id = $1 WHERE id = $2 AND tenant_id = $3 AND (external_id IS NULL OR external_id != $1)',
                            [group.id, dbGroup[0].id, DEFAULT_TENANT_ID]
                        );
                    }
                }
            } catch (error) {
                console.log(`❌ Error processing active group ${group.name}:`, error.message);
            }
        }

        // Process modifier options
        console.log('\n⚙️  SYNCING MODIFIER OPTIONS...');
        
        const deletedOptions = modifierOptionsResult.items.filter(o => o.deleted_at);
        const activeOptions = modifierOptionsResult.items.filter(o => !o.deleted_at);
        
        console.log(`📋 Found ${deletedOptions.length} deleted options and ${activeOptions.length} active options in Foodics`);

        // Mark deleted options
        for (const option of deletedOptions) {
            try {
                let dbOption = await db(pool, 
                    'SELECT id, name FROM modifier_options WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, option.id]
                );
                
                if (!dbOption.length) {
                    dbOption = await db(pool, 
                        'SELECT id, name FROM modifier_options WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, option.name]
                    );
                }
                
                if (dbOption.length > 0) {
                    const result = await db(pool, 
                        'UPDATE modifier_options SET deleted_at = $1, external_id = $2 WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL',
                        [option.deleted_at, option.id, dbOption[0].id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Marked option as deleted: ${option.name}`);
                        markedOptions++;
                    }
                }
            } catch (error) {
                console.log(`❌ Error processing option ${option.name}:`, error.message);
            }
        }

        // Unmark active options
        for (const option of activeOptions) {
            try {
                let dbOption = await db(pool, 
                    'SELECT id, name FROM modifier_options WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, option.id]
                );
                
                if (!dbOption.length) {
                    dbOption = await db(pool, 
                        'SELECT id, name FROM modifier_options WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, option.name]
                    );
                }
                
                if (dbOption.length > 0) {
                    const result = await db(pool, 
                        'UPDATE modifier_options SET deleted_at = NULL, external_id = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NOT NULL',
                        [option.id, dbOption[0].id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Unmarked option deletion: ${option.name}`);
                        unmarkedOptions++;
                    } else {
                        // Just update external_id
                        await db(pool, 
                            'UPDATE modifier_options SET external_id = $1 WHERE id = $2 AND tenant_id = $3 AND (external_id IS NULL OR external_id != $1)',
                            [option.id, dbOption[0].id, DEFAULT_TENANT_ID]
                        );
                    }
                }
            } catch (error) {
                console.log(`❌ Error processing active option ${option.name}:`, error.message);
            }
        }

        // Process products
        console.log('\n📦 SYNCING PRODUCTS...');
        
        const deletedProducts = productsResult.items.filter(p => p.deleted_at);
        const activeProducts = productsResult.items.filter(p => !p.deleted_at);
        
        console.log(`📋 Found ${deletedProducts.length} deleted products and ${activeProducts.length} active products in Foodics`);

        // Mark deleted products
        for (const product of deletedProducts) {
            try {
                let dbProduct = await db(pool, 
                    'SELECT id, name FROM products WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, product.id]
                );
                
                if (!dbProduct.length) {
                    dbProduct = await db(pool, 
                        'SELECT id, name FROM products WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, product.name]
                    );
                }
                
                if (dbProduct.length > 0) {
                    const result = await db(pool, 
                        'UPDATE products SET deleted_at = $1, external_id = $2 WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL',
                        [product.deleted_at, product.id, dbProduct[0].id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Marked product as deleted: ${product.name}`);
                        markedProducts++;
                    }
                }
            } catch (error) {
                console.log(`❌ Error processing product ${product.name}:`, error.message);
            }
        }

        // Unmark active products
        for (const product of activeProducts) {
            try {
                let dbProduct = await db(pool, 
                    'SELECT id, name FROM products WHERE tenant_id = $1 AND external_id = $2',
                    [DEFAULT_TENANT_ID, product.id]
                );
                
                if (!dbProduct.length) {
                    dbProduct = await db(pool, 
                        'SELECT id, name FROM products WHERE tenant_id = $1 AND name = $2',
                        [DEFAULT_TENANT_ID, product.name]
                    );
                }
                
                if (dbProduct.length > 0) {
                    const result = await db(pool, 
                        'UPDATE products SET deleted_at = NULL, external_id = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NOT NULL',
                        [product.id, dbProduct[0].id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Unmarked product deletion: ${product.name}`);
                        unmarkedProducts++;
                    } else {
                        // Just update external_id
                        await db(pool, 
                            'UPDATE products SET external_id = $1 WHERE id = $2 AND tenant_id = $3 AND (external_id IS NULL OR external_id != $1)',
                            [product.id, dbProduct[0].id, DEFAULT_TENANT_ID]
                        );
                    }
                }
            } catch (error) {
                console.log(`❌ Error processing active product ${product.name}:`, error.message);
            }
        }

        // Final summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 SYNC DELETED STATUS FROM FOODICS SUMMARY');
        console.log('='.repeat(80));
        console.log(`🏷️  Modifier Groups:`);
        console.log(`   ✅ Marked as deleted: ${markedGroups}`);
        console.log(`   🔄 Unmarked (now active): ${unmarkedGroups}`);
        console.log(`⚙️  Modifier Options:`);
        console.log(`   ✅ Marked as deleted: ${markedOptions}`);
        console.log(`   🔄 Unmarked (now active): ${unmarkedOptions}`);
        console.log(`📦 Products:`);
        console.log(`   ✅ Marked as deleted: ${markedProducts}`);
        console.log(`   🔄 Unmarked (now active): ${unmarkedProducts}`);
        console.log('='.repeat(80));

        const totalMarked = markedGroups + markedOptions + markedProducts;
        const totalUnmarked = unmarkedGroups + unmarkedOptions + unmarkedProducts;
        
        if (totalMarked > 0 || totalUnmarked > 0) {
            console.log(`\n🎉 Successfully synced deleted status from Foodics!`);
            console.log(`   📥 ${totalMarked} items marked as deleted`);
            console.log(`   📤 ${totalUnmarked} items unmarked (now active)`);
            console.log('💡 You can now see the correct deleted items in the "Deleted" tab in your admin interface.');
        } else {
            console.log('\n📝 No items needed status updates. Everything is already in sync!');
        }

    } catch (error) {
        console.error('💥 Sync operation failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the sync operation if this script is executed directly
if (require.main === module) {
    syncDeletedFromFoodics().catch(error => {
        console.error('💥 Sync operation failed:', error);
        process.exit(1);
    });
}

module.exports = { syncDeletedFromFoodics };