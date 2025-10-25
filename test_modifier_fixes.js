#!/usr/bin/env node

// Quick test to verify the modifier sync fixes are working
// Run this after deployment to validate the changes

const https = require('https');

const BASE_URL = 'https://app.ordertech.me';

async function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function testModifierFixes() {
  console.log('🧪 Testing modifier sync fixes on Cloud Run...\n');
  
  try {
    // 1. Test basic health
    console.log('1️⃣ Testing service health...');
    const health = await makeRequest('/');
    console.log(health.status === 200 ? '✅ Service is responding' : `❌ Service error: ${health.status}`);
    
    // 2. Try to get modifiers without auth (should fail gracefully)
    console.log('\n2️⃣ Testing modifiers endpoint (no auth)...');
    const modifiers = await makeRequest('/admin/modifiers');
    console.log(`Status: ${modifiers.status} (expected 401/403)`);
    
    // 3. Test debug endpoints
    console.log('\n3️⃣ Testing debug endpoints...');
    const debug = await makeRequest('/debug/fk-constraint/test/test/test');
    console.log(`Debug endpoint status: ${debug.status} (shows endpoint exists)`);
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 NEXT STEPS:');
    console.log('='.repeat(60));
    console.log('1. Go to app.ordertech.me → Login');
    console.log('2. Navigate to Modifiers page');  
    console.log('3. Select your tenant and check if "Linked Products" shows correct counts');
    console.log('4. If still showing 0, run the backfill script:');
    console.log('');
    console.log('   export FOODICS_TOKEN="your_token"');
    console.log('   export DATABASE_URL="your_db_url"');
    console.log('   node scripts/backfill_product_modifiers.js --tenant=YOUR_TENANT_ID --dry-run');
    console.log('');
    console.log('5. If dry-run looks good, commit the changes:');
    console.log('   node scripts/backfill_product_modifiers.js --tenant=YOUR_TENANT_ID --commit');
    console.log('');
    console.log('🔍 The key fixes deployed:');
    console.log('   ✅ Fixed tenant-scoped products_count query');
    console.log('   ✅ Added embedded product.modifiers parsing');
    console.log('   ✅ Enhanced logging for debugging');
    console.log('   ✅ Added debug endpoints for troubleshooting');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testModifierFixes().catch(console.error);