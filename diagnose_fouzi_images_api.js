#!/usr/bin/env node
// Fouzi Cafe Image Issue Diagnostic Script
// Uses only API endpoints to analyze image handling

const fetch = (() => {
  try {
    return require('node-fetch');
  } catch {
    // Fallback for environments without node-fetch
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');
    
    return (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const lib = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = lib.request({
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              headers: {
                get: (name) => res.headers[name.toLowerCase()]
              },
              json: () => Promise.resolve(JSON.parse(data)),
              text: () => Promise.resolve(data)
            });
          });
        });
        
        req.on('error', reject);
        
        if (options.body) {
          req.write(options.body);
        }
        
        req.end();
      });
    };
  }
})();
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const FOUZI_TENANT_ID = '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const testImageAccess = async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return {
      url,
      status: response.status,
      accessible: response.ok,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      cacheControl: response.headers.get('cache-control'),
      error: null
    };
  } catch (error) {
    return {
      url,
      status: null,
      accessible: false,
      contentType: null,
      contentLength: null,
      cacheControl: null,
      error: error.message
    };
  }
};

const logSection = (title) => {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
};

const logSubSection = (title) => {
  console.log('\n' + '-'.repeat(40));
  console.log(`  ${title}`);
  console.log('-'.repeat(40));
};

async function main() {
  console.log('🔍 Fouzi Cafe Image Diagnostic Report');
  console.log('📅 Generated:', new Date().toISOString());
  console.log('🔗 Using API proxy at:', BASE_URL);

  // 1. Verify server is accessible
  logSection('1. SERVER HEALTH CHECK');
  try {
    const healthResponse = await fetch(`${BASE_URL}/admin/tenants`);
    if (healthResponse.ok) {
      console.log('✅ Server is accessible');
      const tenants = await healthResponse.json();
      const fouziTenant = tenants.find(t => t.id === FOUZI_TENANT_ID);
      if (fouziTenant) {
        console.log('✅ Fouzi Cafe tenant found:', fouziTenant.name);
        console.log('   Tenant ID:', fouziTenant.id);
        console.log('   Domain:', fouziTenant.domain || 'Not set');
        console.log('   Slug:', fouziTenant.slug || 'Not set');
      } else {
        console.log('❌ Fouzi Cafe tenant not found');
        return;
      }
    } else {
      console.log('❌ Server not accessible:', healthResponse.status);
      return;
    }
  } catch (error) {
    console.log('❌ Server connection failed:', error.message);
    return;
  }

  // 2. Analyze products and image URLs
  logSection('2. PRODUCT IMAGE ANALYSIS');
  try {
    const productsResponse = await fetch(`${BASE_URL}/admin/products?tenant_id=${FOUZI_TENANT_ID}&limit=50`);
    
    if (!productsResponse.ok) {
      console.log('❌ Failed to fetch products:', productsResponse.status);
      return;
    }

    const productsData = await productsResponse.json();
    const products = productsData.items || [];
    
    console.log(`📊 Total products found: ${products.length}`);
    
    const imageStats = {
      total: products.length,
      withImages: 0,
      withoutImages: 0,
      foodicsImages: 0,
      cloudStorageImages: 0,
      otherImages: 0,
      brokenImages: 0
    };

    const sampleProducts = products.slice(0, 10);
    console.log(`\n📋 Analyzing sample of ${sampleProducts.length} products:`);

    for (const product of sampleProducts) {
      console.log(`\n📦 Product: ${product.name}`);
      console.log(`   ID: ${product.id}`);
      console.log(`   SKU: ${product.sku || 'N/A'}`);
      
      if (product.image_url) {
        imageStats.withImages++;
        console.log(`   Image URL: ${product.image_url}`);
        
        // Categorize image source
        if (product.image_url.includes('foodics') || product.image_url.includes('amazonaws')) {
          imageStats.foodicsImages++;
          console.log(`   📍 Type: External (Foodics/AWS)`);
          
          // Test direct access to Foodics image
          logSubSection('Testing Direct Foodics Access');
          const directTest = await testImageAccess(product.image_url);
          console.log(`   Direct access: ${directTest.accessible ? '✅' : '❌'} (${directTest.status})`);
          if (directTest.contentType) console.log(`   Content-Type: ${directTest.contentType}`);
          if (directTest.error) console.log(`   Error: ${directTest.error}`);
          
          // Test image proxy
          logSubSection('Testing Image Proxy');
          const proxyUrl = `${BASE_URL}/img?u=${encodeURIComponent(product.image_url)}`;
          const proxyTest = await testImageAccess(proxyUrl);
          console.log(`   Proxy access: ${proxyTest.accessible ? '✅' : '❌'} (${proxyTest.status})`);
          if (proxyTest.contentType) console.log(`   Proxy Content-Type: ${proxyTest.contentType}`);
          if (proxyTest.cacheControl) console.log(`   Proxy Cache-Control: ${proxyTest.cacheControl}`);
          if (proxyTest.error) console.log(`   Proxy Error: ${proxyTest.error}`);
          
        } else if (product.image_url.includes('storage.googleapis.com')) {
          imageStats.cloudStorageImages++;
          console.log(`   📍 Type: Cloud Storage (GCS)`);
          
          const cloudTest = await testImageAccess(product.image_url);
          console.log(`   Cloud access: ${cloudTest.accessible ? '✅' : '❌'} (${cloudTest.status})`);
          if (cloudTest.error) console.log(`   Error: ${cloudTest.error}`);
          
        } else {
          imageStats.otherImages++;
          console.log(`   📍 Type: Other`);
          
          const otherTest = await testImageAccess(product.image_url);
          console.log(`   Access: ${otherTest.accessible ? '✅' : '❌'} (${otherTest.status})`);
          if (otherTest.error) console.log(`   Error: ${otherTest.error}`);
        }
        
        // Small delay to avoid overwhelming the servers
        await sleep(100);
      } else {
        imageStats.withoutImages++;
        console.log(`   ❌ No image URL`);
      }
    }

    // 3. Image Statistics Summary
    logSection('3. IMAGE STATISTICS SUMMARY');
    console.log(`📊 Total products: ${imageStats.total}`);
    console.log(`✅ Products with images: ${imageStats.withImages}`);
    console.log(`❌ Products without images: ${imageStats.withoutImages}`);
    console.log(`🔗 External Foodics images: ${imageStats.foodicsImages}`);
    console.log(`☁️  Cloud storage images: ${imageStats.cloudStorageImages}`);
    console.log(`🔗 Other images: ${imageStats.otherImages}`);

  } catch (error) {
    console.log('❌ Error analyzing products:', error.message);
  }

  // 4. Environment Configuration Check
  logSection('4. ENVIRONMENT CONFIGURATION');
  
  // Check if cloud storage is configured by testing upload endpoint
  try {
    const uploadTest = await fetch(`${BASE_URL}/admin/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: FOUZI_TENANT_ID,
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        kind: 'product'
      })
    });
    
    if (uploadTest.ok) {
      const uploadData = await uploadTest.json();
      console.log('✅ Cloud storage upload endpoint working');
      console.log('📁 Upload URL pattern:', uploadData.publicUrl ? 'Present' : 'Missing');
      if (uploadData.publicUrl) {
        const bucketMatch = uploadData.publicUrl.match(/storage\.googleapis\.com\/([^\/]+)/);
        if (bucketMatch) {
          console.log('🪣 Storage bucket:', bucketMatch[1]);
        }
      }
    } else {
      console.log('❌ Cloud storage upload endpoint failed:', uploadTest.status);
    }
  } catch (error) {
    console.log('❌ Cloud storage test failed:', error.message);
  }

  // 5. Image Proxy Testing
  logSection('5. IMAGE PROXY FUNCTIONALITY');
  
  // Test the image proxy with a known good external image
  const testImageUrl = 'https://foodics-console-production.s3.eu-west-1.amazonaws.com/images/494675_1624994084_93cad784-50e2-4fe7-a97d-e61b7815efaa.jpg';
  const proxyTestUrl = `${BASE_URL}/img?u=${encodeURIComponent(testImageUrl)}`;
  
  console.log('🧪 Testing proxy with sample Foodics image...');
  console.log('Original URL:', testImageUrl);
  console.log('Proxy URL:', proxyTestUrl);
  
  const proxyResult = await testImageAccess(proxyTestUrl);
  console.log(`Proxy result: ${proxyResult.accessible ? '✅' : '❌'} (${proxyResult.status})`);
  if (proxyResult.contentType) console.log(`Content-Type: ${proxyResult.contentType}`);
  if (proxyResult.cacheControl) console.log(`Cache-Control: ${proxyResult.cacheControl}`);
  if (proxyResult.error) console.log(`Error: ${proxyResult.error}`);

  // 6. Recommendations
  logSection('6. RECOMMENDATIONS');
  
  console.log('Based on the analysis above, here are the key findings:');
  console.log('');
  
  if (imageStats.foodicsImages > 0) {
    console.log('🔍 ISSUE IDENTIFIED: Products using external Foodics URLs');
    console.log('   - These images are served from external AWS S3 bucket');
    console.log('   - Should be migrated to your Google Cloud Storage bucket');
    console.log('   - Image proxy is working as a temporary fallback');
    console.log('');
    console.log('📋 IMMEDIATE ACTIONS NEEDED:');
    console.log('   1. Run Foodics sync with "force_images=1" parameter');
    console.log('   2. Ensure Foodics API token is configured for tenant');
    console.log('   3. Verify cloud storage permissions and bucket access');
    console.log('');
    console.log('🚀 NEXT STEPS:');
    console.log('   1. Check Foodics integration status');
    console.log('   2. Configure missing API credentials');
    console.log('   3. Run image migration sync');
    console.log('   4. Verify migrated images in cloud storage');
  }
  
  if (imageStats.cloudStorageImages > 0) {
    console.log('✅ GOOD: Some images are already using cloud storage');
  }
  
  if (imageStats.withoutImages > 0) {
    console.log('⚠️  WARNING: Some products have no images at all');
  }

  logSection('7. COMPLETION');
  console.log('🏁 Diagnostic complete');
  console.log('📄 Results have been logged above');
  console.log('💡 Use the recommendations section to resolve image issues');
}

// Run the diagnostic
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Diagnostic failed:', error);
    process.exit(1);
  });
}

module.exports = { main };