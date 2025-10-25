#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

const PRODUCTION_API = 'https://app.ordertech.me';
const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function getLocalDisplayDevices() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT device_id, device_name, device_token, branch 
      FROM devices 
      WHERE tenant_id = $1 AND role = 'display' AND status = 'active'
      AND device_token IS NOT NULL
      ORDER BY device_name
    `, [KOOBS_TENANT_ID]);
    
    return result.rows;
  } finally {
    client.release();
  }
}

async function sendHeartbeatToProduction(device) {
  try {
    console.log(`Sending heartbeat for ${device.device_name}...`);
    
    const response = await fetch(`${PRODUCTION_API}/presence/display`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-token': device.device_token,
        'x-tenant-id': KOOBS_TENANT_ID,
      },
      body: JSON.stringify({
        name: device.device_name,
        branch: device.branch || 'Main Branch'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ ${device.device_name}: Heartbeat successful`);
      return { success: true, device: device.device_name };
    } else {
      const errorText = await response.text();
      console.log(`❌ ${device.device_name}: Heartbeat failed (${response.status}) - ${errorText}`);
      return { success: false, device: device.device_name, error: response.status };
    }
  } catch (error) {
    console.log(`❌ ${device.device_name}: Error - ${error.message}`);
    return { success: false, device: device.device_name, error: error.message };
  }
}

async function testPresenceEndpoint() {
  try {
    console.log('\n=== Testing production presence endpoint ===');
    const response = await fetch(`${PRODUCTION_API}/presence/displays`, {
      headers: {
        'x-tenant-id': KOOBS_TENANT_ID,
      }
    });
    
    const data = await response.json();
    console.log('Production presence response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.items && data.items.length > 0) {
      console.log(`\n🎉 SUCCESS! Found ${data.items.length} online display device(s) on production`);
      console.log('Your cashier app should now see these devices!');
      return data.items;
    } else {
      console.log('\n❌ No display devices visible on production yet');
      return [];
    }
  } catch (error) {
    console.error('Error testing presence endpoint:', error.message);
    return [];
  }
}

async function main() {
  try {
    console.log('=== Wake up display devices on production ===\n');
    
    // Get display devices from local database
    console.log('1. Getting display devices from local database...');
    const devices = await getLocalDisplayDevices();
    
    if (devices.length === 0) {
      console.log('No display devices found in local database');
      return;
    }
    
    console.log(`Found ${devices.length} display devices in local database:`);
    devices.forEach(d => console.log(`  - ${d.device_name} (token: ${d.device_token?.slice(0, 8)}...)`));
    
    // Try to send heartbeats for each device
    console.log('\n2. Sending heartbeats to production server...');
    const results = [];
    for (const device of devices) {
      const result = await sendHeartbeatToProduction(device);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between requests
    }
    
    // Summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`\n=== Summary ===`);
    console.log(`✅ Successful heartbeats: ${successful.length}`);
    console.log(`❌ Failed heartbeats: ${failed.length}`);
    
    if (successful.length > 0) {
      console.log('\nDevices now online:');
      successful.forEach(r => console.log(`  - ${r.device}`));
    }
    
    if (failed.length > 0) {
      console.log('\nFailed devices:');
      failed.forEach(r => console.log(`  - ${r.device} (${r.error})`));
    }
    
    // Test the presence endpoint
    await new Promise(resolve => setTimeout(resolve, 1000));
    await testPresenceEndpoint();
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();