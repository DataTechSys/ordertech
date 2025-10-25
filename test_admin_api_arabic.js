#!/usr/bin/env node

// Test script to check if the admin products API returns Arabic names
const https = require('https');
const http = require('http');

const API_HOST = process.env.API_HOST || 'app.ordertech.me';
const API_PROTOCOL = process.env.API_PROTOCOL || 'https';
const TENANT_ID = process.env.TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae'; // Koobs Café
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // Set this if you have admin token

async function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const client = API_PROTOCOL === 'https' ? https : http;
    const port = API_PROTOCOL === 'https' ? 443 : (process.env.PORT || 5050);
    
    const requestOptions = {
      hostname: API_HOST,
      port: port,
      path: path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrderTech-Test/1.0',
        ...(options.headers || {})
      }
    };
    
    if (ADMIN_TOKEN) {
      requestOptions.headers['x-admin-token'] = ADMIN_TOKEN;
    }

    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function testAdminProductsAPI() {
  console.log('🧪 Testing Admin Products API for Arabic names...\n');
  console.log(`📡 API: ${API_PROTOCOL}://${API_HOST}`);
  console.log(`🏢 Tenant: ${TENANT_ID}`);
  console.log(`🔑 Admin Token: ${ADMIN_TOKEN ? 'Provided' : 'Not provided'}\n`);

  try {
    // Test the admin products endpoint
    const response = await makeRequest(`/admin/tenants/${TENANT_ID}/products?status=all`);
    
    console.log(`📊 Response Status: ${response.status}`);
    
    if (response.status !== 200) {
      console.error('❌ API request failed:', response.data);
      return;
    }

    const products = Array.isArray(response.data) ? response.data : [];
    console.log(`📦 Total products: ${products.length}\n`);

    if (products.length === 0) {
      console.log('⚠️ No products found in the response');
      return;
    }

    // Check for Arabic names
    const productsWithArabic = products.filter(p => p.name_localized && p.name_localized.trim().length > 0);
    console.log(`🔤 Products with Arabic names: ${productsWithArabic.length}`);
    console.log(`📊 Coverage: ${Math.round((productsWithArabic.length / products.length) * 100)}%\n`);

    if (productsWithArabic.length > 0) {
      console.log('✅ Sample products with Arabic names:');
      productsWithArabic.slice(0, 10).forEach((product, i) => {
        console.log(`   ${i + 1}. "${product.name}" → "${product.name_localized}" [${product.sku || 'no-sku'}]`);
      });
    } else {
      console.log('❌ No products with Arabic names found!');
      console.log('\n📋 Sample products (checking if name_localized field exists):');
      products.slice(0, 5).forEach((product, i) => {
        console.log(`   ${i + 1}. "${product.name}" | name_localized: ${JSON.stringify(product.name_localized)} [${product.sku || 'no-sku'}]`);
      });
    }

    // Check API response structure
    console.log('\n🔍 API Response Structure:');
    if (products.length > 0) {
      const sampleProduct = products[0];
      const hasNameLocalized = 'name_localized' in sampleProduct;
      const nameLocalizedValue = sampleProduct.name_localized;
      
      console.log(`   - Has 'name_localized' field: ${hasNameLocalized ? '✅' : '❌'}`);
      console.log(`   - Sample name_localized value: ${JSON.stringify(nameLocalizedValue)}`);
      console.log(`   - Sample product keys:`, Object.keys(sampleProduct).sort());
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testAdminProductsAPI().catch(console.error);