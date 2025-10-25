#!/usr/bin/env node

const http = require('http');

const BASE_URL = 'http://localhost:8080';

function makeRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 8080,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrderTech-Debug/1.0',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
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

async function checkLocalRoutes() {
  console.log('Checking LOCAL server routes...');
  console.log('================================');
  
  try {
    const response = await makeRequest('/__routes');
    console.log('Routes endpoint status:', response.status);
    
    if (response.status === 200 && Array.isArray(response.data)) {
      console.log('Total routes found:', response.data.length);
      
      const deviceRoutes = response.data.filter(route => 
        route.path && (
          route.path.includes('device') || 
          route.path.includes('presence') || 
          route.path.includes('display')
        )
      );
      
      console.log('\nDevice/Display/Presence related routes:');
      deviceRoutes.forEach(route => console.log(`  ${route.method} ${route.path}`));
      
      console.log('\nOther interesting routes:');
      const adminRoutes = response.data.filter(route => 
        route.path && (
          route.path.includes('/admin/') || 
          route.path.includes('/tenant') ||
          route.path.includes('/activation')
        )
      );
      adminRoutes.slice(0, 10).forEach(route => console.log(`  ${route.method} ${route.path}`));
      console.log(`  ... and ${Math.max(0, adminRoutes.length - 10)} more admin routes`);
      
    } else {
      console.log('No routes data available');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkLocalRoutes();