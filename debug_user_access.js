#!/usr/bin/env node

/**
 * Debug script to check user access and tenant permissions
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://smart-order-469705-default-rtdb.firebaseio.com/`
  });
}

async function debugUserAccess() {
  console.log('🔍 Debugging User Access and Authentication');
  
  const testToken = process.argv[2];
  if (!testToken) {
    console.log('Usage: node debug_user_access.js <bearer_token>');
    console.log('❌ No Bearer token provided');
    return;
  }
  
  try {
    console.log('🎫 Verifying Firebase ID token...');
    const decoded = await admin.auth().verifyIdToken(testToken);
    console.log('✅ Token verified successfully!');
    console.log(`  User: ${decoded.email}`);
    console.log(`  UID: ${decoded.uid}`);
    console.log(`  Email verified: ${decoded.email_verified}`);
    
    // Test the server authentication endpoint
    console.log('\n🔐 Testing server authentication...');
    const response = await fetch('https://ordertech-715493130630.me-central1.run.app/admin/tenants/f8578f9c-782b-4d31-b04f-3b2d890c5896/modifiers/options', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`  Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ API call successful!');
      console.log(`  Options found: ${data.items?.length || 0}`);
    } else {
      const errorText = await response.text();
      console.log('❌ API call failed:');
      console.log(`  Response: ${errorText}`);
      
      if (response.status === 401) {
        console.log('\n🔍 Possible causes:');
        console.log('  - Token expired (Firebase tokens last 1 hour)');
        console.log('  - User not found in database');
        console.log('  - Email verification required but not completed');
      } else if (response.status === 403) {
        console.log('\n🔍 Possible causes:');
        console.log('  - User exists but not authorized for this tenant');
        console.log('  - User role is insufficient (needs owner/admin)');
        console.log('  - Tenant permissions not set up correctly');
      }
    }
    
    console.log('\n🏢 Testing tenant resolution...');
    const tenantResponse = await fetch('https://ordertech-715493130630.me-central1.run.app/tenant/resolve', {
      method: 'GET',
      headers: {
        'x-tenant-id': 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
      }
    });
    
    if (tenantResponse.ok) {
      const tenant = await tenantResponse.json();
      console.log('✅ Tenant found:');
      console.log(`  ID: ${tenant.id}`);
      console.log(`  Name: ${tenant.name}`);
    } else {
      console.log('❌ Tenant lookup failed');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    
    if (error.code === 'auth/id-token-expired') {
      console.log('\n💡 Token has expired. Please get a new token from the browser:');
      console.log('   1. Open browser dev tools');
      console.log('   2. Go to Application/Storage > Local Storage');
      console.log('   3. Find the Firebase auth token');
      console.log('   4. Or check Network tab for Authorization headers');
    } else if (error.code === 'auth/argument-error') {
      console.log('\n💡 Invalid token format. Make sure to copy the full JWT token.');
    }
  }
}

// Run debug
debugUserAccess().catch(console.error);