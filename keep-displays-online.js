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

let activeDevices = [];

async function getActiveDisplayDevice() {
  const client = await pool.connect();
  try {
    // Just get one device that was recently online locally
    const result = await client.query(`
      SELECT device_id, device_name, device_token, branch 
      FROM devices 
      WHERE tenant_id = $1 AND role = 'display' AND status = 'active'
      AND device_token IS NOT NULL
      AND device_name = 'IPAD Display'
      LIMIT 1
    `, [KOOBS_TENANT_ID]);
    
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function sendHeartbeat(device) {
  try {
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
    
    const timestamp = new Date().toLocaleTimeString();
    if (response.ok) {
      console.log(`[${timestamp}] ✅ ${device.device_name}: Heartbeat sent`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`[${timestamp}] ❌ ${device.device_name}: Failed (${response.status}) ${errorText}`);
      return false;
    }
  } catch (error) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ❌ ${device.device_name}: Error - ${error.message}`);
    return false;
  }
}

async function checkPresence() {
  try {
    const response = await fetch(`${PRODUCTION_API}/presence/displays`, {
      headers: {
        'x-tenant-id': KOOBS_TENANT_ID,
      }
    });
    
    const data = await response.json();
    const timestamp = new Date().toLocaleTimeString();
    
    if (data.items && data.items.length > 0) {
      console.log(`[${timestamp}] 🎉 VISIBLE: ${data.items.length} display(s) online!`);
      data.items.forEach(item => {
        console.log(`  - ${item.name} (${item.branch || 'No branch'})`);
      });
      return data.items.length;
    } else {
      console.log(`[${timestamp}] 👁️  Checking: No displays visible yet...`);
      return 0;
    }
  } catch (error) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ❌ Presence check failed: ${error.message}`);
    return 0;
  }
}

async function main() {
  try {
    console.log('=== Keeping display devices online on production ===\n');
    
    // Get one display device to work with
    console.log('Getting display device...');
    const device = await getActiveDisplayDevice();
    
    if (!device) {
      console.log('No suitable display device found');
      return;
    }
    
    console.log(`Using device: ${device.device_name}`);
    console.log('Sending heartbeats every 5 seconds...\n');
    console.log('Press Ctrl+C to stop\n');
    
    // Send initial heartbeat
    await sendHeartbeat(device);
    
    let visibleCount = 0;
    
    // Set up interval for heartbeats (every 5 seconds)
    const heartbeatInterval = setInterval(async () => {
      await sendHeartbeat(device);
    }, 5000);
    
    // Set up interval for presence checks (every 10 seconds)  
    const presenceInterval = setInterval(async () => {
      const newCount = await checkPresence();
      if (newCount > visibleCount) {
        console.log('\n🎊 SUCCESS! Your cashier app should now see the display device(s)! 🎊\n');
        visibleCount = newCount;
      }
    }, 10000);
    
    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n\nStopping heartbeats...');
      clearInterval(heartbeatInterval);
      clearInterval(presenceInterval);
      await pool.end();
      process.exit(0);
    });
    
    // Do an initial presence check after 2 seconds
    setTimeout(async () => {
      visibleCount = await checkPresence();
    }, 2000);
    
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

main();