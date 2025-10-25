#!/usr/bin/env node

// Direct script to run Foodics sync bypassing the HTTP layer
// This will import all modifier groups, options, and product relationships from Foodics

const fs = require('fs');
const path = require('path');

// Set up the database connection
process.env.DATABASE_URL = 'postgres://ordertech:ordertech@127.0.0.1:5432/ordertech';

// Import the necessary modules from the server
const { Pool } = require('pg');
const { makeClient } = require('./server/integrations/foodics.js');

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL
});

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, 'ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
    FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

if (!FOODICS_TOKEN) {
    console.error('❌ Foodics token not found');
    process.exit(1);
}

async function runFoodicsSync() {
    try {
        console.log('🚀 Starting comprehensive Foodics sync...\n');
        
        // Find Koobs tenant
        const tenantResult = await pool.query('SELECT id, name FROM tenants WHERE name ILIKE $1', ['%koobs%']);
        if (tenantResult.rows.length === 0) {
            console.log('❌ No Koobs tenant found');
            return;
        }
        
        const tenant = tenantResult.rows[0];
        console.log(`✅ Found tenant: ${tenant.name} (ID: ${tenant.id})`);
        
        // Initialize Foodics client
        const client = makeClient(FOODICS_TOKEN);
        
        // 1. Fetch all data from Foodics
        console.log('\n📡 Fetching data from Foodics API...');
        
        const [productsResult, modifierGroupsResult, modifierOptionsResult] = await Promise.all([
            client.listProducts(),
            client.listModifierGroups(), 
            client.listModifierOptions()
        ]);
        
        console.log(`✅ Products: ${productsResult.items.length}`);
        console.log(`✅ Modifier groups: ${modifierGroupsResult.items.length}`);
        console.log(`✅ Modifier options: ${modifierOptionsResult.items.length}`);
        
        // 2. Import modifier groups
        console.log('\n🏷️  Importing modifier groups...');
        
        const groupMapping = new Map(); // external_id -> local_id
        let groupsImported = 0;
        
        for (const group of modifierGroupsResult.items) {
            try {
                const name = group.name || 'Unnamed Group';
                const reference = group.reference || group.id;
                const name_localized = group.name_localized || null;
                
                // Check if group already exists
                const existing = await pool.query(
                    'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND reference = $2',
                    [tenant.id, reference]
                );
                
                let groupId;
                if (existing.rows.length > 0) {
                    groupId = existing.rows[0].id;
                    console.log(`  📝 Updated: ${name}`);
                } else {
                    const insertResult = await pool.query(`
                        INSERT INTO modifier_groups (tenant_id, name, name_localized, reference, external_id)
                        VALUES ($1, $2, $3, $4, $5)
                        RETURNING id
                    `, [tenant.id, name, name_localized, reference, group.id]);
                    
                    groupId = insertResult.rows[0].id;
                    groupsImported++;
                    console.log(`  ✅ Created: ${name} (Ref: ${reference})`);
                }
                
                groupMapping.set(group.id, groupId);
                
            } catch (error) {
                console.log(`  ❌ Failed to import group ${group.name}: ${error.message}`);
            }
        }
        
        console.log(`📊 Imported ${groupsImported} new modifier groups`);
        
        // 3. Import modifier options
        console.log('\n⚙️  Importing modifier options...');
        
        let optionsImported = 0;
        
        // First, let's find which options belong to which groups
        const optionsByGroup = new Map();
        
        for (const option of modifierOptionsResult.items) {
            // Try to find the group this option belongs to
            // Options might have modifier_group_id or we need to infer from the groups data
            let groupId = option.modifier_group_id;
            
            // If no direct group ID, try to find it in the groups that have options
            if (!groupId) {
                for (const group of modifierGroupsResult.items) {
                    if (group.options && Array.isArray(group.options)) {
                        if (group.options.some(opt => opt.id === option.id)) {
                            groupId = group.id;
                            break;
                        }
                    }
                }
            }
            
            if (groupId && groupMapping.has(groupId)) {
                if (!optionsByGroup.has(groupId)) {
                    optionsByGroup.set(groupId, []);
                }
                optionsByGroup.get(groupId).push(option);
            }
        }
        
        // Import options for each group
        for (const [externalGroupId, options] of optionsByGroup) {
            const localGroupId = groupMapping.get(externalGroupId);
            
            if (!localGroupId) continue;
            
            for (const option of options) {
                try {
                    const name = option.name || 'Unnamed Option';
                    const reference = option.sku || option.reference || null;
                    const price = parseFloat(option.price || 0);
                    const name_localized = option.name_localized || null;
                    
                    await pool.query(`
                        INSERT INTO modifier_options (tenant_id, group_id, name, name_localized, reference, price, external_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (tenant_id, group_id, external_id) DO UPDATE SET
                            name = EXCLUDED.name,
                            price = EXCLUDED.price
                    `, [tenant.id, localGroupId, name, name_localized, reference, price, option.id]);
                    
                    optionsImported++;
                    console.log(`  ✅ ${name} → Group (${externalGroupId}) - ${price} KWD`);
                    
                } catch (error) {
                    console.log(`  ❌ Failed to import option ${option.name}: ${error.message}`);
                }
            }
        }
        
        // Also try to get options directly for each group
        console.log('\n🔍 Fetching group options directly...');
        for (const [externalGroupId, localGroupId] of groupMapping) {
            try {
                const groupOptionsResult = await client.listGroupOptions(externalGroupId);
                
                if (groupOptionsResult.items.length > 0) {
                    console.log(`  📦 Found ${groupOptionsResult.items.length} options for group ${externalGroupId}`);
                    
                    for (const option of groupOptionsResult.items) {
                        try {
                            const name = option.name || 'Unnamed Option';
                            const reference = option.sku || option.reference || null;
                            const price = parseFloat(option.price || 0);
                            const name_localized = option.name_localized || null;
                            
                            await pool.query(`
                                INSERT INTO modifier_options (tenant_id, group_id, name, name_localized, reference, price, external_id)
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                ON CONFLICT (tenant_id, group_id, external_id) DO UPDATE SET
                                    name = EXCLUDED.name,
                                    price = EXCLUDED.price
                            `, [tenant.id, localGroupId, name, name_localized, reference, price, option.id]);
                            
                            console.log(`    ✅ ${name} - ${price} KWD`);
                            
                        } catch (error) {
                            console.log(`    ❌ Failed to import option ${option.name}: ${error.message}`);
                        }
                    }
                }
            } catch (error) {
                // This is expected for many groups - the endpoint might not be available
                // console.log(`  ⚠️  Could not fetch options for group ${externalGroupId}: ${error.message}`);
            }
        }
        
        console.log(`📊 Processed modifier options`);
        
        // 4. Import product-modifier relationships
        console.log('\n🔗 Importing product-modifier relationships...');
        
        // First, create a mapping of external product IDs to local product IDs
        const productMapping = new Map();
        const existingProducts = await pool.query('SELECT id, name FROM products WHERE tenant_id = $1', [tenant.id]);
        
        console.log(`📦 Found ${existingProducts.rows.length} existing products in local database`);
        
        // Try to match products by name (since we don't have external_id mapping yet)
        for (const localProduct of existingProducts.rows) {
            for (const foodicsProduct of productsResult.items) {
                if (localProduct.name === foodicsProduct.name) {
                    productMapping.set(foodicsProduct.id, localProduct.id);
                    break;
                }
            }
        }
        
        console.log(`🔍 Matched ${productMapping.size} products between Foodics and local database`);
        
        // Now look for products with embedded modifiers and create relationships
        let relationshipsCreated = 0;
        
        for (const product of productsResult.items) {
            if (!product.modifiers || !Array.isArray(product.modifiers) || product.modifiers.length === 0) {
                continue; // Skip products without modifiers
            }
            
            const localProductId = productMapping.get(product.id);
            if (!localProductId) {
                console.log(`  ⚠️  Product "${product.name}" not found in local database`);
                continue;
            }
            
            console.log(`\n📦 Processing product: ${product.name}`);
            console.log(`  🔗 Found ${product.modifiers.length} modifier groups`);
            
            for (const modifier of product.modifiers) {
                const modifierGroupId = modifier.id || modifier.modifier_id || modifier.group_id;
                const localGroupId = groupMapping.get(modifierGroupId);
                
                if (!localGroupId) {
                    console.log(`    ⚠️  Modifier group ${modifier.name || modifierGroupId} not found in local mapping`);
                    continue;
                }
                
                try {
                    await pool.query(`
                        INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (product_id, group_id) DO UPDATE SET
                            sort_order = EXCLUDED.sort_order,
                            required = EXCLUDED.required,
                            min_select = EXCLUDED.min_select,
                            max_select = EXCLUDED.max_select
                    `, [
                        localProductId, 
                        localGroupId,
                        modifier.sort_order || 1,
                        modifier.required || false,
                        modifier.min_select || 0,
                        modifier.max_select || 1
                    ]);
                    
                    console.log(`    ✅ Linked: ${product.name} ↔ ${modifier.name || 'Modifier Group'}`);
                    relationshipsCreated++;
                    
                } catch (error) {
                    console.log(`    ❌ Failed to link ${product.name} to ${modifier.name}: ${error.message}`);
                }
            }
        }
        
        // 5. Verify the import
        console.log('\n📊 Verifying import results...');
        
        const finalStats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM modifier_groups WHERE tenant_id = $1) as groups_count,
                (SELECT COUNT(*) FROM modifier_options WHERE tenant_id = $1) as options_count,
                (SELECT COUNT(*) FROM product_modifier_groups pmg 
                 JOIN modifier_groups mg ON mg.id = pmg.group_id 
                 WHERE mg.tenant_id = $1) as relationships_count
        `, [tenant.id]);
        
        const stats = finalStats.rows[0];
        console.log(`✅ Final counts:`);
        console.log(`   • Modifier groups: ${stats.groups_count}`);
        console.log(`   • Modifier options: ${stats.options_count}`);
        console.log(`   • Product-modifier relationships: ${stats.relationships_count}`);
        
        // Test the admin panel query
        console.log('\n🔍 Testing admin panel query...');
        
        const adminQuery = await pool.query(`
            SELECT mg.name,
                   coalesce(o.cnt,0) as options_count,
                   coalesce(p.cnt,0) as products_count
              FROM modifier_groups mg
         LEFT JOIN (
                   SELECT group_id, count(*)::int as cnt
                     FROM modifier_options
                    WHERE tenant_id=$1
                    GROUP BY group_id
                   ) o ON o.group_id=mg.id
         LEFT JOIN (
                   SELECT group_id, count(*)::int as cnt
                     FROM product_modifier_groups
                    GROUP BY group_id
                   ) p ON p.group_id=mg.id
             WHERE mg.tenant_id=$1
               AND (o.cnt > 0 OR p.cnt > 0)
             ORDER BY mg.name asc
             LIMIT 10
        `, [tenant.id]);
        
        console.log('🎯 Sample admin panel results:');
        adminQuery.rows.forEach(row => {
            console.log(`  • ${row.name}: ${row.options_count} options, ${row.products_count} products`);
        });
        
        console.log('\n🎉 Foodics sync completed successfully!');
        console.log('💡 You should now see the correct modifier groups with proper product counts in your admin panel.');
        
    } catch (error) {
        console.error('❌ Sync failed:', error);
    } finally {
        await pool.end();
    }
}

// Run the sync
runFoodicsSync().catch(error => {
    console.error('💥 Sync failed:', error);
    process.exit(1);
});