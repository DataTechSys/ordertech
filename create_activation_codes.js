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

async function createActivationCode(deviceId, deviceName) {
  const client = await pool.connect();
  try {
    // Get device info
    const deviceResult = await client.query(
      'SELECT tenant_id, device_token, role, branch FROM devices WHERE device_id=$1',
      [deviceId]
    );
    
    if (deviceResult.rows.length === 0) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    const device = deviceResult.rows[0];
    
    // Generate 6-digit code
    let code = null;
    for (let i = 0; i < 40; i++) {
      const candidate = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const existing = await client.query(
        'SELECT 1 FROM device_activation_codes WHERE code=$1 AND expires_at>now()',
        [candidate]
      );
      if (existing.rows.length === 0) {
        code = candidate;
        break;
      }
    }
    
    if (!code) throw new Error('Failed to generate unique code');
    
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Insert activation code
    await client.query(`
      INSERT INTO device_activation_codes (code, tenant_id, created_at, expires_at, claimed_at, device_id, meta)
      VALUES ($1, $2, now(), $3, now(), $4, $5::jsonb)
      ON CONFLICT (code) DO UPDATE SET
        device_id = EXCLUDED.device_id,
        claimed_at = EXCLUDED.claimed_at,
        meta = EXCLUDED.meta
    `, [code, device.tenant_id, expires.toISOString(), deviceId, JSON.stringify({
      role: device.role,
      name: deviceName,
      branch: device.branch,
      device_token: device.device_token
    })]);
    
    console.log(`\n✅ Activation code for ${deviceName}:`);
    console.log(`   Code: ${code}`);
    console.log(`   Expires: ${expires.toLocaleString()}`);
    
    return code;
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('🔑 Creating activation codes...');
    
    const iphoneCode = await createActivationCode(
      '6c7be7f5-0a16-4266-b1bc-c48a770a15c0',
      'MOSAWI iPhone'
    );
    
    const lorgeCode = await createActivationCode(
      '55d1090b-3b6a-4c8f-94dd-8bec26a6b0a5',
      'LORGE iPad'
    );
    
    console.log('\n\n📱 Enter these codes in your apps:');
    console.log(`\n   iPhone: ${iphoneCode}`);
    console.log(`   LORGE iPad: ${lorgeCode}`);
    
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
