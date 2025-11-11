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

async function quick() {
  try {
    // Get token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    const client = makeClient(token);
    
    // Fetch just 1 page
    console.log('📦 Fetching 1 page of orders...');
    const response = await client.listOrders({});
    
    console.log(`✅ Got ${response.items.length} orders\n`);
    
    const order = response.items[0];
    
    // Save sample
    fs.writeFileSync('sample_order.json', JSON.stringify(order, null, 2));
    console.log('💾 Saved to sample_order.json');
    
    // Show structure
    console.log('\n📋 Order fields:');
    Object.keys(order).forEach(k => {
      const v = order[k];
      const type = Array.isArray(v) ? `array[${v.length}]` : typeof v;
      console.log(`  ${k}: ${type}`);
    });
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

quick();
