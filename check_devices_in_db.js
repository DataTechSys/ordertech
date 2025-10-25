#!/usr/bin/env node

const https = require('https');

const BASE_URL = 'https://app.ordertech.me';
const TENANT_ID = '450202'; // 6-digit company code

function makeRequest(path, headers = {}, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrderTech-Debug/1.0',
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function checkDevicesAndTenant() {
  console.log('Checking devices and tenant information...');
  console.log('==========================================');
  
  try {
    // First, try to get tenant info by company code
    console.log('\n1. Checking tenant resolution for company code:', TENANT_ID);
    const tenantResponse = await makeRequest(`/tenant/by-code/${TENANT_ID}/domain`);
    console.log('Tenant resolution status:', tenantResponse.status);
    console.log('Tenant response:', JSON.stringify(tenantResponse.data, null, 2));
    
    // Try the presence/displays endpoint with verbose headers
    console.log('\n2. Testing /presence/displays endpoint...');
    const displaysResponse = await makeRequest('/presence/displays', {
      'x-tenant-id': TENANT_ID
    });
    console.log('Displays endpoint status:', displaysResponse.status);
    console.log('Displays response:', JSON.stringify(displaysResponse.data, null, 2));
    
    // Check if we can access admin endpoints (might need auth)
    console.log('\n3. Trying to get device list via different approach...');
    
    // Let's try to see what endpoints are available
    const routesResponse = await makeRequest('/__routes');
    console.log('Routes endpoint status:', routesResponse.status);
    if (routesResponse.status === 200 && routesResponse.data) {
      console.log('Available routes found:', routesResponse.data.length || 0);
      const deviceRoutes = (routesResponse.data || []).filter(route => 
        route.path && (route.path.includes('device') || route.path.includes('presence'))
      );
      console.log('Device-related routes:');
      deviceRoutes.forEach(route => console.log(`  ${route.method} ${route.path}`));
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkDevicesAndTenant();