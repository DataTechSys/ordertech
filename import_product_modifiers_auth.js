#!/usr/bin/env node

/**
 * Import product modifier relationships from CSV to OrderTech via authenticated API
 * This script handles authentication and uses the correct endpoint for product-modifier links
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

// Configuration - Update these values
const CONFIG = {
  baseUrl: 'https://app.ordertech.me',
  tenantId: 'f8578f9c-782b-4d31-b04f-3b2d890c5896', // Full Koobs tenant ID
  csvFile: path.join(__dirname, 'test_product_modifiers.csv'),
  // Authentication - you'll need to get these values
  adminToken: 'dev', // Platform admin token
  authToken: null   // Set if you have a Firebase ID token
};

/**
 * Make authenticated HTTP request
 */
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

/**
 * Import the CSV file
 */
async function importCSV() {
  console.log('🔄 Starting product-modifier relationships import...');
  
  // Check if CSV file exists
  if (!fs.existsSync(CONFIG.csvFile)) {
    console.error('❌ CSV file not found:', CONFIG.csvFile);
    process.exit(1);
  }

  // Read CSV data
  const csvData = fs.readFileSync(CONFIG.csvFile);
  console.log(`📄 CSV file size: ${csvData.length} bytes`);

  // Setup request headers
  const headers = {
    'Content-Type': 'text/csv',
    'Content-Length': csvData.length,
    'User-Agent': 'OrderTech-Import-Script/1.0'
  };

  // Add authentication headers
  if (CONFIG.adminToken) {
    headers['x-admin-token'] = CONFIG.adminToken;
    console.log('🔑 Using admin token authentication');
  }
  
  if (CONFIG.authToken) {
    headers['Authorization'] = `Bearer ${CONFIG.authToken}`;
    console.log('🔑 Using Firebase ID token authentication');
  }

  if (CONFIG.tenantId) {
    headers['x-tenant-id'] = CONFIG.tenantId;
    console.log(`🏢 Tenant ID: ${CONFIG.tenantId}`);
  }

  if (!CONFIG.adminToken && !CONFIG.authToken) {
    console.error('❌ No authentication tokens provided!');
    console.log('Please set CONFIG.adminToken or CONFIG.authToken in the script');
    process.exit(1);
  }

  // Make the import request
  const url = new URL(`${CONFIG.baseUrl}/admin/tenants/${CONFIG.tenantId}/products/modifiers/import`);
  
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers
  };

  console.log(`🚀 Making request to: ${url.toString()}`);
  
  try {
    const response = await makeRequest(options, csvData);
    
    console.log(`📊 Response Status: ${response.status}`);
    
    if (response.status === 200 || response.status === 201) {
      console.log('✅ Import successful!');
      console.log('📈 Results:', response.data);
      
      if (response.data.linked) {
        console.log(`🔗 Successfully linked ${response.data.linked} product-modifier relationships`);
      }
      if (response.data.created_groups) {
        console.log(`➕ Created ${response.data.created_groups} new modifier groups`);
      }
      if (response.data.missing_products) {
        console.log(`⚠️  ${response.data.missing_products} products not found`);
      }
      if (response.data.missing_groups) {
        console.log(`⚠️  ${response.data.missing_groups} modifier groups could not be created`);
      }
      
    } else if (response.status === 401) {
      console.error('❌ Authentication failed (401)');
      console.log('Please check your authentication tokens and tenant access');
      console.log('Response:', response.data);
      
    } else if (response.status === 403) {
      console.error('❌ Forbidden (403) - insufficient permissions');
      console.log('Please ensure you have tenant admin access');
      console.log('Response:', response.data);
      
    } else if (response.status === 404) {
      console.error('❌ Tenant not found (404)');
      console.log('Please check your tenant ID');
      console.log('Response:', response.data);
      
    } else {
      console.error(`❌ Import failed with status ${response.status}`);
      console.log('Response:', response.data);
    }
    
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    process.exit(1);
  }
}

/**
 * Get authentication instructions
 */
function showAuthInstructions() {
  console.log('\n📋 Authentication Setup Instructions:\n');
  
  console.log('Option 1 - Admin Token (if you have platform admin access):');
  console.log('1. Set CONFIG.adminToken = "dev" (for local) or your admin token');
  console.log('2. Make sure hussain@mosawi.com is in PLATFORM_ADMIN_EMAILS\n');
  
  console.log('Option 2 - Firebase ID Token:');
  console.log('1. Go to https://app.ordertech.me/products/');
  console.log('2. Open browser dev tools (F12)');
  console.log('3. Go to Application tab > Local Storage > app.ordertech.me');
  console.log('4. Copy the value of "firebase-auth-token" or similar');
  console.log('5. Set CONFIG.authToken = "your-copied-token"\n');
  
  console.log('Option 3 - Get tenant ID:');
  console.log('1. Complete the tenant ID in CONFIG.tenantId');
  console.log('2. You can find it in the URL when browsing products\n');
}

// Main execution
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showAuthInstructions();
    process.exit(0);
  }
  
  importCSV().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

module.exports = { importCSV, CONFIG };