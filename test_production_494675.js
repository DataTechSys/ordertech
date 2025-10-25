#!/usr/bin/env node

const https = require('https');

const BASE_URL = 'https://app.ordertech.me';
const COMPANY_CODE = '494675'; // Correct Koobs company code
const TENANT_UUID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs cafe UUID

function makeRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrderTech-Test/1.0',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function testProductionWithCorrectCode() {
  console.log('Testing PRODUCTION server with correct company code...');
  console.log('=====================================================');
  console.log('Company code:', COMPANY_CODE);
  console.log('Tenant UUID:', TENANT_UUID);
  console.log();
  
  try {
    // Test 1: Check tenant resolution with correct company code
    console.log('1. Testing tenant resolution with company code:', COMPANY_CODE);
    const tenantResponse = await makeRequest(`/tenant/by-code/${COMPANY_CODE}/domain`);
    console.log('Tenant resolution status:', tenantResponse.status);
    console.log('Tenant response:', JSON.stringify(tenantResponse.data, null, 2));
    console.log();

    // Test 2: Check displays endpoint with company code
    console.log('2. Testing /presence/displays with company code:', COMPANY_CODE);
    const displaysWithCode = await makeRequest('/presence/displays', {
      'x-tenant-id': COMPANY_CODE
    });
    console.log('Status:', displaysWithCode.status);
    console.log('Response:', JSON.stringify(displaysWithCode.data, null, 2));
    console.log();

    // Test 3: Check displays endpoint with UUID
    console.log('3. Testing /presence/displays with tenant UUID:', TENANT_UUID);
    const displaysWithUUID = await makeRequest('/presence/displays', {
      'x-tenant-id': TENANT_UUID
    });
    console.log('Status:', displaysWithUUID.status);
    console.log('Response:', JSON.stringify(displaysWithUUID.data, null, 2));
    
    // Summary
    console.log('\n=== SUMMARY ===');
    const codeItems = displaysWithCode.data?.items || [];
    const uuidItems = displaysWithUUID.data?.items || [];
    
    console.log(`Company code ${COMPANY_CODE}: ${codeItems.length} devices found`);
    console.log(`Tenant UUID: ${uuidItems.length} devices found`);
    
    if (codeItems.length === 0 && uuidItems.length === 0) {
      console.log('\n⚠️  Issue: No devices found with either identifier');
      console.log('   Possible causes:');
      console.log('   1. Production server changes not deployed yet');
      console.log('   2. No display devices registered for this tenant');
      console.log('   3. Devices exist but are filtered out (old logic)');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testProductionWithCorrectCode();