#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

const PRESENCE_TTL_MS = 30000; // 30 seconds

async function checkTenantsAndCreateDevice() {
  const client = await pool.connect();
  try {
    // First check what tenants exist
    console.log('=== Checking existing tenants ===');
    const tenantResult = await client.query('SELECT tenant_id, company_name FROM tenants ORDER BY created_at DESC LIMIT 5');
    
    if (tenantResult.rows.length === 0) {
      console.log('No tenants found. Creating default tenant...');
      const defaultTenantId = '00000000-0000-0000-0000-000000000000';
      await client.query(`
        INSERT INTO tenants (tenant_id, company_name, company_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id) DO NOTHING
      `, [defaultTenantId, 'Default Company', '123456']);
      console.log('Created default tenant.');
    } else {
      console.log('Found existing tenants:');
      tenantResult.rows.forEach(row => {
        console.log(`- ${row.company_name} (${row.tenant_id})`);
      });
    }
    
    // Use the first available tenant
    const currentTenantResult = await client.query('SELECT tenant_id FROM tenants ORDER BY created_at DESC LIMIT 1');
    const tenantId = currentTenantResult.rows[0].tenant_id;
    console.log(`\nUsing tenant: ${tenantId}`);
    
    // Create test display device with recent last_seen timestamp
    const deviceId = '11111111-1111-1111-1111-111111111111';
    const deviceName = 'Test Display 1';
    const deviceToken = 'test-display-token-1';
    
    await client.query(`
      INSERT INTO devices (device_id, tenant_id, device_name, device_token, role, status, branch, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (device_id) 
      DO UPDATE SET last_seen = NOW(), status = 'active'
    `, [deviceId, tenantId, deviceName, deviceToken, 'display', 'active', 'Main Branch']);
    
    console.log(`\nCreated/updated test display device: ${deviceName} (${deviceId})`);
    
    // Query devices to verify
    const deviceResult = await client.query(`
      SELECT device_id, device_name, role, branch, status, last_seen, 
             EXTRACT(EPOCH FROM (now() - last_seen))::int as seconds_ago 
      FROM devices 
      WHERE tenant_id = $1 AND status = 'active' 
      ORDER BY last_seen DESC
    `, [tenantId]);
    
    console.log('\n=== Current active devices ===');
    deviceResult.rows.forEach(row => {
      const isOnline = row.seconds_ago < (PRESENCE_TTL_MS / 1000);
      console.log(`${row.device_name} (${row.device_id}): role=${row.role}, branch=${row.branch}, seconds_ago=${row.seconds_ago}, online=${isOnline}`);
    });
    
    return { tenantId, devices: deviceResult.rows };
  } finally {
    client.release();
  }
}

async function testPresenceEndpoint(tenantId) {
  try {
    console.log('\n=== Testing /presence/displays endpoint ===');
    
    // Try different ways to specify the tenant
    const testCases = [
      { desc: 'via localhost.default.com host', headers: { 'Host': 'localhost.default.com' } },
      { desc: 'via x-tenant-id header', headers: { 'x-tenant-id': tenantId } },
      { desc: 'no tenant (should use default)', headers: {} },
    ];
    
    for (const testCase of testCases) {
      console.log(`\nTesting ${testCase.desc}:`);
      const response = await fetch('http://localhost:3000/presence/displays', {
        headers: testCase.headers
      });
      
      const data = await response.json();
      console.log('  Status:', response.status);
      console.log('  Response:', JSON.stringify(data, null, 4));
      
      if (response.status === 200 && data.items && data.items.length > 0) {
        console.log(`  ✅ SUCCESS: Found ${data.items.length} display device(s)`);
        return; // Success, exit early
      } else {
        console.log(`  ❌ No devices returned`);
      }
    }
  } catch (error) {
    console.error('Error testing endpoint:', error.message);
  }
}

async function main() {
  try {
    const result = await checkTenantsAndCreateDevice();
    
    // Give a moment for any server-side caching
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testPresenceEndpoint(result.tenantId);
    
    // Check server logs for debug output
    console.log('\n=== Checking server logs for debug output ===');
    const logs = require('fs').readFileSync('server.log', 'utf8').split('\n').slice(-20).join('\n');
    console.log(logs);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();