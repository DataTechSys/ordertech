#!/usr/bin/env node

// Test the /presence/displays endpoint directly to debug why cashier app sees no displays

const https = require('https');

async function testPresenceDisplays() {
  console.log('🔍 Testing /presence/displays endpoint...');
  
  // Test without any headers (should fail but show error)
  console.log('\n1️⃣ Testing without authentication:');
  try {
    const result1 = await makeRequest('/presence/displays');
    console.log('✅ Response:', result1.substring(0, 200) + '...');
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  // Test with just a tenant ID (common scenario)
  console.log('\n2️⃣ Testing with tenant ID only:');
  const DEFAULT_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // From earlier server logs
  try {
    const result2 = await makeRequest('/presence/displays', {
      'x-tenant-id': DEFAULT_TENANT_ID
    });
    console.log('✅ Response:', result2);
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  // Test with a different tenant ID (Company ID 494675 from admin dashboard)
  console.log('\n3️⃣ Testing with Company ID 494675:');
  try {
    const result3 = await makeRequest('/presence/displays', {
      'x-tenant-id': '494675'
    });
    console.log('✅ Response:', result3);
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  // Test with a cashier device token if available
  console.log('\n4️⃣ Testing with a sample cashier token:');
  try {
    const result4 = await makeRequest('/presence/displays', {
      'x-tenant-id': DEFAULT_TENANT_ID,
      'x-device-token': 'sample-token'
    });
    console.log('✅ Response:', result4);
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

function makeRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'app.ordertech.me',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Test-Script/1.0',
        ...headers
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    req.end();
  });
}

testPresenceDisplays().catch(console.error);