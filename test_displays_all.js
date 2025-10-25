#!/usr/bin/env node

const https = require('https');

const BASE_URL = 'https://app.ordertech.me';
const TENANT_ID = '450202'; // 6-digit company code

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

async function testDisplaysEndpoint() {
  console.log('Testing /presence/displays endpoint...');
  console.log('=====================================');
  
  try {
    const response = await makeRequest('/presence/displays', {
      'x-tenant-id': TENANT_ID
    });
    
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(response.data, null, 2));
    
    if (response.data?.items) {
      const items = response.data.items;
      console.log(`\nFound ${items.length} display devices:`);
      
      items.forEach(device => {
        console.log(`- ${device.name} (${device.id})`);
        console.log(`  Branch: ${device.branch || 'N/A'}`);
        console.log(`  Status: ${device.status || 'unknown'}`);
        console.log(`  Online: ${device.online}`);
        console.log(`  Connected: ${device.connected}`);
        console.log(`  Busy: ${device.busy}`);
        console.log(`  Last seen: ${device.last_seen || 'N/A'}`);
        console.log();
      });
      
      const onlineCount = items.filter(d => d.online).length;
      const offlineCount = items.filter(d => !d.online).length;
      const busyCount = items.filter(d => d.busy).length;
      
      console.log(`Summary:`);
      console.log(`- Total devices: ${items.length}`);
      console.log(`- Online: ${onlineCount}`);
      console.log(`- Offline: ${offlineCount}`);
      console.log(`- Busy: ${busyCount}`);
    }
    
  } catch (error) {
    console.error('Error testing endpoint:', error);
  }
}

testDisplaysEndpoint();