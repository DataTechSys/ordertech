#!/usr/bin/env node

/**
 * Grant admin access to hussain@mosawi.com for Koobs tenant
 */

const { Client } = require('pg');

async function grantKoobsAdmin() {
  console.log('👨‍💼 Granting Koobs tenant admin access to hussain@mosawi.com');
  
  // Use Cloud Run endpoint to avoid local DB connection issues
  const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  const USER_EMAIL = 'hussain@mosawi.com';
  
  try {
    console.log('🔐 Using admin token to grant access...');
    
    // First, let's check if the user exists
    const checkUserResponse = await fetch(`https://ordertech-715493130630.me-central1.run.app/auth/check-email?email=${encodeURIComponent(USER_EMAIL)}`);
    if (checkUserResponse.ok) {
      const userCheck = await checkUserResponse.json();
      console.log(`📧 User ${USER_EMAIL} exists in Firebase:`, userCheck.exists);
    }
    
    // Create a request to grant admin access via HTTP endpoint
    // We'll use the platform admin token for this operation
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'your-admin-token-here';
    
    if (!ADMIN_TOKEN || ADMIN_TOKEN === 'your-admin-token-here') {
      console.log('❌ ADMIN_TOKEN environment variable not set');
      console.log('💡 You need to set the platform admin token');
      
      // Alternative: provide SQL commands to run manually
      console.log('\n📋 Manual SQL commands to run:');
      console.log('-- 1. Ensure user exists in users table');
      console.log(`INSERT INTO users (id, email, created_at) VALUES (gen_random_uuid(), '${USER_EMAIL}', now()) ON CONFLICT (email) DO NOTHING;`);
      
      console.log('\n-- 2. Grant admin role to user for Koobs tenant');
      console.log(`INSERT INTO tenant_users (tenant_id, user_id, role, created_at)`);
      console.log(`SELECT '${KOOBS_TENANT_ID}', u.id, 'admin'::tenant_role, now()`);
      console.log(`FROM users u WHERE u.email = '${USER_EMAIL}'`);
      console.log(`ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin'::tenant_role;`);
      
      console.log('\n-- 3. Verify the grant');
      console.log(`SELECT tu.role, u.email, t.company_name FROM tenant_users tu`);
      console.log(`JOIN users u ON u.id = tu.user_id`);
      console.log(`JOIN tenants t ON t.tenant_id = tu.tenant_id`);
      console.log(`WHERE tu.tenant_id = '${KOOBS_TENANT_ID}' AND u.email = '${USER_EMAIL}';`);
      
      return;
    }
    
    console.log('🚀 Attempting to grant access via API...');
    
    // This would be the ideal approach if we had an endpoint for it
    console.log('⚠️  Direct API grant not available. Using manual SQL approach instead.');
    console.log('\n📋 SQL commands to grant access:');
    
    console.log('\n-- 1. Connect to your database and run:');
    console.log(`INSERT INTO users (id, email, created_at) VALUES (gen_random_uuid(), '${USER_EMAIL}', now()) ON CONFLICT (email) DO NOTHING;`);
    
    console.log('\n-- 2. Grant admin role:');
    console.log(`INSERT INTO tenant_users (tenant_id, user_id, role, created_at)`);
    console.log(`SELECT '${KOOBS_TENANT_ID}', u.id, 'admin'::tenant_role, now()`);
    console.log(`FROM users u WHERE u.email = '${USER_EMAIL}'`);
    console.log(`ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin'::tenant_role;`);
    
  } catch (error) {
    console.error('❌ Failed to grant access:', error.message);
  }
}

async function testAccess() {
  console.log('\n🧪 Testing access after grant...');
  
  const testToken = process.argv[2];
  if (!testToken) {
    console.log('⚠️  No test token provided. Usage: node grant_koobs_admin.js <your_bearer_token>');
    return;
  }
  
  try {
    const response = await fetch('https://ordertech-715493130630.me-central1.run.app/admin/tenants/f8578f9c-782b-4d31-b04f-3b2d890c5896/modifiers/options', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Access granted successfully!');
      console.log(`Found ${data.items?.length || 0} modifier options`);
    } else {
      const errorText = await response.text();
      console.log('❌ Access test failed:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the grant process
grantKoobsAdmin().then(() => {
  if (process.argv[2]) {
    return testAccess();
  }
}).catch(console.error);