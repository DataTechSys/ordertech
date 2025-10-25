#!/usr/bin/env node

// Script to update existing database items with their deleted status from Foodics
// This will mark items as deleted if they are marked as deleted in Foodics

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

async function updateDeletedStatus() {
    console.log('🔄 Starting deleted status update...\n');

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

        let updatedGroups = 0;
        let updatedOptions = 0;
        let updatedProducts = 0;

        // Update modifier groups
        console.log('\n🏷️  UPDATING MODIFIER GROUPS STATUS...');
        for (const group of modifierGroupsResult.items) {
            try {
                if (group.deleted_at) {
                    // Mark as deleted
                    const result = await db(pool, 
                        'UPDATE modifier_groups SET deleted_at = $1 WHERE tenant_id = $2 AND external_id = $3',
                        [group.deleted_at, DEFAULT_TENANT_ID, group.id]
                    );
                    if (result.rowCount > 0) {
                        console.log(`✅ Marked group as deleted: ${group.name}`);
                        updatedGroups++;
                    }
                } else {
                    // Mark as not deleted (clear deleted_at)
                    const result = await db(pool, 
                        'UPDATE modifier_groups SET deleted_at = NULL WHERE tenant_id = $1 AND external_id = $2 AND deleted_at IS NOT NULL',
                        [DEFAULT_TENANT_ID, group.id]
                    );
                    if (result.rowCount > 0) {
                        console.log(`✅ Unmarked group deletion: ${group.name}`);
                        updatedGroups++;
                    }
                }
            } catch (error) {
                console.log(`❌ Error updating group ${group.name}:`, error.message);
            }
        }

        // Update modifier options
        console.log('\n⚙️  UPDATING MODIFIER OPTIONS STATUS...');
        for (const option of modifierOptionsResult.items) {
            try {
                if (option.deleted_at) {
                    // Mark as deleted
                    const result = await db(pool, 
                        'UPDATE modifier_options SET deleted_at = $1 WHERE tenant_id = $2 AND external_id = $3',
                        [option.deleted_at, DEFAULT_TENANT_ID, option.id]
                    );
                    if (result.rowCount > 0) {
                        console.log(`✅ Marked option as deleted: ${option.name}`);
                        updatedOptions++;
                    }
                } else {
                    // Mark as not deleted (clear deleted_at)
                    const result = await db(pool, 
                        'UPDATE modifier_options SET deleted_at = NULL WHERE tenant_id = $1 AND external_id = $2 AND deleted_at IS NOT NULL',
                        [DEFAULT_TENANT_ID, option.id]
                    );
                    if (result.rowCount > 0) {
                        console.log(`✅ Unmarked option deletion: ${option.name}`);
                        updatedOptions++;
                    }
                }
            } catch (error) {
                console.log(`❌ Error updating option ${option.name}:`, error.message);
            }
        }

        // Update products
        console.log('\n📦 UPDATING PRODUCTS STATUS...');
        for (const product of productsResult.items) {
            try {
                if (product.deleted_at) {
                    // Mark as deleted
                    const result = await db(pool, 
                        'UPDATE products SET deleted_at = $1 WHERE tenant_id = $2 AND external_id = $3',
                        [product.deleted_at, DEFAULT_TENANT_ID, product.id]
                    );
                    if (result.rowCount > 0) {
                        console.log(`✅ Marked product as deleted: ${product.name}`);
                        updatedProducts++;
                    }
                } else {
                    // Mark as not deleted (clear deleted_at)
                    const result = await db(pool, 
                        'UPDATE products SET deleted_at = NULL WHERE tenant_id = $1 AND external_id = $2 AND deleted_at IS NOT NULL',
                        [DEFAULT_TENANT_ID, product.id]
                    );
                    if (result.rowCount > 0) {
                        console.log(`✅ Unmarked product deletion: ${product.name}`);
                        updatedProducts++;
                    }
                }
            } catch (error) {
                console.log(`❌ Error updating product ${product.name}:`, error.message);
            }
        }

        // Final summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 DELETED STATUS UPDATE SUMMARY');
        console.log('='.repeat(80));
        console.log(`🏷️  Modifier Groups updated: ${updatedGroups}`);
        console.log(`⚙️  Modifier Options updated: ${updatedOptions}`);
        console.log(`📦 Products updated: ${updatedProducts}`);
        console.log('='.repeat(80));

        if (updatedGroups > 0 || updatedOptions > 0 || updatedProducts > 0) {
            console.log('\n🎉 Deleted status update completed successfully!');
            console.log('💡 You can now see deleted items in the "Deleted" tab in your admin interface.');
        } else {
            console.log('\n📝 No items needed status updates.');
        }

    } catch (error) {
        console.error('💥 Update failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the update if this script is executed directly
if (require.main === module) {
    updateDeletedStatus().catch(error => {
        console.error('💥 Update failed:', error);
        process.exit(1);
    });
}

module.exports = { updateDeletedStatus };