#!/usr/bin/env node
// setup_foodics_token.js
// Store Foodics API token in saas.tenants for Koobs Cafe

const { Pool } = require('pg');

// Read token from environment or .env.local
require('dotenv').config({ path: '.env.local' });

const FOODICS_TOKEN = process.env.FOODICS_TOKEN;
const FOODICS_ID = '494675'; // Koobs Cafe

if (!FOODICS_TOKEN) {
  console.error('❌ FOODICS_TOKEN not found in environment');
  console.error('   Set it in .env.local or pass as environment variable');
  process.exit(1);
}

async function setupToken() {
  const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: process.env.PGPORT || 6555,
    database: process.env.PGDATABASE || 'ordertech',
    user: process.env.PGUSER || 'ordertech',
    password: process.env.PGPASSWORD || 'Ordertech.2020'
  });

  try {
    console.log('🔍 Checking for tenant...');
    
    // Check if tenant exists
    const checkResult = await pool.query(
      'SELECT tenant_id, foodics_id, company_name FROM saas.tenants WHERE foodics_id = $1',
      [FOODICS_ID]
    );
    
    if (checkResult.rows.length === 0) {
      console.error(`❌ Tenant with foodics_id ${FOODICS_ID} not found`);
      process.exit(1);
    }
    
    const tenant = checkResult.rows[0];
    console.log(`✅ Found tenant: ${tenant.company_name} (${tenant.tenant_id})`);
    
    // Update meta with token
    console.log('💾 Storing Foodics API token...');
    await pool.query(
      `UPDATE saas.tenants 
       SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('foodics_api_token', $1)
       WHERE foodics_id = $2`,
      [FOODICS_TOKEN, FOODICS_ID]
    );
    
    console.log('✅ Foodics API token stored successfully!');
    console.log('');
    console.log('🎯 You can now access the sales dashboard:');
    console.log('   https://foodics.ordertech.me/sales.html');
    console.log('   https://ordertech-715493130630.me-central1.run.app/foodics/sales.html');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupToken();
