#!/usr/bin/env node

// Complete Foodics import script for Cloud Run
// Imports products, modifier groups, modifier options, and their relationships

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { makeClient } = require('../server/integrations/foodics.js');

// Configuration
const BATCH_SIZE = 50;
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

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Import Products
async function importProducts(pool, tenantId, products) {
    console.log(`\n📦 IMPORTING PRODUCTS (${products.length} items)`);
    let successful = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 Processing products batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(products.length / BATCH_SIZE)} (${batch.length} items):`);

        for (const product of batch) {
            try {
                // Skip deleted products
                if (product.deleted_at) {
                    console.log(`⏭️  Skipping deleted product: ${product.name}`);
                    skipped++;
                    continue;
                }

                // Check if product already exists
                const existing = await db(pool, 
                    'SELECT id FROM products WHERE tenant_id = $1 AND external_id = $2',
                    [tenantId, product.id]
                );

                if (existing.length > 0) {
                    console.log(`⏭️  Product already exists: ${product.name}`);
                    skipped++;
                    continue;
                }

                // Insert product
                await db(pool, `
                    INSERT INTO products (
                        tenant_id, external_id, name, name_localized, description, description_localized,
                        sku, price, image_url, active, preparation_time, calories, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                `, [
                    tenantId,
                    product.id,
                    product.name,
                    product.name_localized,
                    product.description,
                    product.description_localized,
                    product.sku,
                    product.price || 0,
                    product.image,
                    product.is_active || true,
                    product.preparation_time,
                    product.calories,
                    product.created_at || new Date().toISOString(),
                    product.updated_at || new Date().toISOString()
                ]);

                console.log(`✅ Imported product: ${product.name} (${product.sku})`);
                successful++;

            } catch (error) {
                console.log(`❌ Error importing product ${product.name}:`, error.message);
                errors++;
            }

            await sleep(10);
        }

        if (i + BATCH_SIZE < products.length) {
            console.log('⏳ Pausing between batches...');
            await sleep(1000);
        }
    }

    return { successful, skipped, errors };
}

// Import Modifier Groups
async function importModifierGroups(pool, tenantId, modifierGroups) {
    console.log(`\n🏷️  IMPORTING MODIFIER GROUPS (${modifierGroups.length} items)`);
    let successful = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < modifierGroups.length; i += BATCH_SIZE) {
        const batch = modifierGroups.slice(i, i + BATCH_SIZE);
        console.log(`\n🏷️  Processing modifier groups batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(modifierGroups.length / BATCH_SIZE)} (${batch.length} items):`);

        for (const group of batch) {
            try {
                // Skip deleted groups
                if (group.deleted_at) {
                    console.log(`⏭️  Skipping deleted group: ${group.name}`);
                    skipped++;
                    continue;
                }

                // Check if group already exists by external_id
                const existing = await db(pool, 
                    'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND external_id = $2',
                    [tenantId, group.id]
                );

                if (existing.length > 0) {
                    console.log(`⏭️  Modifier group already exists: ${group.name}`);
                    skipped++;
                    continue;
                }

                // Insert modifier group
                await db(pool, `
                    INSERT INTO modifier_groups (
                        tenant_id, external_id, name, name_localized, reference, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    tenantId,
                    group.id,
                    group.name,
                    group.name_localized,
                    group.reference,
                    group.created_at || new Date().toISOString(),
                    group.updated_at || new Date().toISOString()
                ]);

                console.log(`✅ Imported modifier group: ${group.name} (ref: ${group.reference})`);
                successful++;

            } catch (error) {
                console.log(`❌ Error importing modifier group ${group.name}:`, error.message);
                errors++;
            }

            await sleep(10);
        }

        if (i + BATCH_SIZE < modifierGroups.length) {
            console.log('⏳ Pausing between batches...');
            await sleep(1000);
        }
    }

    return { successful, skipped, errors };
}

// Import Modifier Options
async function importModifierOptions(pool, tenantId, modifierOptions) {
    console.log(`\n⚙️  IMPORTING MODIFIER OPTIONS (${modifierOptions.length} items)`);
    let successful = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < modifierOptions.length; i += BATCH_SIZE) {
        const batch = modifierOptions.slice(i, i + BATCH_SIZE);
        console.log(`\n⚙️  Processing modifier options batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(modifierOptions.length / BATCH_SIZE)} (${batch.length} items):`);

        for (const option of batch) {
            try {
                // Skip deleted options
                if (option.deleted_at) {
                    console.log(`⏭️  Skipping deleted option: ${option.name}`);
                    skipped++;
                    continue;
                }

                // Check if option already exists
                const existing = await db(pool, 
                    'SELECT id FROM modifier_options WHERE tenant_id = $1 AND external_id = $2',
                    [tenantId, option.id]
                );

                if (existing.length > 0) {
                    console.log(`⏭️  Modifier option already exists: ${option.name}`);
                    skipped++;
                    continue;
                }

                // We need to find the group_id from our imported modifier groups
                // For now, we'll create options without group assignment
                // The relationships will be handled separately

                // Insert modifier option
                await db(pool, `
                    INSERT INTO modifier_options (
                        tenant_id, external_id, name, name_localized, sku, price, 
                        active, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    tenantId,
                    option.id,
                    option.name,
                    option.name_localized,
                    option.sku,
                    option.price || 0,
                    option.is_active !== false,
                    option.created_at || new Date().toISOString(),
                    option.updated_at || new Date().toISOString()
                ]);

                console.log(`✅ Imported modifier option: ${option.name} (${option.sku})`);
                successful++;

            } catch (error) {
                console.log(`❌ Error importing modifier option ${option.name}:`, error.message);
                errors++;
            }

            await sleep(10);
        }

        if (i + BATCH_SIZE < modifierOptions.length) {
            console.log('⏳ Pausing between batches...');
            await sleep(1000);
        }
    }

    return { successful, skipped, errors };
}

// Create External Mappings for Foodics entities
async function createExternalMappings(pool, tenantId, entityType, entities) {
    console.log(`\n🔗 CREATING EXTERNAL MAPPINGS FOR ${entityType.toUpperCase()}`);
    let successful = 0;
    let errors = 0;

    for (const entity of entities) {
        try {
            if (entity.deleted_at) continue;

            // Get the internal ID based on external_id
            let tableName = entityType === 'product' ? 'products' : 
                           entityType === 'modifier_group' ? 'modifier_groups' : 'modifier_options';
            
            const internal = await db(pool, 
                `SELECT id FROM ${tableName} WHERE tenant_id = $1 AND external_id = $2`,
                [tenantId, entity.id]
            );

            if (internal.length === 0) continue;

            // Insert external mapping
            await db(pool, `
                INSERT INTO tenant_external_mappings (
                    tenant_id, provider, entity_type, entity_id, external_id, 
                    external_reference, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (tenant_id, provider, entity_type, entity_id) DO NOTHING
            `, [
                tenantId,
                'foodics',
                entityType,
                internal[0].id,
                entity.id,
                entity.reference || entity.sku || entity.name,
                new Date().toISOString()
            ]);

            successful++;

        } catch (error) {
            console.log(`❌ Error creating mapping for ${entity.name || entity.id}:`, error.message);
            errors++;
        }
    }

    console.log(`✅ Created ${successful} external mappings for ${entityType}`);
    return { successful, errors };
}

// Main import function
async function importFoodicsData() {
    console.log('🚀 Starting complete Foodics import to OrderTech...\n');

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

        // Filter out deleted items for active import
        const activeProducts = productsResult.items.filter(p => !p.deleted_at && p.is_active);
        const activeModifierGroups = modifierGroupsResult.items.filter(g => !g.deleted_at);
        const activeModifierOptions = modifierOptionsResult.items.filter(o => !o.deleted_at);

        console.log(`\n📋 Active items to import:`);
        console.log(`   - Products: ${activeProducts.length}`);
        console.log(`   - Modifier Groups: ${activeModifierGroups.length}`);
        console.log(`   - Modifier Options: ${activeModifierOptions.length}`);

        // Import in sequence: groups first, then options, then products
        const groupResults = await importModifierGroups(pool, DEFAULT_TENANT_ID, activeModifierGroups);
        const optionResults = await importModifierOptions(pool, DEFAULT_TENANT_ID, activeModifierOptions);
        const productResults = await importProducts(pool, DEFAULT_TENANT_ID, activeProducts);

        // Create external mappings for Foodics integration
        await createExternalMappings(pool, DEFAULT_TENANT_ID, 'modifier_group', activeModifierGroups);
        await createExternalMappings(pool, DEFAULT_TENANT_ID, 'modifier_option', activeModifierOptions); 
        await createExternalMappings(pool, DEFAULT_TENANT_ID, 'product', activeProducts);

        // Final summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 COMPLETE FOODICS IMPORT SUMMARY');
        console.log('='.repeat(80));
        
        console.log(`\n🏷️  Modifier Groups:`);
        console.log(`   ✅ Successfully imported: ${groupResults.successful}`);
        console.log(`   ⏭️  Skipped (already exist): ${groupResults.skipped}`);
        console.log(`   ❌ Errors: ${groupResults.errors}`);

        console.log(`\n⚙️  Modifier Options:`);
        console.log(`   ✅ Successfully imported: ${optionResults.successful}`);
        console.log(`   ⏭️  Skipped (already exist): ${optionResults.skipped}`);
        console.log(`   ❌ Errors: ${optionResults.errors}`);

        console.log(`\n📦 Products:`);
        console.log(`   ✅ Successfully imported: ${productResults.successful}`);
        console.log(`   ⏭️  Skipped (already exist): ${productResults.skipped}`);
        console.log(`   ❌ Errors: ${productResults.errors}`);

        console.log('='.repeat(80));

        const totalSuccessful = groupResults.successful + optionResults.successful + productResults.successful;
        const totalErrors = groupResults.errors + optionResults.errors + productResults.errors;

        if (totalSuccessful > 0 && totalErrors === 0) {
            console.log('\n🎉 Import completed successfully! All Foodics data has been imported.');
            console.log('\n💡 Next steps:');
            console.log('   1. Review imported products in the OrderTech admin panel');
            console.log('   2. Test modifier options in the cashier system');
            console.log('   3. Configure product-modifier relationships as needed');
        } else if (totalSuccessful > 0) {
            console.log('\n⚠️  Import completed with some issues. Check error messages above.');
        } else {
            console.log('\n❌ Import failed. No items were imported successfully.');
        }

    } catch (error) {
        console.error('💥 Import failed:', error.message);
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            console.error('💡 Foodics token might be expired. Please refresh the token.');
        }
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the import if this script is executed directly
if (require.main === module) {
    importFoodicsData().catch(error => {
        console.error('💥 Import failed:', error);
        process.exit(1);
    });
}

module.exports = { importFoodicsData };