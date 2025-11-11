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

async function checkOrderTypes() {
  try {
    console.log('🔍 Checking Order Types...\n');
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // 1. Check what's in the DATABASE
    console.log('📊 DATABASE CHECK:');
    console.log('─'.repeat(60));
    
    const dbCheck = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(type) as orders_with_type,
        COUNT(*) - COUNT(type) as orders_without_type,
        COUNT(DISTINCT type) as distinct_types,
        array_agg(DISTINCT type) FILTER (WHERE type IS NOT NULL) as type_values
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND business_date >= '2025-10-31'
        AND status = 4
    `);
    
    const stats = dbCheck.rows[0];
    console.log(`Total Orders (closed, recent): ${stats.total_orders}`);
    console.log(`Orders WITH type field:        ${stats.orders_with_type}`);
    console.log(`Orders WITHOUT type (NULL):    ${stats.orders_without_type}`);
    console.log(`Distinct type values:          ${stats.type_values || 'NONE'}`);
    
    // Show sample orders
    const samples = await pool.query(`
      SELECT reference, business_date, type, total_price, status
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND business_date >= '2025-10-31'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log('\nSample orders from DB:');
    samples.rows.forEach((o, i) => {
      console.log(`  ${i+1}. Ref: ${o.reference} | Type: ${o.type || 'NULL'} | ${o.total_price} KWD | Status: ${o.status}`);
    });
    
    // 2. Check what's in FOODICS API
    console.log('\n\n🌐 FOODICS API CHECK:');
    console.log('─'.repeat(60));
    
    const apiResponse = await fetch(
      'https://api.foodics.com/v5/orders?per_page=5&page=1&filter[status]=4',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const apiData = await apiResponse.json();
    
    if (apiData.data && apiData.data.length > 0) {
      console.log(`Found ${apiData.data.length} recent orders from API\n`);
      
      apiData.data.forEach((o, i) => {
        console.log(`${i+1}. Ref: ${o.reference}`);
        console.log(`   Type field: ${o.type !== undefined ? o.type : 'MISSING'}`);
        console.log(`   Type value: ${o.type || 'NULL'}`);
        console.log(`   Source: ${o.source}`);
        console.log(`   Status: ${o.status}`);
        console.log(`   Total: ${o.total_price} KWD`);
        
        // Check if type is in meta
        if (o.meta) {
          console.log(`   Meta keys: ${Object.keys(o.meta).join(', ')}`);
          if (o.meta.type) {
            console.log(`   Meta.type: ${o.meta.type}`);
          }
        }
        console.log('');
      });
      
      // 3. Check one order in detail
      console.log('\n📋 DETAILED ORDER CHECK:');
      console.log('─'.repeat(60));
      const firstOrder = apiData.data[0];
      console.log(JSON.stringify(firstOrder, null, 2));
      
    } else {
      console.log('❌ No orders returned from API');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkOrderTypes();
