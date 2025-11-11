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

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function syncProducts() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    const token = result.rows[0].token;
    console.log('✓ Got API token\n');
    
    // Fetch all products from Foodics API
    let allProducts = [];
    let page = 1;
    const perPage = 50;
    
    console.log('Fetching products from Foodics API...');
    
    while (true) {
      const response = await fetch(
        `https://api.foodics.com/v5/products?per_page=${perPage}&page=${page}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.status !== 200) {
        console.error(`API error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const products = data.data || [];
      
      if (products.length === 0) {
        break;
      }
      
      console.log(`  Page ${page}: ${products.length} products`);
      allProducts.push(...products);
      
      page++;
      
      // Limit to prevent infinite loop
      if (page > 20) break;
      
      await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
    }
    
    console.log(`\nTotal fetched: ${allProducts.length} products\n`);
    console.log('Inserting into database...');
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    for (const prod of allProducts) {
      try {
        const result = await pool.query(`
          INSERT INTO saas.foodics_products (
            tenant_id, id, name, sku, image, price, cost, 
            category_id, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (tenant_id, id) DO UPDATE SET 
            name = $3,
            sku = $4,
            image = $5,
            price = $6,
            cost = $7,
            category_id = $8,
            is_active = $9,
            updated_at = $11
          RETURNING (xmax = 0) AS inserted
        `, [
          TENANT_ID,
          prod.id,
          prod.name,
          prod.sku,
          prod.image,
          prod.price ?? 0,
          prod.cost ?? 0,
          prod.category_id,
          prod.is_active,
          prod.created_at,
          prod.updated_at
        ]);
        
        if (result.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.error(`  Error on ${prod.name}:`, err.message);
        }
      }
    }
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Products Sync Complete!');
    console.log('═'.repeat(50));
    console.log(`  Inserted:  ${inserted}`);
    console.log(`  Updated:   ${updated}`);
    console.log(`  Errors:    ${errors}`);
    console.log('');
    
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

syncProducts();
