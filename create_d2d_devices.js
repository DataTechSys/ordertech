#!/usr/bin/env node

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'ordertech'
});

async function generateUniqueCode(client) {
  for (let i = 0; i < 40; i++) {
    const candidate = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const existing = await client.query(
      'SELECT 1 FROM device_activation_codes WHERE code=$1 AND expires_at>now()',
      [candidate]
    );
    if (existing.rows.length === 0) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique code');
}

async function createDevice(client, deviceName, branchId, tenantId, role = 'display') {
  // Create device record
  const deviceResult = await client.query(`
    INSERT INTO devices (device_name, branch_id, tenant_id, role, status, ai_enabled)
    VALUES ($1, $2, $3, $4, 'active', true)
    RETURNING device_id, device_token, uuid
  `, [deviceName, branchId, tenantId, role]);
  
  const device = deviceResult.rows[0];
  
  // Generate activation code
  const code = await generateUniqueCode(client);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  await client.query(`
    INSERT INTO device_activation_codes (code, tenant_id, created_at, expires_at, claimed_at, device_id, meta)
    VALUES ($1, $2, now(), $3, now(), $4, $5::jsonb)
  `, [code, tenantId, expires.toISOString(), device.device_id, JSON.stringify({
    role,
    name: deviceName,
    device_token: device.device_token
  })]);
  
  return { ...device, code, expires };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get SALMIYA branch and tenant info
    const branchResult = await client.query(`
      SELECT branch_id, tenant_id FROM branches WHERE branch_name = 'SALMIYA' LIMIT 1
    `);
    
    if (branchResult.rows.length === 0) {
      throw new Error('SALMIYA branch not found');
    }
    
    const { branch_id: branchId, tenant_id: tenantId } = branchResult.rows[0];
    
    console.log('🔧 Creating new D2D devices...\n');
    
    // Create iPAD-B1 (display device)
    const ipad = await createDevice(client, 'iPAD-B1', branchId, tenantId, 'display');
    console.log('✅ iPAD-B1 created:');
    console.log(`   Device ID: ${ipad.device_id}`);
    console.log(`   UUID: ${ipad.uuid}`);
    console.log(`   Activation Code: ${ipad.code}`);
    console.log(`   Expires: ${ipad.expires.toLocaleString()}\n`);
    
    // Create MOSAWI-B1 (kitchen/display device)
    const mosawi = await createDevice(client, 'MOSAWI-B1', branchId, tenantId, 'display');
    console.log('✅ MOSAWI-B1 created:');
    console.log(`   Device ID: ${mosawi.device_id}`);
    console.log(`   UUID: ${mosawi.uuid}`);
    console.log(`   Activation Code: ${mosawi.code}`);
    console.log(`   Expires: ${mosawi.expires.toLocaleString()}\n`);
    
    await client.query('COMMIT');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 Activation Codes:');
    console.log(`   iPAD-B1:   ${ipad.code}`);
    console.log(`   MOSAWI-B1: ${mosawi.code}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
