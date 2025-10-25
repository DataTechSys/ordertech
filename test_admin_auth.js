#!/usr/bin/env node

// Admin Panel Authentication Test
// This script tests the OrderTech admin authentication and endpoints

const http = require('http');
const https = require('https');

const baseURL = process.env.API_BASE_URL || 'http://localhost:3000';

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseURL);
    const requestModule = url.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers
      }
    };

    const req = requestModule.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch {
          resolve({ status: res.statusCode, data: data || res.statusMessage });
        }
      });
    });

    req.on('error', reject);
    req.end(options.body ? JSON.stringify(options.body) : undefined);
  });
}

async function runTests() {
  console.log('🧪 OrderTech Admin Authentication Tests');
  console.log('=====================================\n');

  const tests = [
    {
      name: 'Check server configuration',
      path: '/config.js',
      check: (result) => {
        const hasDevOpen = String(result.data).includes('devOpenAdmin=true');
        return {
          pass: hasDevOpen,
          message: hasDevOpen ? '✅ DEV_OPEN_ADMIN is enabled' : '❌ DEV_OPEN_ADMIN not found'
        };
      }
    },
    {
      name: 'Test admin tenants endpoint',
      path: '/admin/tenants',
      check: (result) => ({
        pass: result.status === 200,
        message: result.status === 200 
          ? `✅ Admin tenants accessible (found ${Array.isArray(result.data) ? result.data.length : '?'} tenants)`
          : `❌ Failed with status ${result.status}: ${JSON.stringify(result.data)}`
      })
    },
    {
      name: 'Test user tenants endpoint',
      path: '/admin/my/tenants',
      check: (result) => ({
        pass: result.status === 200,
        message: result.status === 200 
          ? `✅ User tenants accessible (found ${Array.isArray(result.data) ? result.data.length : '?'} tenants)`
          : `❌ Failed with status ${result.status}: ${JSON.stringify(result.data)}`
      })
    },
    {
      name: 'Test tenant resolve',
      path: '/tenant/resolve',
      check: (result) => ({
        pass: result.status === 200,
        message: result.status === 200 
          ? `✅ Tenant resolution working (tenant: ${result.data?.name || result.data?.id || 'unknown'})`
          : `❌ Failed with status ${result.status}: ${JSON.stringify(result.data)}`
      })
    },
    {
      name: 'Test admin shell access',
      path: '/admin',
      check: (result) => ({
        pass: result.status === 200,
        message: result.status === 200 
          ? '✅ Admin shell accessible'
          : `❌ Admin shell failed with status ${result.status}`
      })
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    process.stdout.write(`${test.name}... `);
    
    try {
      const result = await makeRequest(test.path);
      const check = test.check(result);
      
      console.log(check.message);
      
      if (check.pass) {
        passed++;
      } else {
        failed++;
        if (result.status !== 200) {
          console.log(`   Response: ${JSON.stringify(result.data).substring(0, 200)}${JSON.stringify(result.data).length > 200 ? '...' : ''}`);
        }
      }
    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
      failed++;
    }
    
    console.log();
  }

  console.log('📊 Test Summary');
  console.log('===============');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! The admin panel should be working correctly.');
    console.log(`🌐 You can access the admin panel at: ${baseURL}/admin`);
  } else {
    console.log('\n⚠️  Some tests failed. Check the server logs and configuration.');
  }

  // Additional diagnostic info
  console.log('\n🔍 Diagnostic Information');
  console.log('=========================');
  console.log(`Base URL: ${baseURL}`);
  console.log(`Node.js Version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  
  try {
    const configResult = await makeRequest('/config.json');
    if (configResult.status === 200) {
      console.log('Server Config:', JSON.stringify(configResult.data, null, 2));
    }
  } catch (error) {
    console.log('Could not fetch server config:', error.message);
  }
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { makeRequest, runTests };