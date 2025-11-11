#!/usr/bin/env node
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe

async function importProducts() {
  try {
    console.log('🚀 Importing Foodics products for Koobs Cafe\n');
    
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    let page = 1;
    let totalImported = 0;
    let totalSkipped = 0;
    const perPage = 100;
    
    const startTime = Date.now();
    
    while (true) {
      console.log(`📦 Fetching page ${page}...`);
      
      const response = await fetch(
        `https://api.foodics.com/v5/products?per_page=${perPage}&page=${page}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        console.log('✅ No more products\n');
        break;
      }
      
      const products = data.data;
      
      // Import products
      for (const product of products) {
        try {
          const res = await pool.query(`
            INSERT INTO saas.foodics_products (
              tenant_id, id, name, name_localized, description, description_localized,
              sku, barcode, image, price, cost, category_id,
              is_active, is_ready, is_stock_product, meta,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
            ON CONFLICT (tenant_id, id) 
            DO UPDATE SET
              name = EXCLUDED.name,
              name_localized = EXCLUDED.name_localized,
              description = EXCLUDED.description,
              sku = EXCLUDED.sku,
              barcode = EXCLUDED.barcode,
              image = EXCLUDED.image,
              price = EXCLUDED.price,
              cost = EXCLUDED.cost,
              category_id = EXCLUDED.category_id,
              is_active = EXCLUDED.is_active,
              is_ready = EXCLUDED.is_ready,
              updated_at = EXCLUDED.updated_at,
              synced_at = NOW()
          `, [
            TENANT_ID,
            product.id,
            product.name,
            JSON.stringify(product.name_localized || {}),
            product.description,
            JSON.stringify(product.description_localized || {}),
            product.sku,
            product.barcode,
            product.image?.url || product.image || null,
            product.price,
            product.cost,
            product.category_id,
            product.is_active !== false,
            product.is_ready !== false,
            product.is_stock_product === true,
            JSON.stringify(product),
            product.created_at,
            product.updated_at
          ]);
          
          if (res.rowCount > 0) totalImported++;
          else totalSkipped++;
        } catch (err) {
          console.error(`   ❌ Error importing ${product.name}:`, err.message);
        }
      }
      
      console.log(`   ✅ Imported ${products.length} products (${totalImported} new, ${totalSkipped} updated)\n`);
      
      // Check pagination
      if (data.meta && data.meta.current_page >= data.meta.last_page) {
        console.log('✅ Reached last page\n');
        break;
      }
      
      page++;
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('═'.repeat(60));
    console.log('📊 Import Complete!');
    console.log('═'.repeat(60));
    console.log(`  Total products: ${totalImported + totalSkipped}`);
    console.log(`  Time:           ${totalTime}s`);
    
    // Show sample products
    const samples = await pool.query(`
      SELECT name, sku, price, image, category_id
      FROM saas.foodics_products
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [TENANT_ID]);
    
    console.log('\n📦 Sample products:');
    samples.rows.forEach(p => {
      console.log(`  - ${p.name} (${p.sku || 'no sku'}) - ${p.price} KWD`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

importProducts();
