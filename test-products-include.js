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

async function testProductsInclude() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    const token = result.rows[0].token;
    console.log('✓ Got API token\n');
    
    console.log('Fetching orders with include=products...\n');
    
    const response = await fetch(
      `https://api.foodics.com/v5/orders?per_page=3&include=products&sort=-created_at`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (response.status !== 200) {
      console.error('Failed:', response.status, response.statusText);
      await pool.end();
      return;
    }
    
    const data = await response.json();
    console.log(`✓ Fetched ${data.data.length} orders\n`);
    
    for (let i = 0; i < Math.min(3, data.data.length); i++) {
      const order = data.data[i];
      console.log('═'.repeat(70));
      console.log(`Order ${i + 1}: ${order.reference} - ${order.business_date}`);
      console.log(`Total: ${order.total_price} KWD`);
      console.log('═'.repeat(70));
      
      if (order.products) {
        console.log(`\n🎯 Products array found! Count: ${order.products.length}\n`);
        
        if (order.products.length > 0) {
          // Show first 2 products
          for (let j = 0; j < Math.min(2, order.products.length); j++) {
            const product = order.products[j];
            console.log(`Product ${j + 1}:`);
            console.log(JSON.stringify(product, null, 2));
            console.log('');
          }
          
          // Check what data we have
          const firstProduct = order.products[0];
          const hasOrderItemData = firstProduct.quantity !== undefined || 
                                   firstProduct.unit_price !== undefined ||
                                   firstProduct.total_price !== undefined;
          
          if (hasOrderItemData) {
            console.log('✅ THIS IS ORDER ITEM DATA! We can use this!\n');
          } else {
            console.log('⚠️  This is just product reference data, not order items\n');
          }
        }
      } else {
        console.log('❌ No products array in this order\n');
      }
    }
    
    await pool.end();
    
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

testProductsInclude();
