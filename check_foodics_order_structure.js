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

async function checkOrderStructure() {
  try {
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    console.log('🔍 Checking Foodics API Order Structure...\n');
    
    // 1. Check without includes
    console.log('1️⃣  WITHOUT includes parameter:');
    console.log('─'.repeat(60));
    
    const response1 = await fetch(
      'https://api.foodics.com/v5/orders?per_page=1&page=1',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const data1 = await response1.json();
    const order1 = data1.data[0];
    
    console.log('Top-level keys:', Object.keys(order1).join(', '));
    console.log('Has branch field?', 'branch' in order1);
    console.log('Has branch_id field?', 'branch_id' in order1);
    console.log('Meta keys:', order1.meta ? Object.keys(order1.meta).join(', ') : 'NO META');
    
    // 2. Check WITH includes
    console.log('\n\n2️⃣  WITH includes=branch parameter:');
    console.log('─'.repeat(60));
    
    const response2 = await fetch(
      'https://api.foodics.com/v5/orders?per_page=1&page=1&include=branch',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const data2 = await response2.json();
    const order2 = data2.data[0];
    
    console.log('Top-level keys:', Object.keys(order2).join(', '));
    console.log('Has branch field?', 'branch' in order2);
    console.log('Has branch_id field?', 'branch_id' in order2);
    
    if (order2.branch) {
      console.log('\n✅ Branch object found!');
      console.log('Branch keys:', Object.keys(order2.branch).join(', '));
      console.log('Branch ID:', order2.branch.id);
      console.log('Branch name:', order2.branch.name);
      console.log('Branch reference:', order2.branch.reference);
    }
    
    // 3. Show full order with branch
    console.log('\n\n3️⃣  FULL ORDER WITH BRANCH:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(order2, null, 2));
    
    // 4. Check what's in our DB meta field
    console.log('\n\n4️⃣  WHAT\'S IN OUR DATABASE meta field:');
    console.log('─'.repeat(60));
    
    const dbOrder = await pool.query(`
      SELECT reference, meta
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    const stored = dbOrder.rows[0];
    console.log('Order reference:', stored.reference);
    console.log('Meta keys:', stored.meta ? Object.keys(stored.meta).join(', ') : 'NO META');
    console.log('Has branch_name in meta?', stored.meta?.branch_name ? 'YES' : 'NO');
    console.log('\nFull meta:', JSON.stringify(stored.meta, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkOrderStructure();
