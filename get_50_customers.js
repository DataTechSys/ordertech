#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function get50Customers() {
  try {
    console.log('🔍 Getting Foodics token...');
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    console.log('👥 Fetching 50 customers directly from Foodics API...');
    
    // Direct fetch - just 1 page with 50 items
    const response = await fetch('https://api.foodics.com/v5/customers?per_page=50&page=1', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    console.log(`✅ Got ${data.data.length} customers\n`);
    
    // Save all customers
    fs.writeFileSync('customers_sample_50.json', JSON.stringify(data.data, null, 2));
    console.log('💾 Saved all 50 customers to customers_sample_50.json\n');
    
    // Analyze first customer structure
    const customer = data.data[0];
    
    console.log('👤 Customer #1 Structure:');
    console.log('─'.repeat(60));
    
    Object.keys(customer).sort().forEach(key => {
      const value = customer[key];
      let type = typeof value;
      
      if (value === null) {
        type = 'null';
      } else if (Array.isArray(value)) {
        type = `array[${value.length}]`;
        if (value.length > 0) {
          const itemType = typeof value[0];
          type += ` of ${itemType}`;
        }
      } else if (type === 'object') {
        type = `object (${Object.keys(value).length} keys)`;
      }
      
      // Show sample value for important fields
      let sample = '';
      if (type === 'string' || type === 'number' || type === 'boolean') {
        sample = `: ${JSON.stringify(value)}`;
      }
      
      console.log(`  ${key.padEnd(25)} ${type}${sample}`);
    });
    
    // Show what fields are most commonly populated
    console.log('\n📊 Field Usage Analysis (across all 50 customers):');
    console.log('─'.repeat(60));
    
    const fieldCounts = {};
    Object.keys(customer).forEach(key => {
      fieldCounts[key] = 0;
    });
    
    data.data.forEach(cust => {
      Object.keys(cust).forEach(key => {
        if (cust[key] !== null && cust[key] !== undefined) {
          fieldCounts[key] = (fieldCounts[key] || 0) + 1;
        }
      });
    });
    
    Object.keys(fieldCounts).sort().forEach(key => {
      const pct = Math.round((fieldCounts[key] / 50) * 100);
      const bar = '█'.repeat(Math.floor(pct / 5));
      console.log(`  ${key.padEnd(25)} ${String(fieldCounts[key]).padStart(2)}/50 ${bar}`);
    });
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
}

get50Customers();
