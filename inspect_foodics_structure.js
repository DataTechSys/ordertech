#!/usr/bin/env node

const { Pool } = require('pg');
const { makeClient } = require('./server/integrations/foodics.js');
const fs = require('fs');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function inspect() {
  try {
    console.log('🔍 Inspecting Foodics Data Structure\n');
    
    // Get token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    const client = makeClient(token);
    
    // Fetch recent orders (no filters to get latest)
    console.log('📦 Fetching sample orders...');
    const ordersResult = await client.listOrders({});
    
    console.log(`✅ Fetched ${ordersResult.items.length} orders\n`);
    
    if (ordersResult.items.length === 0) {
      console.log('❌ No orders found');
      await pool.end();
      return;
    }
    
    // Get first order
    const sampleOrder = ordersResult.items[0];
    
    console.log('📄 Sample Order Structure:\n');
    console.log(JSON.stringify(sampleOrder, null, 2));
    
    // Save to file
    fs.writeFileSync('foodics_order_sample.json', JSON.stringify(sampleOrder, null, 2));
    console.log('\n💾 Saved to foodics_order_sample.json');
    
    // Extract all top-level keys
    console.log('\n🔑 Top-level fields:');
    Object.keys(sampleOrder).sort().forEach(key => {
      const value = sampleOrder[key];
      const type = Array.isArray(value) ? 'array' : typeof value;
      console.log(`  - ${key}: ${type}`);
    });
    
    // If has items, show item structure
    if (sampleOrder.items && sampleOrder.items.length > 0) {
      console.log('\n📦 Sample Order Item Structure:');
      console.log(JSON.stringify(sampleOrder.items[0], null, 2));
      fs.writeFileSync('foodics_order_item_sample.json', JSON.stringify(sampleOrder.items[0], null, 2));
      
      console.log('\n🔑 Item fields:');
      Object.keys(sampleOrder.items[0]).sort().forEach(key => {
        const value = sampleOrder.items[0][key];
        const type = Array.isArray(value) ? 'array' : typeof value;
        console.log(`  - ${key}: ${type}`);
      });
    }
    
    // Fetch customers
    console.log('\n\n👥 Fetching sample customers...');
    const customersResult = await client.listCustomers({});
    console.log(`✅ Fetched ${customersResult.items.length} customers\n`);
    
    if (customersResult.items.length > 0) {
      const sampleCustomer = customersResult.items[0];
      console.log('👤 Sample Customer Structure:');
      console.log(JSON.stringify(sampleCustomer, null, 2));
      fs.writeFileSync('foodics_customer_sample.json', JSON.stringify(sampleCustomer, null, 2));
      
      console.log('\n🔑 Customer fields:');
      Object.keys(sampleCustomer).sort().forEach(key => {
        const value = sampleCustomer[key];
        const type = Array.isArray(value) ? 'array' : typeof value;
        console.log(`  - ${key}: ${type}`);
      });
    }
    
    // Fetch products
    console.log('\n\n🍔 Fetching sample products...');
    const productsResult = await client.listProducts();
    console.log(`✅ Fetched ${productsResult.items.length} products\n`);
    
    if (productsResult.items.length > 0) {
      const sampleProduct = productsResult.items[0];
      console.log('🍔 Sample Product Structure (first 50 lines):');
      const productJson = JSON.stringify(sampleProduct, null, 2);
      console.log(productJson.split('\n').slice(0, 50).join('\n'));
      fs.writeFileSync('foodics_product_sample.json', productJson);
      
      console.log('\n🔑 Product fields:');
      Object.keys(sampleProduct).sort().forEach(key => {
        const value = sampleProduct[key];
        const type = Array.isArray(value) ? 'array' : typeof value;
        console.log(`  - ${key}: ${type}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

inspect();
