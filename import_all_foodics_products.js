#!/usr/bin/env node

// Import ALL products from Foodics with Arabic localization
// This will create new products that don't exist locally

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { makeClient } = require('./server/integrations/foodics.js');

// Database connection
const pool = new Pool({ 
    connectionString: 'postgres://ordertech:ordertech@127.0.0.1:5432/ordertech'
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

async function importAllFoodicsProducts() {
    try {
        console.log('🚀 Importing ALL Foodics products with Arabic localization...\n');
        
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
        
        // Fetch products and categories
        console.log('\n📡 Fetching data from Foodics...');
        const [productsResult, categoriesResult] = await Promise.all([
            client.listProducts(),
            client.listCategories()
        ]);
        
        console.log(`✅ Products: ${productsResult.items.length}`);
        console.log(`✅ Categories: ${categoriesResult.items.length}`);
        
        // First, ensure we have categories
        console.log('\n📂 Processing categories...');
        const categoryMapping = new Map(); // foodics_id -> local_id
        
        for (const cat of categoriesResult.items) {
            const name = cat.name || 'Unnamed Category';
            const name_localized = cat.name_localized || cat.name_ar || null;
            const reference = cat.reference || cat.id;
            
            // Check if category exists
            const existing = await pool.query(
                'SELECT id FROM categories WHERE tenant_id = $1 AND name = $2',
                [tenant.id, name]
            );
            
            let categoryId;
            if (existing.rows.length > 0) {
                categoryId = existing.rows[0].id;
            } else {
                const newCategoryId = require('crypto').randomUUID();
                const insertResult = await pool.query(`
                    INSERT INTO categories (id, tenant_id, name, name_localized, reference)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                `, [newCategoryId, tenant.id, name, name_localized, reference]);
                
                categoryId = insertResult.rows[0].id;
                console.log(`  ✅ Created category: ${name}${name_localized ? ' → ' + name_localized : ''}`);
            }
            
            categoryMapping.set(cat.id, categoryId);
        }
        
        // Now import products with Arabic names
        console.log('\n📦 Processing products with Arabic localization...');
        let created = 0;
        let updated = 0;
        let withArabic = 0;
        
        for (const product of productsResult.items) {
            try {
                const name = product.name || 'Unnamed Product';
                const name_localized = product.name_localized || product.name_ar || null;
                const description = product.description || null;
                const description_localized = product.description_localized || null;
                const price = parseFloat(product.price || 0);
                const sku = product.sku || product.reference || product.id;
                const barcode = product.barcode || null;
                const image_url = product.image || null;
                const active = product.is_active !== false;
                
                // Find category
                const categoryId = categoryMapping.get(product.category_id);
                if (!categoryId) {
                    console.log(`  ⚠️  Skipping ${name} - no category found`);
                    continue;
                }
                
                if (name_localized) withArabic++;
                
                // Check if product exists
                const existing = await pool.query(
                    'SELECT id FROM products WHERE tenant_id = $1 AND name = $2',
                    [tenant.id, name]
                );
                
                if (existing.rows.length > 0) {
                    // Update existing product with localization
                    await pool.query(`
                        UPDATE products SET
                            name_localized = $1,
                            description_localized = $2,
                            price = $3,
                            image_url = COALESCE($4, image_url),
                            active = $5
                        WHERE tenant_id = $6 AND name = $7
                    `, [name_localized, description_localized, price, image_url, active, tenant.id, name]);
                    
                    updated++;
                    if (name_localized) {
                        console.log(`  📝 Updated: ${name} → ${name_localized}`);
                    }
                } else {
                    // Create new product
                    const newId = require('crypto').randomUUID();
                    await pool.query(`
                        INSERT INTO products (
                            id, tenant_id, name, name_localized, description, description_localized,
                            category_id, price, sku, barcode, image_url, active, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                    `, [newId, tenant.id, name, name_localized, description, description_localized,
                        categoryId, price, sku, barcode, image_url, active]);
                    
                    created++;
                    if (name_localized) {
                        console.log(`  ✅ Created: ${name} → ${name_localized}`);
                    } else {
                        console.log(`  ✅ Created: ${name} (no Arabic name)`);
                    }
                }
                
            } catch (error) {
                console.log(`  ❌ Error processing ${product.name}: ${error.message}`);
            }
        }
        
        // Final stats
        console.log('\n📊 Import Summary:');
        console.log(`   • Products created: ${created}`);
        console.log(`   • Products updated: ${updated}`);
        console.log(`   • Products with Arabic names: ${withArabic}`);
        
        // Verify results
        const finalStats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(name_localized) as with_arabic
            FROM products 
            WHERE tenant_id = $1
        `, [tenant.id]);
        
        const stat = finalStats.rows[0];
        console.log('\n🎯 Database Status After Import:');
        console.log(`   • Total products: ${stat.total}`);
        console.log(`   • Products with Arabic names: ${stat.with_arabic}`);
        
        // Show some examples
        const examples = await pool.query(`
            SELECT name, name_localized 
            FROM products 
            WHERE tenant_id = $1 AND name_localized IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 5
        `, [tenant.id]);
        
        if (examples.rows.length > 0) {
            console.log('\n✨ Sample products with Arabic names:');
            examples.rows.forEach((row, i) => {
                console.log(`   ${i+1}. ${row.name} → ${row.name_localized}`);
            });
        }
        
        console.log('\n🎉 Arabic product import completed successfully!');
        
    } catch (error) {
        console.error('❌ Import failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

// Run the import
importAllFoodicsProducts().catch(error => {
    console.error('💥 Import failed:', error);
    process.exit(1);
});