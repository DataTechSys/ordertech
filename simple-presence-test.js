#!/usr/bin/env node

const https = require('https');

// Configuration  
const BASE_URL = 'https://app.ordertech.me';
const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs tenant ID

// Function to make HTTP request
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            json: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            json: null
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

// Check current presence list
async function checkPresence() {
  const options = {
    hostname: 'app.ordertech.me',
    path: '/presence/displays',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT_ID
    }
  };
  
  try {
    const response = await makeRequest(options);
    if (response.status === 200 && response.json) {
      console.log(`📋 Current presence list (${response.json.items?.length || 0} displays):`);
      if (response.json.items && response.json.items.length > 0) {
        response.json.items.forEach(item => {
          console.log(`  - ${item.name || item.id} (${item.id}) - Branch: ${item.branch || 'None'} - Online: ${item.online} - Busy: ${item.busy}`);
        });
      } else {
        console.log('  (no displays currently showing presence)');
      }
      return response.json.items || [];
    } else {
      console.log(`✗ Failed to check presence: ${response.status} ${response.body}`);
      return [];
    }
  } catch (error) {
    console.error('✗ Error checking presence:', error.message);
    return [];
  }
}

// Try to send presence with various token formats
async function testPresenceWithToken(tokenFormat, displayId, displayName) {
  console.log(`Testing token format: ${tokenFormat}`);
  
  const options = {
    hostname: 'app.ordertech.me',
    path: '/presence/display',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT_ID,
      'x-device-token': tokenFormat
    }
  };
  
  const payload = {
    id: displayId,
    name: displayName,
    branch: 'Test Branch'
  };
  
  try {
    const response = await makeRequest(options, payload);
    console.log(`  Status: ${response.status} - ${response.body}`);
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

// Main function
async function main() {
  console.log('🧪 Simple Presence Testing');
  console.log(`📍 Target: ${BASE_URL}`);
  console.log(`🏢 Tenant: ${TENANT_ID}`);
  console.log('');
  
  // Check initial presence
  console.log('Initial presence check:');
  await checkPresence();
  console.log('');
  
  // Test different token formats that might work with the local server
  const testTokens = [
    // Based on the server code pattern for local tokens
    `local_${Date.now()}_1`,
    `local_${Date.now()}_2`,
    `dev_token_${Math.random().toString(36).substr(2, 8)}`,
    // Simple formats
    'test_token_1',
    'test_token_2',
    // UUID-like format
    `${Math.random().toString(36).substr(2, 8)}-${Math.random().toString(36).substr(2, 4)}-${Math.random().toString(36).substr(2, 4)}`
  ];
  
  console.log('🔬 Testing different token formats...\n');
  
  for (let i = 0; i < testTokens.length; i++) {
    const token = testTokens[i];
    const displayId = `TEST-DISPLAY-${i + 1}`;
    const displayName = `Test Display ${i + 1}`;
    
    const success = await testPresenceWithToken(token, displayId, displayName);
    if (success) {
      console.log(`✅ SUCCESS! Token format works: ${token}`);
      console.log('Checking presence after successful update...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await checkPresence();
      break;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log('\nTest complete.');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}