#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function checkCashierDevices() {
  const client = await pool.connect();
  try {
    console.log('=== Checking cashier devices ===');
    const result = await client.query(`
      SELECT device_id, device_name, device_token, role, branch, status, last_seen,
             EXTRACT(EPOCH FROM (now() - last_seen))::int as seconds_ago 
      FROM devices 
      WHERE tenant_id = $1 AND role = 'cashier' AND status = 'active'
      ORDER BY last_seen DESC NULLS LAST
    `, [KOOBS_TENANT_ID]);
    
    console.log(`Found ${result.rows.length} cashier devices:`);
    result.rows.forEach(row => {
      console.log(`- ${row.device_name} (${row.device_id}): token=${row.device_token?.slice(0,10)}..., seconds_ago=${row.seconds_ago}`);
    });
    
    return result.rows;
  } finally {
    client.release();
  }
}

async function testWithCashierToken(token) {
  try {
    console.log('\n=== Testing /presence/displays with cashier token ===');
    const response = await fetch('http://localhost:3000/presence/displays', {
      headers: {
        'Host': 'localhost.koobs.com',  // This should map to Koobs tenant
        'x-device-token': token,
        'x-tenant-id': KOOBS_TENANT_ID
      }
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    return { status: response.status, data };
  } catch (error) {
    console.error('Error:', error.message);
    return { error: error.message };
  }
}

async function testWithoutToken() {
  try {
    console.log('\n=== Testing /presence/displays without token (should still work) ===');
    const response = await fetch('http://localhost:3000/presence/displays', {
      headers: {
        'Host': 'localhost.koobs.com',
        'x-tenant-id': KOOBS_TENANT_ID
      }
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    return { status: response.status, data };
  } catch (error) {
    console.error('Error:', error.message);
    return { error: error.message };
  }
}

async function main() {
  try {
    const cashierDevices = await checkCashierDevices();
    
    // Test without token first (should work)
    await testWithoutToken();
    
    // Test with cashier token if available
    if (cashierDevices.length > 0) {
      const firstCashier = cashierDevices[0];
      console.log(`\nUsing cashier token from: ${firstCashier.device_name}`);
      await testWithCashierToken(firstCashier.device_token);
    } else {
      console.log('\nNo cashier devices found, skipping token test');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();