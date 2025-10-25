#!/usr/bin/env node

// Fixed Foodics sync script that works with current database schema
// This will import all modifier groups, options, and try to match them manually

const fs = require('fs');
const path = require('path');

// Set up the database connection
process.env.DATABASE_URL = 'postgres://ordertech:ordertech@127.0.0.1:5432/ordertech';

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

async function runFixedFoodicsSync() {
    try {
        console.log('🚀 Starting fixed Foodics sync...\n');
        
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
        
        // 2. Import modifier groups (without name_localized)
        console.log('\n🏷️  Importing modifier groups...');
        
        const groupMapping = new Map(); // external_id -> local_id
        let groupsImported = 0;
        
        for (const group of modifierGroupsResult.items) {
            try {
                const name = group.name || 'Unnamed Group';
                const reference = group.reference || group.id;
                
                // Check if group already exists by reference
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
                        INSERT INTO modifier_groups (tenant_id, name, reference)
                        VALUES ($1, $2, $3)
                        RETURNING id
                    `, [tenant.id, name, reference]);
                    
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
        
        // 3. Import modifier options to groups we can match
        console.log('\n⚙️  Importing modifier options...');
        
        let optionsImported = 0;
        
        // Get options for each group individually
        for (const [externalGroupId, localGroupId] of groupMapping) {
            try {
                console.log(`\n  📦 Processing group: ${externalGroupId}`);
                const groupOptionsResult = await client.listGroupOptions(externalGroupId);
                
                if (groupOptionsResult.items.length > 0) {
                    console.log(`    Found ${groupOptionsResult.items.length} options`);
                    
                    for (const option of groupOptionsResult.items) {
                        try {
                            const name = option.name || 'Unnamed Option';
                            const reference = option.sku || option.reference || null;
                            const price = parseFloat(option.price || 0);
                            
                            await pool.query(`
                                INSERT INTO modifier_options (tenant_id, group_id, name, reference, price)
                                VALUES ($1, $2, $3, $4, $5)
                                ON CONFLICT DO NOTHING
                            `, [tenant.id, localGroupId, name, reference, price]);
                            
                            console.log(`      ✅ ${name} - ${price} KWD`);
                            optionsImported++;
                            
                        } catch (error) {
                            console.log(`      ❌ Failed to import option ${option.name}: ${error.message}`);
                        }
                    }
                } else {
                    console.log(`    No options found`);
                }
            } catch (error) {
                console.log(`    ⚠️  Could not fetch options for group ${externalGroupId}: ${error.message}`);
            }
        }
        
        console.log(`📊 Imported ${optionsImported} modifier options`);
        
        // 4. Now let's manually create some logical relationships
        // Since the API doesn't provide product-modifier relationships,
        // we'll create some based on product names and modifier group names
        console.log('\n🔗 Creating logical product-modifier relationships...');
        
        // Get existing products
        const existingProducts = await pool.query('SELECT id, name FROM products WHERE tenant_id = $1', [tenant.id]);
        console.log(`📦 Found ${existingProducts.rows.length} products in local database`);
        
        // Get available modifier groups
        const availableGroups = await pool.query('SELECT id, name, reference FROM modifier_groups WHERE tenant_id = $1', [tenant.id]);
        console.log(`🏷️  Found ${availableGroups.rows.length} modifier groups in local database`);
        
        let relationshipsCreated = 0;
        
        // Create some logical relationships based on product types
        for (const product of existingProducts.rows) {
            const productName = product.name.toLowerCase();
            
            // Coffee and tea products -> milk options
            if (productName.includes('coffee') || 
                productName.includes('latte') || 
                productName.includes('cappuccino') || 
                productName.includes('americano') ||
                productName.includes('espresso') ||
                productName.includes('matcha') ||
                productName.includes('tea')) {
                
                // Find milk-related modifier groups
                const milkGroups = availableGroups.rows.filter(g => 
                    g.name.toLowerCase().includes('milk') ||
                    g.name.toLowerCase().includes('pro | milk') ||
                    g.name.toLowerCase().includes('milk | medium') ||
                    g.name.toLowerCase().includes('milk | large')
                );
                
                for (const group of milkGroups.slice(0, 2)) { // Limit to 2 milk groups per product
                    try {
                        await pool.query(`
                            INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (product_id, group_id) DO NOTHING
                        `, [product.id, group.id, 1, false, 0, 1]);
                        
                        console.log(`  ✅ Linked: ${product.name} ↔ ${group.name}`);
                        relationshipsCreated++;
                        
                    } catch (error) {
                        console.log(`  ❌ Failed to link ${product.name} to ${group.name}: ${error.message}`);
                    }
                }
                
                // Also add coffee shots for espresso-based drinks
                if (productName.includes('latte') || productName.includes('cappuccino')) {
                    const shotGroups = availableGroups.rows.filter(g => 
                        g.name.toLowerCase().includes('shot') || 
                        g.name.toLowerCase().includes('espresso')
                    );
                    
                    for (const group of shotGroups.slice(0, 1)) {
                        try {
                            await pool.query(`
                                INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                                VALUES ($1, $2, $3, $4, $5, $6)
                                ON CONFLICT (product_id, group_id) DO NOTHING
                            `, [product.id, group.id, 2, false, 0, 2]);
                            
                            console.log(`  ✅ Linked: ${product.name} ↔ ${group.name}`);
                            relationshipsCreated++;
                            
                        } catch (error) {
                            console.log(`  ❌ Failed to link ${product.name} to ${group.name}: ${error.message}`);
                        }
                    }
                }
            }
            
            // Delivery products -> delivery options
            if (availableGroups.rows.some(g => g.name.toLowerCase().includes('delivery'))) {
                const deliveryGroups = availableGroups.rows.filter(g => 
                    g.name.toLowerCase().includes('delivery')
                );
                
                for (const group of deliveryGroups.slice(0, 1)) {
                    try {
                        await pool.query(`
                            INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (product_id, group_id) DO NOTHING
                        `, [product.id, group.id, 3, false, 0, 1]);
                        
                        console.log(`  ✅ Linked: ${product.name} ↔ ${group.name}`);
                        relationshipsCreated++;
                        
                    } catch (error) {
                        console.log(`  ❌ Failed to link ${product.name} to ${group.name}: ${error.message}`);
                    }
                }
            }
        }
        
        // 5. Verify the import
        console.log('\n📊 Verifying final results...');
        
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
             LIMIT 15
        `, [tenant.id]);
        
        console.log('🎯 Admin panel query results:');
        adminQuery.rows.forEach(row => {
            console.log(`  • ${row.name}: ${row.options_count} options, ${row.products_count} products`);
        });
        
        console.log('\n🎉 Fixed Foodics sync completed successfully!');
        console.log('💡 You should now see modifier groups with proper product counts in your admin panel.');
        console.log('💡 If you need more precise relationships, you can manually link products to groups in the admin panel.');
        
    } catch (error) {
        console.error('❌ Sync failed:', error);
    } finally {
        await pool.end();
    }
}

// Run the sync
runFixedFoodicsSync().catch(error => {
    console.error('💥 Sync failed:', error);
    process.exit(1);
});