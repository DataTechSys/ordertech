#!/usr/bin/env node

// Script to register display devices in the database
const crypto = require('crypto');

// Database connection using pg library
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'ordertech'
});

async function registerDevice(name, role = 'display', branch = 'Main Branch') {
  const client = await pool.connect();
  try {
    // Generate device_id and token
    const device_id = crypto.randomUUID();
    const device_token = crypto.randomBytes(32).toString('hex');
    
    // Get tenant_id (use default or query from tenants table)
    const tenantResult = await client.query('SELECT tenant_id FROM tenants LIMIT 1');
    const tenant_id = tenantResult.rows[0]?.tenant_id || 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    
    // Get or create branch_id
    let branch_id = null;
    const branchResult = await client.query(
      'SELECT branch_id FROM branches WHERE tenant_id=$1 AND branch_name=$2 LIMIT 1',
      [tenant_id, branch]
    );
    
    if (branchResult.rows.length > 0) {
      branch_id = branchResult.rows[0].branch_id;
    } else {
      // Create branch
      const newBranch = await client.query(
        'INSERT INTO branches (branch_id, tenant_id, branch_name, created_at) VALUES ($1, $2, $3, now()) RETURNING branch_id',
        [crypto.randomUUID(), tenant_id, branch]
      );
      branch_id = newBranch.rows[0].branch_id;
      console.log(`✓ Created branch: ${branch} (${branch_id})`);
    }
    
    // Insert device
    await client.query(`
      INSERT INTO devices (
        device_id, tenant_id, device_token, device_name, 
        role, device_type, branch, branch_id, 
        status, created_at, last_seen
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
      ON CONFLICT (device_id) DO UPDATE SET
        device_token = EXCLUDED.device_token,
        device_name = EXCLUDED.device_name,
        role = EXCLUDED.role,
        branch = EXCLUDED.branch,
        branch_id = EXCLUDED.branch_id,
        last_seen = now()
    `, [device_id, tenant_id, device_token, name, role, role, branch, branch_id, 'active']);
    
    console.log(`\n✅ Registered device: ${name}`);
    console.log(`   Device ID: ${device_id}`);
    console.log(`   Token: ${device_token}`);
    console.log(`   Role: ${role}`);
    console.log(`   Branch: ${branch} (${branch_id})`);
    
    return { device_id, device_token, branch_id };
    
  } catch (error) {
    console.error('Error registering device:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('🔧 Registering display devices...\n');
    
    // Register iPhone
    const iphone = await registerDevice('MOSAWI iPhone', 'display', 'Main Branch');
    
    // Register LORGE iPad
    const lorge = await registerDevice('LORGE iPad', 'display', 'Main Branch');
    
    console.log('\n📱 Devices registered successfully!');
    console.log('\n⚠️  IMPORTANT: Copy these tokens to your devices:');
    console.log('\n1. iPhone Token:');
    console.log(`   ${iphone.device_token}`);
    console.log('\n2. LORGE iPad Token:');
    console.log(`   ${lorge.device_token}`);
    console.log('\n💡 You can paste these into the app settings or use them for activation.');
    
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
