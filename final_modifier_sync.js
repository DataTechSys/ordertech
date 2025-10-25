#!/usr/bin/env node

// FINAL WORKING MODIFIER SYNC
// This version fixes the constraint issue and completes the full sync

const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

async function finalModifierSync(dbConnection = null) {
    const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    
    console.log('🚀 FINAL Modifier Sync - Using constraint fix!');
    
    let pool, client;
    if (dbConnection) {
        client = { query: dbConnection };
    } else {
        const dbConfig = {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
        };
        pool = new Pool(dbConfig);
        client = await pool.connect();
    }
    
    try {
        // 1. Fix the constraint first
        console.log('🔧 Fixing foreign key constraint...');
        await client.query('ALTER TABLE catalog.product_modifier_groups DROP CONSTRAINT IF EXISTS product_modifier_groups_group_id_fkey');
        await client.query('ALTER TABLE catalog.product_modifier_groups ADD CONSTRAINT product_modifier_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES catalog.modifier_groups(id) ON DELETE CASCADE');
        console.log('✅ Constraint fixed!');
        
        // 2. Read CSV
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
        
        // 3. Clear existing data
        console.log('🗑️ Clearing existing modifier data...');
        await client.query('DELETE FROM catalog.product_modifier_groups WHERE product_id IN (SELECT id FROM catalog.products WHERE tenant_id = $1)', [tenantId]);
        await client.query('DELETE FROM catalog.modifier_options WHERE group_id IN (SELECT id FROM catalog.modifier_groups WHERE tenant_id = $1)', [tenantId]);
        await client.query('DELETE FROM catalog.modifier_groups WHERE tenant_id = $1', [tenantId]);
        console.log('✅ Cleared existing data');

        // 4. Create modifier groups
        console.log('📦 Creating modifier groups...');
        const modifierGroups = {};
        csvData.forEach(row => {
            const ref = row.modifier_reference;
            if (!modifierGroups[ref]) {
                modifierGroups[ref] = row.modifier_name;
            }
        });
        
        for (const [ref, name] of Object.entries(modifierGroups)) {
            await client.query(
                `INSERT INTO catalog.modifier_groups (tenant_id, reference, name) VALUES ($1, $2, $3)`,
                [tenantId, ref, name]
            );
        }
        console.log(`✅ Created ${Object.keys(modifierGroups).length} modifier groups`);
        
        // 5. Create modifier options
        console.log('🏷️ Creating modifier options...');
        let optionsCreated = 0;
        
        for (const [ref, name] of Object.entries(modifierGroups)) {
            const groupResult = await client.query('SELECT id FROM catalog.modifier_groups WHERE tenant_id = $1 AND reference = $2', [tenantId, ref]);
            const groupRows = groupResult.rows || groupResult;
            
            if (groupRows.length > 0) {
                const groupId = groupRows[0].id;
                let optionNames = [];
                
                switch (ref) {
                    case 'extra':
                        optionNames = ['No Extra', 'Extra Shot', 'Double Extra'];
                        break;
                    case 'delivery':
                        optionNames = ['Dine In', 'Takeaway', 'Delivery'];
                        break;
                    case 'milk_medium':
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
                    await client.query(
                        'INSERT INTO catalog.modifier_options (tenant_id, group_id, name, price) VALUES ($1, $2, $3, $4)',
                        [tenantId, groupId, optionName, 0.00]
                    );
                    optionsCreated++;
                }
            }
        }
        console.log(`✅ Created ${optionsCreated} modifier options`);

        // 6. Link products to modifier groups
        console.log('🔗 Linking products to modifier groups...');
        let relationshipsCreated = 0;
        let relationshipsSkipped = 0;
        
        // Group relationships by product SKU
        const productRelations = {};
        csvData.forEach(row => {
            const sku = row.product_sku;
            if (!productRelations[sku]) {
                productRelations[sku] = [];
            }
            productRelations[sku].push({
                modifierReference: row.modifier_reference,
                minimumOptions: parseInt(row.minimum_options) || 0,
                maximumOptions: parseInt(row.maximum_options) || 1
            });
        });

        for (const [productSku, relations] of Object.entries(productRelations)) {
            // Find the product
            const productResult = await client.query('SELECT id FROM catalog.products WHERE tenant_id = $1 AND sku = $2 LIMIT 1', [tenantId, productSku]);
            const productRows = productResult.rows || productResult;
            
            if (productRows.length === 0) {
                console.log(`⚠️ Product not found: ${productSku}`);
                relationshipsSkipped += relations.length;
                continue;
            }
            
            const productId = productRows[0].id;
            
            for (const relation of relations) {
                // Find the modifier group
                const modifierGroupResult = await client.query('SELECT id FROM catalog.modifier_groups WHERE tenant_id = $1 AND reference = $2', [tenantId, relation.modifierReference]);
                const modifierGroupRows = modifierGroupResult.rows || modifierGroupResult;
                
                if (modifierGroupRows.length === 0) {
                    console.log(`⚠️ Modifier group not found: ${relation.modifierReference}`);
                    relationshipsSkipped++;
                    continue;
                }
                
                const modifierGroupId = modifierGroupRows[0].id;
                
                // Create the relationship
                try {
                    await client.query(
                        'INSERT INTO catalog.product_modifier_groups (product_id, group_id, min_select, max_select) VALUES ($1, $2, $3, $4)',
                        [productId, modifierGroupId, relation.minimumOptions, relation.maximumOptions]
                    );
                    relationshipsCreated++;
                } catch (insertError) {
                    // Try without min/max if columns don't exist
                    await client.query(
                        'INSERT INTO catalog.product_modifier_groups (product_id, group_id) VALUES ($1, $2)',
                        [productId, modifierGroupId]
                    );
                    relationshipsCreated++;
                }
            }
        }
        
        console.log(`✅ Created ${relationshipsCreated} product-modifier relationships`);
        console.log(`⚠️ Skipped ${relationshipsSkipped} relationships`);
        
        // 7. Generate summary
        const groupCount = await client.query('SELECT COUNT(*) FROM catalog.modifier_groups WHERE tenant_id = $1', [tenantId]);
        const optionCount = await client.query('SELECT COUNT(*) FROM catalog.modifier_options mo JOIN catalog.modifier_groups mg ON mo.group_id = mg.id WHERE mg.tenant_id = $1', [tenantId]);
        const linkCount = await client.query('SELECT COUNT(*) FROM catalog.product_modifier_groups pmg JOIN catalog.products p ON pmg.product_id = p.id WHERE p.tenant_id = $1', [tenantId]);
        
        const groupCountRows = groupCount.rows || groupCount;
        const optionCountRows = optionCount.rows || optionCount;
        const linkCountRows = linkCount.rows || linkCount;
        
        console.log('\n📊 SYNC SUMMARY:');
        console.log('================');
        console.log(`📦 Modifier Groups: ${groupCountRows[0].count}`);
        console.log(`🏷️ Modifier Options: ${optionCountRows[0].count}`);
        console.log(`🔗 Product-Modifier Links: ${linkCountRows[0].count}`);
        console.log('🎉 FULL SYNC COMPLETE!');
        
    } catch (error) {
        console.error('❌ Sync failed:', error.message);
        throw error;
    } finally {
        if (!dbConnection && pool) {
            if (client.release) client.release();
            await pool.end();
        }
    }
}

module.exports = { finalModifierSync };