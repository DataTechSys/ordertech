#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Database configuration
const dbConfig = {
    connectionString: process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/ordertech',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

let pool = new Pool(dbConfig);

async function syncModifiersFromCSV(dbConnection = null, tenantId = null) {
    // Use provided database connection or create a new pool
    const useExternalDb = !!dbConnection;
    if (!useExternalDb) {
        pool = new Pool(dbConfig);
    }
    
    // Default tenant ID for Koobs Cafe
    const defaultTenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    const activeTenantId = tenantId || defaultTenantId;
    
    console.log('🚀 Starting modifier sync from CSV data...');
    console.log(`🏢 Using tenant ID: ${activeTenantId}`);
    
    try {
        // Read and parse CSV file
        const csvPath = path.join(__dirname, '..', 'product_modifiers.csv');
        console.log(`📄 Reading CSV file: ${csvPath}`);
        
        if (!fs.existsSync(csvPath)) {
            throw new Error(`CSV file not found: ${csvPath}`);
        }

        const csvData = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => csvData.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`📊 Parsed ${csvData.length} rows from CSV`);

        // Group data by modifier reference
        const modifierGroups = {};
        const productModifierRelations = [];

        csvData.forEach(row => {
            const modifierRef = row.modifier_reference;
            const modifierName = row.modifier_name;
            const productSku = row.product_sku;
            const productName = row.product_name;

            // Group modifier data
            if (!modifierGroups[modifierRef]) {
                modifierGroups[modifierRef] = {
                    reference: modifierRef,
                    name: modifierName,
                    options: new Set()
                };
            }

            // Track product-modifier relationships
            productModifierRelations.push({
                productSku,
                productName,
                modifierReference: modifierRef,
                modifierName,
                minimumOptions: parseInt(row.minimum_options) || 0,
                maximumOptions: parseInt(row.maximum_options) || 1,
                freeOptions: parseInt(row.free_options) || 0,
                defaultOptions: row.default_options || null
            });
        });

        console.log(`🏷️  Found ${Object.keys(modifierGroups).length} unique modifier groups`);
        console.log(`🔗 Found ${productModifierRelations.length} product-modifier relationships`);

        // Start transaction
        let client, shouldReleaseClient = false;
        if (useExternalDb) {
            // Use the external database connection directly
            client = { query: dbConnection };
        } else {
            // Use our own pool
            client = await pool.connect();
            shouldReleaseClient = true;
        }
        
        if (shouldReleaseClient) {
            await client.query('BEGIN');
        } else {
            // For external db, we don't control transactions
            console.log('⚠️  Using external DB connection - no transaction control');
        }

        try {
            // 1. Clear existing modifier groups for this tenant using default schema
            console.log('\n1️⃣ Clearing existing modifier groups...');
            const deleteModifiers = await client.query(
                'DELETE FROM modifier_options WHERE group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = $1)',
                [activeTenantId]
            );
            const deleteGroups = await client.query(
                'DELETE FROM modifier_groups WHERE tenant_id = $1',
                [activeTenantId]
            );
            console.log(`🗑️  Deleted ${deleteModifiers.rowCount || 0} existing modifier options`);
            console.log(`🗑️  Deleted ${deleteGroups.rowCount || 0} existing modifier groups`);
            
            // 2. Create modifier groups
            console.log('\n2️⃣ Creating modifier groups...');
            const modifierGroupInserts = [];
            
            for (const [ref, group] of Object.entries(modifierGroups)) {
                // Check if modifier group exists
                const existing = await client.query(
                    'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND reference = $2',
                    [activeTenantId, ref]
                );
                
                // Handle both pool client format (result.rows) and db function format (direct array)
                const existingRows = existing.rows || existing;
                
                let modifierGroupId;
                if (existingRows.length > 0) {
                    modifierGroupId = existingRows[0].id;
                    // Update the name
                    await client.query(
                        'UPDATE modifier_groups SET name = $1 WHERE reference = $2',
                        [group.name, ref]
                    );
                } else {
                    // Insert new modifier group
                    const result = await client.query(
                        'INSERT INTO modifier_groups (tenant_id, reference, name) VALUES ($1, $2, $3) RETURNING id',
                        [activeTenantId, ref, group.name]
                    );
                    const resultRows = result.rows || result;
                    modifierGroupId = resultRows[0].id;
                }
                
                modifierGroupInserts.push({ reference: ref, id: modifierGroupId, name: group.name });
            }

            console.log(`✅ Synced ${modifierGroupInserts.length} modifier groups`);

            // 3. Create basic modifier options for each group
            console.log('\n3️⃣ Creating modifier options...');
            let optionsCreated = 0;

            for (const group of modifierGroupInserts) {
                // Create basic options based on group type
                let optionNames = [];
                
                switch (group.reference) {
                    case 'extra':
                        optionNames = ['No Extra', 'Extra Shot', 'Double Extra'];
                        break;
                    case 'delivery':
                        optionNames = ['Dine In', 'Takeaway', 'Delivery'];
                        break;
                    case 'milk_medium':
                        optionNames = ['Oat Milk', 'Almond Milk', 'Regular Milk', 'Soy Milk'];
                        break;
                    case 'milk_large':
                        optionNames = ['Oat Milk', 'Almond Milk', 'Regular Milk', 'Soy Milk'];
                        break;
                    case 'hot_milk':
                        optionNames = ['Regular Milk', 'Oat Milk', 'Almond Milk', 'Soy Milk'];
                        break;
                    case 'coffee_shot':
                        optionNames = ['Single Shot', 'Double Shot', 'Triple Shot', 'Decaf'];
                        break;
                    case 'option':
                        optionNames = ['Option 1', 'Option 2', 'Option 3'];
                        break;
                    case 'flavour':
                        optionNames = ['Vanilla', 'Caramel', 'Hazelnut', 'Cinnamon', 'Cardamom'];
                        break;
                    case 'topping':
                        optionNames = ['Whipped Cream', 'Chocolate Chips', 'Caramel Drizzle', 'Nuts'];
                        break;
                    case 'cups':
                        optionNames = ['Small Cup', 'Medium Cup', 'Large Cup'];
                        break;
                    case 'color':
                        optionNames = ['White', 'Black', 'Blue', 'Red', 'Green'];
                        break;
                    default:
                        optionNames = ['Standard', 'Premium', 'Deluxe'];
                }

                for (const optionName of optionNames) {
                    // Check if option already exists
                    const existingOption = await client.query(
                        'SELECT id FROM modifier_options WHERE group_id = $1 AND name = $2',
                        [group.id, optionName]
                    );
                    
                    const existingOptionRows = existingOption.rows || existingOption;
                    if (existingOptionRows.length === 0) {
                        // Insert new modifier option
                        await client.query(
                            'INSERT INTO modifier_options (tenant_id, group_id, name, price) VALUES ($1, $2, $3, $4)',
                            [activeTenantId, group.id, optionName, 0.00]
                        );
                        optionsCreated++;
                    }
                }
            }

            console.log(`✅ Created ${optionsCreated} modifier options`);

            // 4. Link products to modifier groups
            console.log('\n4️⃣ Linking products to modifier groups...');
            let relationshipsCreated = 0;
            let relationshipsSkipped = 0;

            // Group relationships by product SKU
            const productRelations = {};
            productModifierRelations.forEach(rel => {
                if (!productRelations[rel.productSku]) {
                    productRelations[rel.productSku] = [];
                }
                productRelations[rel.productSku].push(rel);
            });

            for (const [productSku, relations] of Object.entries(productRelations)) {
                // Find the product
                const productResult = await client.query(
                    'SELECT id FROM products WHERE tenant_id = $1 AND sku = $2 LIMIT 1',
                    [activeTenantId, productSku]
                );

                const productRows = productResult.rows || productResult;
                if (productRows.length === 0) {
                    console.log(`⚠️  Product not found: ${productSku} (${relations[0].productName})`);
                    relationshipsSkipped += relations.length;
                    continue;
                }

                const productId = productRows[0].id;
                console.log(`🔗 Linking product ${productSku} to ${relations.length} modifier groups...`);

                for (const relation of relations) {
                    try {
                        // Find the modifier group
                        const modifierGroupResult = await client.query(
                            'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND reference = $2',
                            [activeTenantId, relation.modifierReference]
                        );

                        const modifierGroupRows = modifierGroupResult.rows || modifierGroupResult;
                        if (modifierGroupRows.length === 0) {
                            console.log(`⚠️  Modifier group not found: ${relation.modifierReference}`);
                            // Debug: Check what modifier groups exist for this tenant
                            const debugResult = await client.query(
                                'SELECT reference, name FROM modifier_groups WHERE tenant_id = $1 ORDER BY reference',
                                [activeTenantId]
                            );
                            const debugRows = debugResult.rows || debugResult;
                            console.log(`🔍 Available modifier groups for tenant: ${debugRows.map(g => g.reference).join(', ')}`);
                            relationshipsSkipped++;
                            continue;
                        }

                        const modifierGroupId = modifierGroupRows[0].id;

                            // Check if relationship already exists
                        const existingRel = await client.query(
                            'SELECT 1 FROM product_modifier_groups WHERE product_id = $1 AND group_id = $2',
                            [productId, modifierGroupId]
                        );
                        
                        const existingRelRows = existingRel.rows || existingRel;
                        if (existingRelRows.length === 0) {
                            // Insert new relationship using correct column names
                            try {
                                await client.query(
                                    'INSERT INTO product_modifier_groups (product_id, group_id, min_select, max_select) VALUES ($1, $2, $3, $4)',
                                    [productId, modifierGroupId, relation.minimumOptions || 0, relation.maximumOptions || 1]
                                );
                            } catch (insertError) {
                                console.log(`⚠️  Insert failed for ${productSku} -> ${relation.modifierReference}: ${insertError.message}`);
                                // Try basic insert without min/max if columns don't exist
                                await client.query(
                                    'INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1, $2)',
                                    [productId, modifierGroupId]
                                );
                            }
                        }

                        relationshipsCreated++;
                    } catch (relationError) {
                        console.log(`⚠️  Failed to link ${productSku} to ${relation.modifierReference}: ${relationError.message}`);
                        relationshipsSkipped++;
                    }
                }
            }

            console.log(`✅ Created ${relationshipsCreated} product-modifier relationships`);
            console.log(`⚠️  Skipped ${relationshipsSkipped} relationships (products/modifiers not found)`);

            // Commit the transaction
            if (shouldReleaseClient) {
                await client.query('COMMIT');
                console.log('\n✅ Transaction committed successfully');
            } else {
                console.log('\n✅ Operations completed successfully (no transaction control)');
            }

            // 5. Generate summary report
            console.log('\n📊 SYNC SUMMARY:');
            console.log('================');
            
            const modifierGroupCount = await client.query('SELECT COUNT(*) FROM modifier_groups');
            const modifierOptionCount = await client.query('SELECT COUNT(*) FROM modifier_options');
            const productModifierCount = await client.query('SELECT COUNT(*) FROM product_modifier_groups');
            let productsWithModifiers;
            try {
                productsWithModifiers = await client.query(`
                    SELECT COUNT(DISTINCT p.id) 
                    FROM products p 
                    INNER JOIN product_modifier_groups pmg ON p.id = pmg.product_id
                `);
            } catch {
                productsWithModifiers = { rows: [{ count: '0' }] };
            }

            const groupCountRows = modifierGroupCount.rows || modifierGroupCount;
            const optionCountRows = modifierOptionCount.rows || modifierOptionCount;
            const linkCountRows = productModifierCount.rows || productModifierCount;
            const prodCountRows = productsWithModifiers.rows || productsWithModifiers;

            console.log(`📦 Modifier Groups: ${groupCountRows[0].count}`);
            console.log(`🏷️  Modifier Options: ${optionCountRows[0].count}`);
            console.log(`🔗 Product-Modifier Links: ${linkCountRows[0].count}`);
            console.log(`📱 Products with Modifiers: ${prodCountRows[0].count}`);

            // Show some examples
            let exampleProducts;
            try {
                exampleProducts = await client.query(`
                    SELECT 
                        p.name as product_name,
                        p.sku,
                        COUNT(*) as modifier_count
                    FROM products p
                    INNER JOIN product_modifier_groups pmg ON p.id = pmg.product_id
                    GROUP BY p.id, p.name, p.sku
                    ORDER BY modifier_count DESC
                    LIMIT 5
                `);
            } catch {
                exampleProducts = { rows: [] };
            }

            const exampleRows = exampleProducts.rows || exampleProducts;
            console.log('\n🌟 Top products with modifiers:');
            exampleRows.forEach(row => {
                console.log(`   ${row.product_name} (${row.sku}): ${row.modifier_count} modifier groups`);
            });

        } catch (error) {
            if (shouldReleaseClient) {
                await client.query('ROLLBACK');
            }
            throw error;
        } finally {
            if (shouldReleaseClient) {
                client.release();
            }
        }

    } catch (error) {
        console.error('❌ Sync failed:', error.message);
        console.error(error.stack);
        throw error;
    } finally {
        // Only close pool if running as CLI script
        if (require.main === module) {
            await pool.end();
        }
    }

    console.log('\n🎉 Modifier sync completed successfully!');
}

// Run the sync
if (require.main === module) {
    syncModifiersFromCSV().catch(err => {
        console.error('Script failed:', err);
        process.exit(1);
    });
}

module.exports = { syncModifiersFromCSV };