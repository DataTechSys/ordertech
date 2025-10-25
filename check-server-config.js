#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

async function checkServerConfiguration() {
  const client = await pool.connect();
  try {
    console.log('=== Checking Server Configuration in Database ===\n');
    
    // Check for server configuration tables
    console.log('1. Server Configuration Tables:');
    const configTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%config%' OR table_name LIKE '%setting%' OR table_name LIKE '%server%'
      ORDER BY table_name
    `);
    
    if (configTables.rows.length > 0) {
      configTables.rows.forEach(row => console.log(`  - ${row.table_name}`));
    } else {
      console.log('  No configuration tables found');
    }
    
    // Check tenant domains and their configurations
    console.log('\n2. Tenant Domain Mappings:');
    const domains = await client.query(`
      SELECT td.host, t.company_name, t.tenant_id 
      FROM tenant_domains td 
      JOIN tenants t ON td.tenant_id = t.tenant_id 
      ORDER BY td.host
    `);
    
    if (domains.rows.length > 0) {
      domains.rows.forEach(row => {
        console.log(`  - ${row.host} → ${row.company_name} (${row.tenant_id})`);
      });
    } else {
      console.log('  No tenant domains configured');
    }
    
    // Check if there are any server settings in tenant-specific configuration
    console.log('\n3. Tenant Settings (looking for server/API configs):');
    try {
      const tenantSettings = await client.query(`
        SELECT tenant_id, key, value 
        FROM tenant_settings 
        WHERE key ILIKE '%server%' OR key ILIKE '%api%' OR key ILIKE '%port%' OR key ILIKE '%url%'
        ORDER BY tenant_id, key
      `);
      
      if (tenantSettings.rows.length > 0) {
        tenantSettings.rows.forEach(row => {
          console.log(`  - ${row.tenant_id}: ${row.key} = ${row.value}`);
        });
      } else {
        console.log('  No server-related tenant settings found');
      }
    } catch (e) {
      console.log(`  tenant_settings table not found or accessible: ${e.message}`);
    }
    
    // Check current active devices and their last activity
    console.log('\n4. Active Cashier Devices (potential source of API calls):');
    const cashierDevices = await client.query(`
      SELECT device_name, device_id, tenant_id, last_seen,
             EXTRACT(EPOCH FROM (now() - last_seen))::int as seconds_ago
      FROM devices 
      WHERE role = 'cashier' AND status = 'active'
      ORDER BY last_seen DESC NULLS LAST
      LIMIT 5
    `);
    
    cashierDevices.rows.forEach(row => {
      const status = row.seconds_ago < 300 ? 'RECENT' : 'OLD';
      console.log(`  - ${row.device_name}: last_seen ${row.seconds_ago || 'NULL'} seconds ago [${status}]`);
    });
    
    // Check if there are any environment-specific configurations
    console.log('\n5. Looking for Environment/Deployment configs:');
    try {
      const envConfigs = await client.query(`
        SELECT * FROM information_schema.tables 
        WHERE table_name IN ('environments', 'deployments', 'app_config', 'system_config')
      `);
      
      for (const table of envConfigs.rows) {
        console.log(`  Found table: ${table.table_name}`);
        try {
          const data = await client.query(`SELECT * FROM ${table.table_name} LIMIT 3`);
          data.rows.forEach((row, i) => {
            console.log(`    Row ${i + 1}:`, JSON.stringify(row, null, 4));
          });
        } catch (e) {
          console.log(`    Error reading ${table.table_name}: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`  Error checking for env tables: ${e.message}`);
    }
    
    // Check iOS app-specific configuration if exists
    console.log('\n6. iOS/Mobile App Configuration:');
    try {
      const appConfigs = await client.query(`
        SELECT * FROM information_schema.columns 
        WHERE table_name = 'tenants' 
        AND (column_name ILIKE '%api%' OR column_name ILIKE '%url%' OR column_name ILIKE '%endpoint%')
      `);
      
      if (appConfigs.rows.length > 0) {
        console.log('  Tenant table has API-related columns:');
        appConfigs.rows.forEach(row => {
          console.log(`    - ${row.column_name} (${row.data_type})`);
        });
        
        // Get actual values
        const tenantApiData = await client.query(`
          SELECT tenant_id, company_name,
          ${appConfigs.rows.map(r => r.column_name).join(', ')}
          FROM tenants 
          WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
        `);
        
        if (tenantApiData.rows.length > 0) {
          console.log('  Koobs tenant API config:', JSON.stringify(tenantApiData.rows[0], null, 4));
        }
      } else {
        console.log('  No API-related columns found in tenants table');
      }
    } catch (e) {
      console.log(`  Error checking tenant API config: ${e.message}`);
    }
    
  } finally {
    client.release();
  }
}

async function checkCurrentServerProcesses() {
  console.log('\n=== Current Server Processes ===');
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    // Check what's listening on common ports
    const ports = [3000, 8080, 8000, 5000];
    for (const port of ports) {
      try {
        const { stdout } = await execAsync(`lsof -i :${port}`);
        if (stdout.trim()) {
          console.log(`Port ${port}:`);
          console.log(stdout);
        }
      } catch (e) {
        console.log(`Port ${port}: Not in use`);
      }
    }
  } catch (e) {
    console.log('Error checking processes:', e.message);
  }
}

async function main() {
  try {
    await checkServerConfiguration();
    await checkCurrentServerProcesses();
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();