#!/usr/bin/env node
// Fix Fouzi Cafe Product Images - Update to use uploaded GCS images

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

const testImageUrl = async (url) => {
  try {
    const response = await makeRequest(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    return false;
  }
};

async function main() {
  console.log('🔧 Fixing Fouzi Cafe Product Image URLs');
  console.log('📅 Started at:', new Date().toISOString());
  console.log('🎯 Target tenant:', FOUZI_TENANT_ID);
  
  try {
    // Step 1: Get all products for Fouzi Cafe
    console.log('\n📍 Step 1: Fetching all Fouzi Cafe products...');
    const productsResponse = await makeRequest(`${BASE_URL}/admin/products?tenant_id=${FOUZI_TENANT_ID}&limit=200`);
    
    if (!productsResponse.ok) {
      console.error('❌ Failed to fetch products:', productsResponse.status);
      return;
    }
    
    const products = productsResponse.json?.items || [];
    console.log(`✅ Found ${products.length} products`);
    
    const foodicsProducts = products.filter(p => 
      p.image_url && (p.image_url.includes('foodics') || p.image_url.includes('amazonaws'))
    );
    
    console.log(`🔗 Products with Foodics URLs: ${foodicsProducts.length}`);
    
    if (foodicsProducts.length === 0) {
      console.log('✅ No products with Foodics URLs found. Images may already be fixed!');
      return;
    }
    
    // Step 2: For each product, try to find if there's an uploaded image in GCS
    console.log('\n📍 Step 2: Checking for uploaded images in Google Cloud Storage...');
    
    let fixed = 0;
    let notFound = 0;
    const fixes = [];
    
    for (let i = 0; i < foodicsProducts.length; i++) {
      const product = foodicsProducts[i];
      const productName = product.name;
      const productId = product.id;
      
      console.log(`\n🔍 [${i + 1}/${foodicsProducts.length}] Checking: ${productName}`);
      console.log(`   Current URL: ${product.image_url}`);
      
      // Try different possible uploaded image URLs
      const possibleUrls = [
        // Standard tenant/product path with product ID
        `https://storage.googleapis.com/smart-order-assets-me-central1-715493130630/tenants/${FOUZI_TENANT_ID}/products/${productId}.jpg`,
        `https://storage.googleapis.com/smart-order-assets-me-central1-715493130630/tenants/${FOUZI_TENANT_ID}/products/${productId}.png`,
        `https://storage.googleapis.com/smart-order-assets-me-central1-715493130630/tenants/${FOUZI_TENANT_ID}/products/${productId}.jpeg`,
        // With timestamp prefix (common pattern)
        `https://storage.googleapis.com/smart-order-assets-me-central1-715493130630/tenants/${FOUZI_TENANT_ID}/products/*-${productId}.jpg`,
        `https://storage.googleapis.com/smart-order-assets-me-central1-715493130630/tenants/${FOUZI_TENANT_ID}/products/*-${productId}.png`,
      ];
      
      let foundUrl = null;
      
      // Check each possible URL
      for (const testUrl of possibleUrls.slice(0, 3)) { // Only test direct URLs, not wildcard ones
        const accessible = await testImageUrl(testUrl);
        if (accessible) {
          foundUrl = testUrl;
          break;
        }
      }
      
      if (foundUrl) {
        console.log(`   ✅ Found uploaded image: ${foundUrl}`);
        fixes.push({ productId, productName, newUrl: foundUrl, oldUrl: product.image_url });
        fixed++;
      } else {
        console.log(`   ❌ No uploaded image found in GCS`);
        notFound++;
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Step 3: Apply fixes
    console.log(`\n📍 Step 3: Applying fixes...`);
    console.log(`✅ Found uploaded images: ${fixed}`);
    console.log(`❌ No uploaded images: ${notFound}`);
    
    if (fixes.length === 0) {
      console.log('\n⚠️  No uploaded images found in Google Cloud Storage.');
      console.log('This means either:');
      console.log('1. The images were never successfully uploaded');
      console.log('2. They are stored with different naming patterns');
      console.log('3. The Google Cloud Storage bucket is empty for this tenant');
      
      console.log('\n💡 RECOMMENDATIONS:');
      console.log('1. Try uploading a test image through the product edit page');
      console.log('2. Check the Google Cloud Console to see what files are actually in the bucket');
      console.log('3. Verify the upload process is working end-to-end');
      return;
    }
    
    let updateSuccess = 0;
    let updateFailed = 0;
    
    for (const fix of fixes) {
      console.log(`\n🔄 Updating ${fix.productName}...`);
      
      try {
        const updateResponse = await makeRequest(
          `${BASE_URL}/admin/tenants/${FOUZI_TENANT_ID}/products/${fix.productId}`,
          {
            method: 'PUT',
            body: JSON.stringify({ image_url: fix.newUrl })
          }
        );
        
        if (updateResponse.ok) {
          console.log(`   ✅ Updated successfully`);
          updateSuccess++;
        } else {
          console.log(`   ❌ Update failed: ${updateResponse.status}`);
          updateFailed++;
        }
      } catch (error) {
        console.log(`   ❌ Update error: ${error.message}`);
        updateFailed++;
      }
    }
    
    // Step 4: Summary
    console.log('\n📊 FINAL RESULTS:');
    console.log(`✅ Successfully updated: ${updateSuccess} products`);
    console.log(`❌ Failed to update: ${updateFailed} products`);
    
    if (updateSuccess > 0) {
      console.log('\n🎉 SUCCESS! Product images have been updated to use uploaded versions.');
      console.log('💡 Next steps:');
      console.log('1. Refresh the admin products page');
      console.log('2. Verify images are now showing correctly');
      console.log('3. If some images are still missing, upload them through the product edit page');
    }
    
  } catch (error) {
    console.error('💥 Script failed:', error.message);
  }
}

main();