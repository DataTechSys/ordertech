#!/usr/bin/env node

// Script to manually create product-modifier relationships for testing
// This will create the necessary tables and relationships locally

const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: 'postgres://ordertech:ordertech@127.0.0.1:5432/ordertech'
});

async function createTestRelationships() {
    try {
        console.log('🔧 Creating test product-modifier relationships...\n');
        
        // Find Koobs tenant
        const tenants = await pool.query('SELECT id, name FROM tenants WHERE name ILIKE $1', ['%koobs%']);
        if (tenants.rows.length === 0) {
            console.log('❌ No Koobs tenant found');
            return;
        }
        
        const tenant = tenants.rows[0];
        console.log(`✅ Found tenant: ${tenant.name} (ID: ${tenant.id})`);
        
        // 1. Create modifier tables
        console.log('\n📋 Creating modifier tables...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS modifier_groups (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                name text NOT NULL,
                reference text,
                min_select integer,
                max_select integer,
                required boolean NOT NULL DEFAULT false,
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE(tenant_id, reference)
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS modifier_options (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
                name text NOT NULL,
                price numeric(10,3) NOT NULL DEFAULT 0,
                is_active boolean NOT NULL DEFAULT true,
                sort_order integer,
                created_at timestamptz NOT NULL DEFAULT now()
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_modifier_groups (
                product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                group_id   uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
                sort_order integer,
                required   boolean,
                min_select integer,
                max_select integer,
                PRIMARY KEY (product_id, group_id)
            )
        `);
        
        console.log('✅ Tables created successfully');
        
        // 2. Create a test modifier group
        console.log('\n🏷️  Creating test modifier group...');
        
        const groupResult = await pool.query(`
            INSERT INTO modifier_groups (tenant_id, name, reference, min_select, max_select, required)
            VALUES ($1, 'Milk Options', 'milk_test', 0, 1, false)
            RETURNING id, name
        `, [tenant.id]);
        
        const group = groupResult.rows[0];
        console.log(`✅ Created modifier group: ${group.name} (ID: ${group.id})`);
        
        // 3. Create test modifier options
        console.log('\n⚙️  Creating test modifier options...');
        
        const milkOptions = [
            { name: 'Full Fat Milk', price: 0 },
            { name: 'Low Fat Milk', price: 0 },
            { name: 'Almond Milk', price: 0.5 },
            { name: 'Oat Milk', price: 0.5 },
            { name: 'Coconut Milk', price: 0.5 }
        ];
        
        for (const option of milkOptions) {
            await pool.query(`
                INSERT INTO modifier_options (tenant_id, group_id, name, price)
                VALUES ($1, $2, $3, $4)
            `, [tenant.id, group.id, option.name, option.price]);
            
            console.log(`  • Added ${option.name} (${option.price} KWD)`);
        }
        
        // 4. Find products with "matcha" in the name
        console.log('\n📦 Finding Matcha products...');
        
        const products = await pool.query(`
            SELECT id, name 
            FROM products 
            WHERE tenant_id = $1 AND name ILIKE '%matcha%'
        `, [tenant.id]);
        
        console.log(`✅ Found ${products.rows.length} products with "matcha":`);
        products.rows.forEach(p => console.log(`  • ${p.name} (ID: ${p.id})`));
        
        // 5. Create relationships for Matcha products
        console.log('\n🔗 Creating product-modifier relationships...');
        
        let relationshipCount = 0;
        for (const product of products.rows) {
            try {
                await pool.query(`
                    INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                    VALUES ($1, $2, 1, false, 0, 1)
                    ON CONFLICT (product_id, group_id) DO NOTHING
                `, [product.id, group.id]);
                
                console.log(`  ✅ Linked: ${product.name} ↔ ${group.name}`);
                relationshipCount++;
            } catch (error) {
                console.log(`  ❌ Failed to link ${product.name}: ${error.message}`);
            }
        }
        
        // 6. Also link a few other popular drinks
        console.log('\n☕ Finding other coffee products...');
        
        const coffeeProducts = await pool.query(`
            SELECT id, name 
            FROM products 
            WHERE tenant_id = $1 AND (
                name ILIKE '%latte%' OR 
                name ILIKE '%cappuccino%' OR 
                name ILIKE '%americano%'
            )
            LIMIT 5
        `, [tenant.id]);
        
        console.log(`✅ Found ${coffeeProducts.rows.length} coffee products:`);
        
        for (const product of coffeeProducts.rows) {
            try {
                await pool.query(`
                    INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select)
                    VALUES ($1, $2, 1, false, 0, 1)
                    ON CONFLICT (product_id, group_id) DO NOTHING
                `, [product.id, group.id]);
                
                console.log(`  ✅ Linked: ${product.name} ↔ ${group.name}`);
                relationshipCount++;
            } catch (error) {
                console.log(`  ❌ Failed to link ${product.name}: ${error.message}`);
            }
        }
        
        // 7. Verify the relationships
        console.log('\n📊 Verifying relationships...');
        
        const verification = await pool.query(`
            SELECT COUNT(*) as count
            FROM product_modifier_groups pmg
            JOIN modifier_groups mg ON mg.id = pmg.group_id
            WHERE mg.tenant_id = $1
        `, [tenant.id]);
        
        console.log(`✅ Total relationships created: ${verification.rows[0].count}`);
        
        // 8. Test the admin panel query
        console.log('\n🔍 Testing admin panel query...');
        
        const adminQuery = await pool.query(`
            SELECT mg.id,
                   mg.tenant_id,
                   mg.name,
                   mg.reference,
                   mg.min_select,
                   mg.max_select,
                   mg.required,
                   mg.created_at,
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
             ORDER BY mg.name asc
        `, [tenant.id]);
        
        console.log('🎯 Admin panel query results:');
        adminQuery.rows.forEach(row => {
            console.log(`  • ${row.name}: ${row.options_count} options, ${row.products_count} products`);
        });
        
        console.log('\n🎉 Test relationships created successfully!');
        console.log('\n💡 Next steps:');
        console.log('   1. Open your admin panel and check the modifier groups');
        console.log('   2. Edit a product (like ICED | Matcha) to see the modifiers');
        console.log('   3. Test the product ordering flow with modifiers');
        console.log('   4. If everything works, configure proper relationships in Foodics');
        
    } catch (error) {
        console.error('❌ Error creating test relationships:', error);
    } finally {
        await pool.end();
    }
}

// Run the script
createTestRelationships().catch(error => {
    console.error('💥 Script failed:', error);
    process.exit(1);
});