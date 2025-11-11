#!/usr/bin/env node

const { Pool } = require('pg');
const { makeClient } = require('./server/integrations/foodics.js');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function test() {
  try {
    console.log('🔍 Testing Foodics Orders API\n');
    
    // Get token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    const client = makeClient(token);
    
    // Test 1: No filters (get latest)
    console.log('Test 1: Fetching latest orders (no filters)...');
    try {
      const test1 = await client.listOrders({});
      console.log(`✅ Found ${test1.items.length} orders`);
      if (test1.items.length > 0) {
        const firstOrder = test1.items[0];
        console.log(`   First order ID: ${firstOrder.id}`);
        console.log(`   Status: ${firstOrder.status}`);
        console.log(`   Created: ${firstOrder.created_at}`);
        console.log(`   Business date: ${firstOrder.business_date || 'N/A'}`);
        console.log(`   Total: ${firstOrder.total} ${firstOrder.currency || 'KWD'}`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
    console.log('\n---\n');
    
    // Test 2: With status filter
    console.log('Test 2: Fetching closed orders...');
    try {
      const test2 = await client.listOrders({ 'filter[status]': 'closed' });
      console.log(`✅ Found ${test2.items.length} closed orders`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
    console.log('\n---\n');
    
    // Test 3: Recent business dates
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
    
    console.log(`Test 3: Fetching orders from ${weekAgo} to ${today}...`);
    try {
      const test3 = await client.listOrders({ 
        'filter[business_date_after]': weekAgo,
        'filter[business_date_before]': today
      });
      console.log(`✅ Found ${test3.items.length} orders in date range`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
    console.log('\n---\n');
    
    // Test 4: Using updated_after
    const yesterday = new Date(Date.now() - 24*60*60*1000).toISOString();
    console.log(`Test 4: Fetching orders updated after ${yesterday}...`);
    try {
      const test4 = await client.listOrders({ 
        'filter[updated_after]': yesterday
      });
      console.log(`✅ Found ${test4.items.length} orders updated recently`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

test();
