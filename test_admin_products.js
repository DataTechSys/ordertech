#!/usr/bin/env node
// Test Admin Products Page Functionality

const BASE_URL = 'http://localhost:3000';
const FOUZI_TENANT_ID = '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Simple HTTP client using Node.js built-ins
const makeRequest = (url, options = {}) => {
  const https = require('https');
  const http = require('http');
  const { URL } = require('url');
  
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const response = {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data: data
        };
        
        try {
          if (data) response.json = JSON.parse(data);
        } catch (e) {
          response.json = null;
        }
        
        resolve(response);
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
};

async function testFlow() {
  console.log('🧪 Testing Admin Products Page Flow\n');
  
  try {
    // Test 1: Verify admin products endpoint
    console.log('1. Testing admin products API...');
    const productsResponse = await makeRequest(`${BASE_URL}/admin/products?tenant_id=${FOUZI_TENANT_ID}&limit=3`);
    
    if (!productsResponse.ok) {
      console.log('❌ Admin products API failed:', productsResponse.status);
      return;
    }
    
    const products = productsResponse.json?.items || [];
    console.log(`✅ Found ${products.length} products`);
    
    // Test 2: Check first product image URL
    if (products.length > 0) {
      const firstProduct = products[0];
      console.log(`\n2. Testing first product: ${firstProduct.name}`);
      console.log(`   Original image URL: ${firstProduct.image_url}`);
      
      if (firstProduct.image_url && (firstProduct.image_url.includes('foodics') || firstProduct.image_url.includes('amazonaws'))) {
        const proxyUrl = `${BASE_URL}/img?u=${encodeURIComponent(firstProduct.image_url)}`;
        console.log(`   Expected proxy URL: ${proxyUrl}`);
        
        // Test 3: Verify proxy works
        console.log('\n3. Testing image proxy...');
        const proxyResponse = await makeRequest(proxyUrl, { method: 'HEAD' });
        
        if (proxyResponse.ok) {
          console.log('✅ Image proxy working');
        } else {
          console.log('❌ Image proxy failed:', proxyResponse.status);
        }
      }
    }
    
    // Test 4: Check if products page HTML loads
    console.log('\n4. Testing products page HTML...');
    const htmlResponse = await makeRequest(`${BASE_URL}/products/`);
    
    if (htmlResponse.ok) {
      console.log('✅ Products page HTML loads');
      
      // Check if tenant selection is in the HTML
      if (htmlResponse.data.includes('tenantSelect')) {
        console.log('✅ Tenant selection found in HTML');
      } else {
        console.log('⚠️  Tenant selection not found in HTML');
      }
      
      // Check if products.js is referenced
      if (htmlResponse.data.includes('/js/products.js')) {
        console.log('✅ products.js script referenced in HTML');
      } else {
        console.log('❌ products.js script NOT referenced in HTML');
      }
    } else {
      console.log('❌ Products page HTML failed:', htmlResponse.status);
    }
    
    // Test 5: Check JavaScript file
    console.log('\n5. Testing products.js file...');
    const jsResponse = await makeRequest(`${BASE_URL}/js/products.js`);
    
    if (jsResponse.ok) {
      console.log('✅ products.js loads successfully');
      
      // Check if proxy logic is in the file
      if (jsResponse.data.includes('/img?u=')) {
        console.log('✅ Image proxy logic found in products.js');
      } else {
        console.log('❌ Image proxy logic NOT found in products.js');
      }
    } else {
      console.log('❌ products.js failed to load:', jsResponse.status);
    }
    
    console.log('\n🔍 DIAGNOSIS:');
    console.log('If images are not showing in the admin panel, the issue might be:');
    console.log('1. Frontend JavaScript not executing (check browser console)');
    console.log('2. Tenant not properly selected in the admin interface');
    console.log('3. Browser caching old JavaScript code');
    console.log('4. CORS issues preventing image loading');
    
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. Open browser dev tools and check Console tab for errors');
    console.log('2. Verify tenant "Fouzi Cafe" is selected in dropdown');
    console.log('3. Hard refresh the page (Cmd+Shift+R on Mac)');
    console.log('4. Check Network tab to see if image requests are being made');
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
  }
}

testFlow();