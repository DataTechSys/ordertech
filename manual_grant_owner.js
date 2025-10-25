#!/usr/bin/env node

/**
 * Manual database script to grant owner access to hussain@mosawi.com
 * This bypasses the API and works directly with the database
 */

const { Client } = require('pg');

async function manualGrantOwner() {
  console.log('🔧 Manually granting owner access to hussain@mosawi.com for Koobs tenant');
  
  const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  const USER_EMAIL = 'hussain@mosawi.com';
  
  // Try connecting via Cloud Run proxy first, then fallback to other methods
  let client;
  
  try {
    // Option 1: Try Cloud SQL proxy connection
    client = new Client({
      host: '/cloudsql/smart-order-469705:me-central1:ordertech-db',
      database: 'postgres',
      user: 'postgres',
      password: process.env.PGPASSWORD || 'your_password_here',
      port: 5432
    });
  } catch {
    // Option 2: Try localhost proxy
    try {
      client = new Client({
        host: '127.0.0.1',
        port: 6555,
        database: 'postgres',
        user: 'postgres',
        password: process.env.PGPASSWORD || 'your_password_here'
      });
    } catch {
      console.log('❌ Could not establish database connection');
      console.log('💡 Please run the following SQL commands manually:');
      
      console.log('\n-- 1. Ensure user exists');
      console.log(`INSERT INTO users (id, email, created_at) VALUES (gen_random_uuid(), '${USER_EMAIL}', now()) ON CONFLICT (email) DO NOTHING;`);
      
      console.log('\n-- 2. Demote any existing owners');
      console.log(`UPDATE tenant_users SET role='admin' WHERE tenant_id='${KOOBS_TENANT_ID}' AND role='owner';`);
      
      console.log('\n-- 3. Grant owner role');
      console.log(`INSERT INTO tenant_users (tenant_id, user_id, role, created_at)`);
      console.log(`SELECT '${KOOBS_TENANT_ID}', u.id, 'owner', now()`);
      console.log(`FROM users u WHERE u.email = '${USER_EMAIL}'`);
      console.log(`ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner';`);
      
      console.log('\n-- 4. Verify the grant');
      console.log(`SELECT tu.role, u.email, t.company_name FROM tenant_users tu`);
      console.log(`JOIN users u ON u.id = tu.user_id`);
      console.log(`JOIN tenants t ON t.tenant_id = tu.tenant_id`);
      console.log(`WHERE tu.tenant_id = '${KOOBS_TENANT_ID}' AND u.email = '${USER_EMAIL}';`);
      
      return;
    }
  }
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Step 1: Ensure user exists
    console.log('👤 Ensuring user exists...');
    const userResult = await client.query(
      `INSERT INTO users (id, email, created_at) VALUES (gen_random_uuid(), $1, now()) 
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [USER_EMAIL]
    );
    
    if (userResult.rows.length === 0) {
      // User already exists, get their ID
      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [USER_EMAIL]);
      console.log(`✅ User already exists with ID: ${existingUser.rows[0].id}`);
    } else {
      console.log(`✅ Created new user with ID: ${userResult.rows[0].id}`);
    }
    
    // Step 2: Demote any existing owners
    console.log('📉 Demoting existing owners to admin...');
    const demoteResult = await client.query(
      `UPDATE tenant_users SET role='admin' WHERE tenant_id=$1 AND role='owner'`,
      [KOOBS_TENANT_ID]
    );
    console.log(`✅ Demoted ${demoteResult.rowCount} existing owners`);
    
    // Step 3: Grant owner role
    console.log('👑 Granting owner role...');
    const grantResult = await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role, created_at)
       SELECT $1, u.id, 'owner', now()
       FROM users u WHERE u.email = $2
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner'`,
      [KOOBS_TENANT_ID, USER_EMAIL]
    );
    console.log(`✅ Granted owner role (${grantResult.rowCount} rows affected)`);
    
    // Step 4: Verify the grant
    console.log('🔍 Verifying the grant...');
    const verifyResult = await client.query(
      `SELECT tu.role, u.email, t.company_name 
       FROM tenant_users tu
       JOIN users u ON u.id = tu.user_id
       JOIN tenants t ON t.tenant_id = tu.tenant_id
       WHERE tu.tenant_id = $1 AND u.email = $2`,
      [KOOBS_TENANT_ID, USER_EMAIL]
    );
    
    if (verifyResult.rows.length > 0) {
      const result = verifyResult.rows[0];
      console.log(`✅ Success! ${result.email} is now ${result.role} of ${result.company_name}`);
    } else {
      console.log('❌ Verification failed - grant may not have worked');
    }
    
    console.log('\n🎉 Owner access granted successfully!');
    console.log('💡 You can now use the admin UI to manage the Koobs tenant');
    
  } catch (error) {
    console.error('❌ Database operation failed:', error.message);
    
    console.log('\n💡 If database connection failed, run these SQL commands manually:');
    console.log(`-- Connect to your database and execute:`);
    console.log(`INSERT INTO users (id, email, created_at) VALUES (gen_random_uuid(), '${USER_EMAIL}', now()) ON CONFLICT (email) DO NOTHING;`);
    console.log(`UPDATE tenant_users SET role='admin' WHERE tenant_id='${KOOBS_TENANT_ID}' AND role='owner';`);
    console.log(`INSERT INTO tenant_users (tenant_id, user_id, role, created_at) SELECT '${KOOBS_TENANT_ID}', u.id, 'owner', now() FROM users u WHERE u.email = '${USER_EMAIL}' ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner';`);
    
  } finally {
    if (client) {
      await client.end();
    }
  }
}

// Run the manual grant
manualGrantOwner().catch(console.error);