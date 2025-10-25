#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PRESENCE_TTL_MS = 30000; // 30 seconds

async function createTestDisplayDevice() {
  const client = await pool.connect();
  try {
    // Create a test display device with a recent last_seen timestamp
    const deviceId = '11111111-1111-1111-1111-111111111111';
    const deviceName = 'Test Display 1';
    const deviceToken = 'test-display-token-1';
    
    await client.query(`
      INSERT INTO devices (device_id, tenant_id, device_name, device_token, role, status, branch, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (device_id) 
      DO UPDATE SET last_seen = NOW(), status = 'active'
    `, [deviceId, DEFAULT_TENANT_ID, deviceName, deviceToken, 'display', 'active', 'Main Branch']);
    
    console.log(`Created/updated test display device: ${deviceName} (${deviceId})`);
    
    // Query devices to verify
    const result = await client.query(`
      SELECT device_id, device_name, role, branch, status, last_seen, 
             EXTRACT(EPOCH FROM (now() - last_seen))::int as seconds_ago 
      FROM devices 
      WHERE tenant_id = $1 AND status = 'active' 
      ORDER BY last_seen DESC
    `, [DEFAULT_TENANT_ID]);
    
    console.log('\n=== Current devices in database ===');
    result.rows.forEach(row => {
      const isOnline = row.seconds_ago < (PRESENCE_TTL_MS / 1000);
      console.log(`${row.device_name} (${row.device_id}): role=${row.role}, branch=${row.branch}, seconds_ago=${row.seconds_ago}, online=${isOnline}`);
    });
    
    return result.rows;
  } finally {
    client.release();
  }
}

async function testPresenceEndpoint() {
  try {
    console.log('\n=== Testing /presence/displays endpoint ===');
    const response = await fetch('http://localhost:3000/presence/displays', {
      headers: {
        'Host': 'localhost.default.com'  // Tenant resolution via host header
      }
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.items && data.items.length > 0) {
      console.log('\n✅ SUCCESS: Found', data.items.length, 'display device(s)');
    } else {
      console.log('\n❌ ISSUE: No display devices returned');
    }
  } catch (error) {
    console.error('Error testing endpoint:', error.message);
  }
}

async function main() {
  try {
    await createTestDisplayDevice();
    
    // Give a moment for any server-side caching
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testPresenceEndpoint();
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();