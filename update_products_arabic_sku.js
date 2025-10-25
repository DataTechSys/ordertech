#!/usr/bin/env node

// Update existing products with SKUs and Arabic names from Foodics
// Match by product name, then update with SKU and name_localized

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

async function updateProductsWithArabicAndSKU() {
    try {
        console.log('🚀 Updating existing products with Arabic names and SKUs from Foodics...\n');
        
        // Find Koobs tenant
        const tenantResult = await pool.query('SELECT id, name FROM tenants WHERE name ILIKE $1', ['%koobs%']);
        if (tenantResult.rows.length === 0) {
            console.log('❌ No Koobs tenant found');
            return;
        }
        
        const tenant = tenantResult.rows[0];
        console.log(`✅ Found tenant: ${tenant.name} (ID: ${tenant.id})`);
        
        // Get all local products
        const localProducts = await pool.query(
            'SELECT id, name, sku, name_localized FROM products WHERE tenant_id = $1',
            [tenant.id]
        );
        
        console.log(`📍 Found ${localProducts.rows.length} local products`);
        
        // Get all Foodics products
        console.log('\n📡 Fetching products from Foodics...');
        const client = makeClient(FOODICS_TOKEN);
        const foodicsResult = await client.listProducts();
        
        console.log(`✅ Found ${foodicsResult.items.length} Foodics products`);
        
        // Create lookup map by name for Foodics products
        const foodicsMap = new Map();
        foodicsResult.items.forEach(p => {
            if (p.name) {
                foodicsMap.set(p.name.trim(), p);
            }
        });
        
        console.log('\n🔄 Processing product updates...');
        
        let updated = 0;
        let withArabic = 0;
        let withSKU = 0;
        let notFound = 0;
        
        for (const localProduct of localProducts.rows) {
            const foodicsProduct = foodicsMap.get(localProduct.name.trim());
            
            if (!foodicsProduct) {
                notFound++;
                console.log(`  ⚠️  No Foodics match for: ${localProduct.name}`);
                continue;
            }
            
            // Prepare update data
            const updates = [];
            const params = [];
            let paramIndex = 1;
            
            // Update SKU if available
            if (foodicsProduct.sku && !localProduct.sku) {
                updates.push(`sku = $${paramIndex++}`);
                params.push(foodicsProduct.sku);
                withSKU++;
            }
            
            // Update Arabic name if available
            if (foodicsProduct.name_localized && !localProduct.name_localized) {
                updates.push(`name_localized = $${paramIndex++}`);
                params.push(foodicsProduct.name_localized);
                withArabic++;
            }
            
            // Update description_localized if available
            if (foodicsProduct.description_localized) {
                updates.push(`description_localized = $${paramIndex++}`);
                params.push(foodicsProduct.description_localized);
            }
            
            // Update price if available
            if (foodicsProduct.price) {
                updates.push(`price = $${paramIndex++}`);
                params.push(parseFloat(foodicsProduct.price));
            }
            
            if (updates.length > 0) {
                // Add WHERE clause parameters
                params.push(tenant.id, localProduct.id);
                
                const sql = `
                    UPDATE products SET ${updates.join(', ')} 
                    WHERE tenant_id = $${paramIndex++} AND id = $${paramIndex++}
                `;
                
                await pool.query(sql, params);
                updated++;
                
                const arabicPart = foodicsProduct.name_localized ? ` → ${foodicsProduct.name_localized}` : '';
                const skuPart = foodicsProduct.sku ? ` [SKU: ${foodicsProduct.sku}]` : '';
                console.log(`  ✅ Updated: ${localProduct.name}${arabicPart}${skuPart}`);
            }
        }
        
        // Final verification
        console.log('\n📊 Update Summary:');
        console.log(`   • Products processed: ${localProducts.rows.length}`);
        console.log(`   • Products updated: ${updated}`);
        console.log(`   • Products with new Arabic names: ${withArabic}`);
        console.log(`   • Products with new SKUs: ${withSKU}`);
        console.log(`   • Products not found in Foodics: ${notFound}`);
        
        // Check final database state
        const finalStats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(name_localized) as with_arabic,
                COUNT(sku) as with_sku
            FROM products 
            WHERE tenant_id = $1
        `, [tenant.id]);
        
        const stat = finalStats.rows[0];
        console.log('\n🎯 Final Database State:');
        console.log(`   • Total products: ${stat.total}`);
        console.log(`   • Products with Arabic names: ${stat.with_arabic}`);
        console.log(`   • Products with SKUs: ${stat.with_sku}`);
        
        // Show some examples
        const examples = await pool.query(`
            SELECT name, name_localized, sku 
            FROM products 
            WHERE tenant_id = $1 AND name_localized IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT 5
        `, [tenant.id]);
        
        if (examples.rows.length > 0) {
            console.log('\n✨ Sample updated products:');
            examples.rows.forEach((row, i) => {
                console.log(`   ${i + 1}. ${row.name} → ${row.name_localized} [${row.sku}]`);
            });
        }
        
        console.log('\n🎉 Arabic names and SKUs update completed successfully!');
        
    } catch (error) {
        console.error('❌ Update failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

// Run the update
updateProductsWithArabicAndSKU().catch(error => {
    console.error('💥 Update failed:', error);
    process.exit(1);
});