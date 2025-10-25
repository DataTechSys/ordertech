#!/usr/bin/env node

// Fixed script to recreate Foodics relationships without reference column

const { Pool } = require('pg');

const pool = new Pool({ 
    connectionString: 'postgres://ordertech:ordertech@127.0.0.1:5432/ordertech'
});

async function recreateFoodicsRelationshipsFixed() {
    try {
        console.log('🚀 Recreating Foodics product-modifier relationships (fixed)...\n');
        
        // Find Koobs tenant
        const tenantResult = await pool.query('SELECT id, name FROM tenants WHERE name ILIKE $1', ['%koobs%']);
        if (tenantResult.rows.length === 0) {
            console.log('❌ No Koobs tenant found');
            return;
        }
        
        const tenant = tenantResult.rows[0];
        console.log(`✅ Found tenant: ${tenant.name} (ID: ${tenant.id})`);
        
        // 1. Get all products and modifier groups
        const products = await pool.query('SELECT id, name FROM products WHERE tenant_id = $1 ORDER BY name', [tenant.id]);
        const modifierGroups = await pool.query('SELECT id, name, reference FROM modifier_groups WHERE tenant_id = $1 ORDER BY name', [tenant.id]);
        
        console.log(`\n📦 Found ${products.rows.length} products`);
        console.log(`🏷️  Found ${modifierGroups.rows.length} modifier groups`);
        
        // List some key groups
        console.log('\n🔍 Key modifier groups available:');
        modifierGroups.rows.slice(0, 10).forEach(g => {
            console.log(`  • ${g.name} (Ref: ${g.reference})`);
        });
        
        // 2. Create modifier options for key groups (without reference column)
        console.log('\n⚙️  Creating modifier options...');
        
        // Find the Pro | Milk group
        const proMilkGroup = modifierGroups.rows.find(g => g.reference === 'pro_milk' || g.name.includes('Pro | Milk'));
        
        if (proMilkGroup) {
            console.log(`\n📋 Adding options to: ${proMilkGroup.name}`);
            
            const milkOptions = [
                { name: 'Extra | Sweet Milk', price: 0 },
                { name: 'Japan Milk', price: 0 },
                { name: 'LF Milk', price: 0 },
                { name: 'FF Sweet Milk', price: 0 },
                { name: 'Barista FF Milk', price: 0 },
                { name: 'Lactose Free Milk', price: 0 },
                { name: 'Almond Milk', price: 0.2 },
                { name: 'Soya Milk', price: 0.2 },
                { name: 'Coconut Milk', price: 0.2 },
                { name: 'Oat Milk', price: 0.2 }
            ];
            
            // Clear existing options for this group first
            await pool.query('DELETE FROM modifier_options WHERE group_id = $1', [proMilkGroup.id]);
            
            for (const option of milkOptions) {
                try {
                    await pool.query(`
                        INSERT INTO modifier_options (tenant_id, group_id, name, price, is_active)
                        VALUES ($1, $2, $3, $4, true)
                    `, [tenant.id, proMilkGroup.id, option.name, option.price]);
                    
                    console.log(`  ✅ ${option.name} - ${option.price} KWD`);
                } catch (error) {
                    console.log(`  ❌ Failed to add ${option.name}: ${error.message}`);
                }
            }
        }
        
        // Find Extra group and add options
        const extraGroup = modifierGroups.rows.find(g => g.reference === 'extra' || g.name.includes('Extra'));
        if (extraGroup) {
            console.log(`\n📋 Adding options to: ${extraGroup.name}`);
            
            // Clear existing options for this group first
            await pool.query('DELETE FROM modifier_options WHERE group_id = $1', [extraGroup.id]);
            
            const extraOptions = [
                { name: 'Extra Shot', price: 0.5 },
                { name: 'Extra Hot', price: 0 },
                { name: 'Extra Sweet', price: 0 }
            ];
            
            for (const option of extraOptions) {
                try {
                    await pool.query(`
                        INSERT INTO modifier_options (tenant_id, group_id, name, price, is_active)
                        VALUES ($1, $2, $3, $4, true)
                    `, [tenant.id, extraGroup.id, option.name, option.price]);
                    
                    console.log(`  ✅ ${option.name} - ${option.price} KWD`);
                } catch (error) {
                    console.log(`  ❌ Failed to add ${option.name}: ${error.message}`);
                }
            }
        }
        
        // Find Delivery group and add options
        const deliveryGroup = modifierGroups.rows.find(g => g.reference === 'delivery' || g.name.includes('Delivery'));
        if (deliveryGroup) {
            console.log(`\n📋 Adding options to: ${deliveryGroup.name}`);
            
            // Clear existing options for this group first
            await pool.query('DELETE FROM modifier_options WHERE group_id = $1', [deliveryGroup.id]);
            
            const deliveryOptions = [
                { name: 'Standard Delivery', price: 1.0 },
                { name: 'Express Delivery', price: 2.0 }
            ];
            
            for (const option of deliveryOptions) {
                try {
                    await pool.query(`
                        INSERT INTO modifier_options (tenant_id, group_id, name, price, is_active)
                        VALUES ($1, $2, $3, $4, true)
                    `, [tenant.id, deliveryGroup.id, option.name, option.price]);
                    
                    console.log(`  ✅ ${option.name} - ${option.price} KWD`);
                } catch (error) {
                    console.log(`  ❌ Failed to add ${option.name}: ${error.message}`);
                }
            }
        }
        
        // 3. Now create the specific relationships like in Foodics
        console.log('\n🔗 Creating specific product-modifier relationships (matching Foodics)...');
        
        let relationshipsCreated = 0;
        
        // Find Matcha products and link them properly
        const matchaProducts = products.rows.filter(p => 
            p.name.toLowerCase().includes('matcha') ||
            (p.name.toLowerCase().includes('vanilla') && p.name.toLowerCase().includes('almond'))
        );
        
        console.log(`\n🍵 Found ${matchaProducts.length} Matcha-related products:`);
        matchaProducts.forEach(p => console.log(`  • ${p.name}`));
        
        for (const product of matchaProducts) {
            // Add Extra modifier (matching your screenshot: min=0, max=2, free=0)
            if (extraGroup) {
                try {
                    await pool.query(`
                        INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (product_id, group_id) DO UPDATE SET
                            sort_order = EXCLUDED.sort_order,
                            required = EXCLUDED.required,
                            min_select = EXCLUDED.min_select,
                            max_select = EXCLUDED.max_select
                    `, [product.id, extraGroup.id, 1, false, 0, 2]);
                    
                    console.log(`  ✅ Linked: ${product.name} ↔ ${extraGroup.name} (min:0, max:2)`);
                    relationshipsCreated++;
                } catch (error) {
                    console.log(`  ❌ Failed to link ${product.name} to ${extraGroup.name}: ${error.message}`);
                }
            }
            
            // Add Delivery modifier (matching your screenshot: min=0, max=2, free=0)
            if (deliveryGroup) {
                try {
                    await pool.query(`
                        INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (product_id, group_id) DO UPDATE SET
                            sort_order = EXCLUDED.sort_order,
                            required = EXCLUDED.required,
                            min_select = EXCLUDED.min_select,
                            max_select = EXCLUDED.max_select
                    `, [product.id, deliveryGroup.id, 2, false, 0, 2]);
                    
                    console.log(`  ✅ Linked: ${product.name} ↔ ${deliveryGroup.name} (min:0, max:2)`);
                    relationshipsCreated++;
                } catch (error) {
                    console.log(`  ❌ Failed to link ${product.name} to ${deliveryGroup.name}: ${error.message}`);
                }
            }
        }
        
        // Add Pro | Milk to coffee products
        const coffeeProducts = products.rows.filter(p => {
            const name = p.name.toLowerCase();
            return name.includes('latte') || 
                   name.includes('cappuccino') || 
                   name.includes('americano') ||
                   name.includes('espresso') ||
                   name.includes('coffee') ||
                   name.includes('matcha');
        });
        
        console.log(`\n☕ Found ${coffeeProducts.length} coffee-related products`);
        
        for (const product of coffeeProducts) {
            // Add Pro | Milk modifier  
            if (proMilkGroup) {
                try {
                    await pool.query(`
                        INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (product_id, group_id) DO UPDATE SET
                            sort_order = EXCLUDED.sort_order,
                            required = EXCLUDED.required,
                            min_select = EXCLUDED.min_select,
                            max_select = EXCLUDED.max_select
                    `, [product.id, proMilkGroup.id, 0, false, 0, 1]);
                    
                    console.log(`  ✅ Linked: ${product.name} ↔ ${proMilkGroup.name} (min:0, max:1)`);
                    relationshipsCreated++;
                } catch (error) {
                    console.log(`  ❌ Failed to link ${product.name} to ${proMilkGroup.name}: ${error.message}`);
                }
            }
        }
        
        // 4. Verify the results
        console.log('\n📊 Verifying final setup...');
        
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
                   mg.reference,
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
             ORDER BY p.cnt desc, mg.name asc
             LIMIT 10
        `, [tenant.id]);
        
        console.log('🎯 Top modifier groups by product count:');
        adminQuery.rows.forEach(row => {
            console.log(`  • ${row.name} (${row.reference}): ${row.options_count} options, ${row.products_count} products`);
        });
        
        // Test specific product
        const testProduct = products.rows.find(p => p.name.toLowerCase().includes('matcha') || p.name.toLowerCase().includes('latte'));
        if (testProduct) {
            console.log(`\n🧪 Testing product: ${testProduct.name}`);
            
            const productModifiers = await pool.query(`
                SELECT mg.name, mg.reference, pmg.min_select, pmg.max_select, pmg.required,
                       coalesce(o.cnt, 0) as options_count
                  FROM product_modifier_groups pmg
                  JOIN modifier_groups mg ON mg.id = pmg.group_id
             LEFT JOIN (
                       SELECT group_id, count(*)::int as cnt
                         FROM modifier_options
                        WHERE tenant_id = $1
                        GROUP BY group_id
                       ) o ON o.group_id = mg.id
                 WHERE pmg.product_id = $2
                 ORDER BY pmg.sort_order, mg.name
            `, [tenant.id, testProduct.id]);
            
            console.log(`  Modifiers for this product (${productModifiers.rows.length}):`);
            productModifiers.rows.forEach(mod => {
                console.log(`    • ${mod.name}: ${mod.options_count} options (min:${mod.min_select}, max:${mod.max_select}, required:${mod.required})`);
            });
        }
        
        console.log('\n🎉 Recreation completed successfully!');
        console.log('💡 Now check your admin panel - products should have proper modifier groups with options.');
        console.log('💡 Test by editing a coffee or matcha product in the admin panel.');
        console.log('💡 The product edit page should now show modifier groups in the "Modifiers" tab.');
        
    } catch (error) {
        console.error('❌ Recreation failed:', error);
    } finally {
        await pool.end();
    }
}

// Run the recreation
recreateFoodicsRelationshipsFixed().catch(error => {
    console.error('💥 Recreation failed:', error);
    process.exit(1);
});