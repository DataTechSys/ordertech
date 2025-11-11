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

async function testFoodicsAPI() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    if (!result.rows[0]?.token) {
      throw new Error('Foodics API token not found');
    }
    
    const token = result.rows[0].token;
    console.log('✓ Got API token\n');
    
    // Get a recent order
    const orderResult = await pool.query(`
      SELECT id, reference, business_date
      FROM saas.foodics_orders
      WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
        AND business_date >= '2025-11-09'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    if (orderResult.rows.length === 0) {
      console.log('No recent orders found');
      pool.end();
      return;
    }
    
    const order = orderResult.rows[0];
    console.log(`Testing with order: ${order.reference} (${order.id})`);
    console.log(`Business date: ${order.business_date}\n`);
    
    // Test 1: Fetch order with include=order_items
    console.log('═'.repeat(60));
    console.log('Test 1: GET /orders/{id}?include=order_items');
    console.log('═'.repeat(60));
    
    const test1 = await fetch(
      `https://api.foodics.com/v5/orders/${order.id}?include=order_items`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    console.log(`Status: ${test1.status} ${test1.statusText}`);
    
    if (test1.status === 200) {
      const data1 = await test1.json();
      console.log('✓ Success');
      console.log(`Order ID: ${data1.data?.id}`);
      console.log(`Order items in response: ${data1.data?.order_items?.length || 0}`);
      
      if (data1.data?.order_items?.length > 0) {
        console.log('\nFirst item sample:');
        console.log(JSON.stringify(data1.data.order_items[0], null, 2));
      }
    } else {
      console.log('❌ Failed');
      const error1 = await test1.text();
      console.log('Error:', error1.substring(0, 200));
    }
    
    // Test 2: Fetch order items directly
    console.log('\n' + '═'.repeat(60));
    console.log('Test 2: GET /orders/{id}/order-items');
    console.log('═'.repeat(60));
    
    const test2 = await fetch(
      `https://api.foodics.com/v5/orders/${order.id}/order-items`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    console.log(`Status: ${test2.status} ${test2.statusText}`);
    
    if (test2.status === 200) {
      const data2 = await test2.json();
      console.log('✓ Success');
      console.log(`Items returned: ${data2.data?.length || 0}`);
      
      if (data2.data?.length > 0) {
        console.log('\nFirst item sample:');
        console.log(JSON.stringify(data2.data[0], null, 2));
      }
    } else {
      console.log('❌ Failed');
      const error2 = await test2.text();
      console.log('Error:', error2.substring(0, 200));
    }
    
    // Test 3: List orders with include
    console.log('\n' + '═'.repeat(60));
    console.log('Test 3: GET /orders?include=order_items&per_page=1');
    console.log('═'.repeat(60));
    
    const test3 = await fetch(
      `https://api.foodics.com/v5/orders?include=order_items&per_page=1&sort=-created_at`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    console.log(`Status: ${test3.status} ${test3.statusText}`);
    
    if (test3.status === 200) {
      const data3 = await test3.json();
      console.log('✓ Success');
      console.log(`Orders returned: ${data3.data?.length || 0}`);
      
      if (data3.data?.length > 0) {
        const firstOrder = data3.data[0];
        console.log(`Order: ${firstOrder.reference}`);
        console.log(`Order items: ${firstOrder.order_items?.length || 0}`);
        
        if (firstOrder.order_items?.length > 0) {
          console.log('\nFirst item sample:');
          console.log(JSON.stringify(firstOrder.order_items[0], null, 2));
        }
      }
    } else {
      console.log('❌ Failed');
      const error3 = await test3.text();
      console.log('Error:', error3.substring(0, 200));
    }
    
    console.log('\n' + '═'.repeat(60));
    
    await pool.end();
    
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

testFoodicsAPI();
