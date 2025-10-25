#!/usr/bin/env node

// Debug script to check what display devices exist in Cloud SQL
// Run with: . scripts/env.local.sh && node debug-displays.js

const { Pool } = require('pg');

// Load database config from environment (set by env.local.sh)
const pool = new Pool({
  // Uses PGHOST, PGPORT, DATABASE_URL from environment
});

async function checkDisplays() {
  try {
    console.log('🔍 Checking display devices in Cloud SQL...');
    
    // 1. Check what tenants exist
    const tenants = await pool.query(`
      SELECT tenant_id, company_name, company_id 
      FROM tenants 
      ORDER BY company_name 
      LIMIT 10
    `);
    console.log(`\n📋 Found ${tenants.rows.length} tenants:`);
    tenants.rows.forEach(t => {
      console.log(`  - ${t.company_name} (${t.company_id}) - ${t.tenant_id}`);
    });

    // 2. Check all devices with role=display
    const displays = await pool.query(`
      SELECT device_id, device_name, role, status, branch, last_seen, tenant_id,
             EXTRACT(EPOCH FROM (NOW() - last_seen)) as seconds_since_seen
      FROM devices 
      WHERE role = 'display' 
      ORDER BY last_seen DESC NULLS LAST
      LIMIT 20
    `);
    
    console.log(`\n🖥️  Found ${displays.rows.length} display devices:`);
    displays.rows.forEach(d => {
      const lastSeen = d.last_seen ? 
        `${Math.floor(d.seconds_since_seen / 60)} min ago` : 
        'never';
      const isOnline = d.seconds_since_seen < 15; // 15 second threshold
      console.log(`  - ${d.device_name} (${d.status}) - Branch: ${d.branch || 'none'} - Last seen: ${lastSeen} - Online: ${isOnline ? '✅' : '❌'}`);
      console.log(`    ID: ${d.device_id}, Tenant: ${d.tenant_id}`);
    });

    // 3. Check devices for the default tenant specifically
    const DEFAULT_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // From earlier logs
    const defaultTenantDisplays = await pool.query(`
      SELECT device_id, device_name, role, status, branch, last_seen,
             EXTRACT(EPOCH FROM (NOW() - last_seen)) as seconds_since_seen
      FROM devices 
      WHERE tenant_id = $1 AND role = 'display'
      ORDER BY last_seen DESC NULLS LAST
    `, [DEFAULT_TENANT_ID]);

    console.log(`\n🏢 Default tenant (${DEFAULT_TENANT_ID}) displays:`);
    if (defaultTenantDisplays.rows.length === 0) {
      console.log('  ❌ No display devices found for default tenant!');
    } else {
      defaultTenantDisplays.rows.forEach(d => {
        const lastSeen = d.last_seen ? 
          `${Math.floor(d.seconds_since_seen / 60)} min ago` : 
          'never';
        const isOnline = d.seconds_since_seen < 15;
        console.log(`  - ${d.device_name} (${d.status}) - Online: ${isOnline ? '✅' : '❌'}`);
      });
    }

    // 4. Check if there are any active cashier devices
    const cashiers = await pool.query(`
      SELECT device_id, device_name, role, status, last_seen,
             EXTRACT(EPOCH FROM (NOW() - last_seen)) as seconds_since_seen
      FROM devices 
      WHERE role = 'cashier' AND status = 'active'
      ORDER BY last_seen DESC NULLS LAST
      LIMIT 10
    `);
    
    console.log(`\n💰 Found ${cashiers.rows.length} active cashier devices:`);
    cashiers.rows.forEach(c => {
      const lastSeen = c.last_seen ? 
        `${Math.floor(c.seconds_since_seen / 60)} min ago` : 
        'never';
      console.log(`  - ${c.device_name} - Last seen: ${lastSeen}`);
    });

  } catch (error) {
    console.error('❌ Error checking displays:', error.message);
    console.error('Make sure you ran: . scripts/env.local.sh');
  } finally {
    await pool.end();
  }
}

checkDisplays();