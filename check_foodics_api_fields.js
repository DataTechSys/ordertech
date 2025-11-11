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

async function checkFoodicsAPI() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    console.log('📡 Fetching orders from Foodics API...\n');
    
    // Fetch recent orders WITHOUT any includes
    console.log('1️⃣  WITHOUT include parameter:');
    console.log('═'.repeat(80));
    const response1 = await fetch(
      'https://api.foodics.com/v5/orders?per_page=3&page=1&sort=-created_at',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const data1 = await response1.json();
    console.log('Response keys:', Object.keys(data1));
    console.log('First order keys:', Object.keys(data1.data[0]));
    console.log('\nFirst order full data:');
    console.log(JSON.stringify(data1.data[0], null, 2));
    
    // Fetch WITH branch include
    console.log('\n\n2️⃣  WITH include=branch parameter:');
    console.log('═'.repeat(80));
    const response2 = await fetch(
      'https://api.foodics.com/v5/orders?per_page=3&page=1&sort=-created_at&include=branch',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const data2 = await response2.json();
    console.log('First order keys:', Object.keys(data2.data[0]));
    console.log('Has branch?', 'branch' in data2.data[0]);
    if (data2.data[0].branch) {
      console.log('Branch object:', JSON.stringify(data2.data[0].branch, null, 2));
    } else {
      console.log('Branch is:', data2.data[0].branch);
    }
    
    console.log('\n\n3️⃣  Checking all 3 orders for branch data:');
    console.log('═'.repeat(80));
    data2.data.forEach((order, i) => {
      console.log(`\nOrder ${i+1}:`);
      console.log(`  Reference: ${order.reference}`);
      console.log(`  Type: ${order.type}`);
      console.log(`  Status: ${order.status}`);
      console.log(`  Date: ${order.business_date}`);
      console.log(`  Has branch object: ${!!order.branch}`);
      if (order.branch) {
        console.log(`  Branch name: ${order.branch.name}`);
        console.log(`  Branch ID: ${order.branch.id}`);
      } else {
        console.log(`  Branch value: ${order.branch}`);
      }
    });
    
    // Check today's orders
    console.log('\n\n4️⃣  Today\'s orders (Nov 10) with branch:');
    console.log('═'.repeat(80));
    const response3 = await fetch(
      'https://api.foodics.com/v5/orders?per_page=20&page=1&sort=-created_at&include=branch',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const data3 = await response3.json();
    const todayOrders = data3.data.filter(o => o.business_date === '2025-11-10');
    console.log(`Found ${todayOrders.length} orders from today\n`);
    
    let withBranch = 0;
    let withoutBranch = 0;
    
    todayOrders.forEach(order => {
      if (order.branch) {
        withBranch++;
        console.log(`✅ Ref ${order.reference} | Type: ${order.type} | Branch: ${order.branch.name}`);
      } else {
        withoutBranch++;
        console.log(`❌ Ref ${order.reference} | Type: ${order.type} | Branch: NULL`);
      }
    });
    
    console.log(`\n📊 Summary: ${withBranch} with branch, ${withoutBranch} without branch`);
    console.log(`Percentage with branch: ${(withBranch / todayOrders.length * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkFoodicsAPI();
