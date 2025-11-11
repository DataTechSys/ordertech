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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exploreAPI() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    const token = result.rows[0].token;
    console.log('✓ Got API token\n');
    
    // Get a recent order that should have items
    const orderResult = await pool.query(`
      SELECT id, reference, business_date
      FROM saas.foodics_orders
      WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
        AND business_date >= '2025-11-09'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    const order = orderResult.rows[0];
    console.log(`Testing with order: ${order.reference} (${order.id})\n`);
    
    const endpoints = [
      // Try different variations
      { name: 'Orders list (plain)', url: `https://api.foodics.com/v5/orders?per_page=1&sort=-created_at` },
      { name: 'Orders list (with products)', url: `https://api.foodics.com/v5/orders?per_page=1&include=products&sort=-created_at` },
      { name: 'Single order (plain)', url: `https://api.foodics.com/v5/orders/${order.id}` },
      { name: 'Order products (nested)', url: `https://api.foodics.com/v5/orders/${order.id}/products` },
      { name: 'Order items (alternative)', url: `https://api.foodics.com/v5/order-items?order_id=${order.id}` },
      { name: 'Order items (filter)', url: `https://api.foodics.com/v5/order-items?filter[order_id]=${order.id}` },
      { name: 'Order products (filter)', url: `https://api.foodics.com/v5/order-products?order_id=${order.id}` },
      { name: 'Transactions', url: `https://api.foodics.com/v5/transactions?order_id=${order.id}` },
    ];
    
    for (const endpoint of endpoints) {
      console.log('═'.repeat(70));
      console.log(`Testing: ${endpoint.name}`);
      console.log(`URL: ${endpoint.url}`);
      console.log('═'.repeat(70));
      
      try {
        const response = await fetch(endpoint.url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        
        console.log(`Status: ${response.status} ${response.statusText}`);
        
        if (response.status === 200) {
          const data = await response.json();
          console.log('✓ Success!');
          
          if (Array.isArray(data.data)) {
            console.log(`  Items returned: ${data.data.length}`);
            if (data.data.length > 0) {
              console.log('\n  First item structure:');
              console.log('  Keys:', Object.keys(data.data[0]).join(', '));
              
              // Check if this looks like order items
              const firstItem = data.data[0];
              if (firstItem.product_id || firstItem.product || firstItem.quantity) {
                console.log('\n  🎯 THIS MIGHT BE ORDER ITEMS!');
                console.log('  Sample:', JSON.stringify(firstItem, null, 2).split('\n').slice(0, 20).join('\n'));
              }
            }
          } else if (data.data) {
            console.log('  Single object returned');
            console.log('  Keys:', Object.keys(data.data).join(', '));
            
            // Check for embedded items
            if (data.data.order_items || data.data.products || data.data.items) {
              console.log('\n  🎯 FOUND EMBEDDED ITEMS!');
              const items = data.data.order_items || data.data.products || data.data.items;
              console.log(`  Items count: ${items.length}`);
              if (items.length > 0) {
                console.log('  Sample:', JSON.stringify(items[0], null, 2).split('\n').slice(0, 20).join('\n'));
              }
            }
          }
        } else {
          const errorText = await response.text();
          console.log(`❌ Failed: ${errorText.substring(0, 150)}`);
        }
        
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
      }
      
      console.log('');
      await sleep(500); // Rate limit protection
    }
    
    console.log('═'.repeat(70));
    console.log('BONUS: Check if order metadata contains items');
    console.log('═'.repeat(70));
    
    const metaCheck = await pool.query(`
      SELECT meta
      FROM saas.foodics_orders
      WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
        AND business_date >= '2025-11-09'
      LIMIT 1
    `);
    
    if (metaCheck.rows[0]?.meta) {
      const meta = metaCheck.rows[0].meta;
      console.log('Meta keys:', Object.keys(meta).join(', '));
      
      if (meta.products || meta.items || meta.order_items) {
        console.log('\n🎯 ITEMS FOUND IN ORDER META!');
        const items = meta.products || meta.items || meta.order_items;
        console.log(`Items count: ${items.length}`);
        if (items.length > 0) {
          console.log('Sample:', JSON.stringify(items[0], null, 2));
        }
      } else {
        console.log('\n❌ No items in meta');
      }
    }
    
    await pool.end();
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    await pool.end();
  }
}

exploreAPI();
