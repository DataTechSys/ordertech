#!/usr/bin/env node
// Migrate Fouzi Cafe Images to Google Cloud Storage
// This script uses the existing image sync functionality

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
          statusText: res.statusMessage,
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

async function main() {
  console.log('🚀 Starting Fouzi Cafe Image Migration');
  console.log('📅 Started at:', new Date().toISOString());
  console.log('🎯 Target tenant:', FOUZI_TENANT_ID);
  
  try {
    // Step 1: Verify server and tenant
    console.log('\n📍 Step 1: Verifying server and tenant...');
    const tenantsResponse = await makeRequest(`${BASE_URL}/admin/tenants`);
    
    if (!tenantsResponse.ok) {
      console.error('❌ Failed to fetch tenants:', tenantsResponse.status);
      return;
    }
    
    const tenants = tenantsResponse.json || [];
    const fouziTenant = tenants.find(t => t.id === FOUZI_TENANT_ID);
    
    if (!fouziTenant) {
      console.error('❌ Fouzi Cafe tenant not found');
      return;
    }
    
    console.log('✅ Found tenant:', fouziTenant.name);
    
    // Step 2: Get current product count and image statistics
    console.log('\n📍 Step 2: Analyzing current products...');
    const productsResponse = await makeRequest(`${BASE_URL}/admin/products?tenant_id=${FOUZI_TENANT_ID}&limit=200`);
    
    if (!productsResponse.ok) {
      console.error('❌ Failed to fetch products:', productsResponse.status);
      return;
    }
    
    const products = (productsResponse.json?.items) || [];
    const foodicsProducts = products.filter(p => 
      p.image_url && (p.image_url.includes('foodics') || p.image_url.includes('amazonaws'))
    );
    const cloudProducts = products.filter(p => 
      p.image_url && p.image_url.includes('storage.googleapis.com')
    );
    
    console.log(`📊 Total products: ${products.length}`);
    console.log(`🔗 Products with Foodics images: ${foodicsProducts.length}`);
    console.log(`☁️  Products with cloud storage images: ${cloudProducts.length}`);
    console.log(`❌ Products without images: ${products.length - foodicsProducts.length - cloudProducts.length}`);
    
    if (foodicsProducts.length === 0) {
      console.log('✅ No Foodics images to migrate. Migration complete!');
      return;
    }
    
    // Step 3: Run Foodics sync with image copying
    console.log(`\n📍 Step 3: Migrating ${foodicsProducts.length} images...`);
    console.log('⚠️  This may take several minutes depending on image count and sizes.');
    
    // First sync categories
    console.log('\n🔄 Syncing categories...');
    const categoriesResponse = await makeRequest(
      `${BASE_URL}/admin/tenants/${FOUZI_TENANT_ID}/integrations/foodics/sync?phase=categories`,
      { method: 'POST' }
    );
    
    if (categoriesResponse.ok) {
      const catStats = categoriesResponse.json?.stats?.categories || {};
      console.log(`✅ Categories synced: +${catStats.created || 0}/~${catStats.updated || 0}`);
    } else {
      console.log('⚠️  Category sync failed, but continuing with products...');
    }
    
    // Then sync products with force_images=1 
    console.log('\n🔄 Syncing products with image migration...');
    const productsUrl = `${BASE_URL}/admin/tenants/${FOUZI_TENANT_ID}/integrations/foodics/sync?phase=products&force_images=1`;
    
    const syncResponse = await makeRequest(productsUrl, { method: 'POST' });
    
    if (!syncResponse.ok) {
      console.error('❌ Product sync failed:', syncResponse.status);
      console.error('Response:', syncResponse.data);
      return;
    }
    
    const syncStats = syncResponse.json?.stats?.products || {};
    console.log('✅ Product sync completed!');
    console.log(`📊 Products created: ${syncStats.created || 0}`);
    console.log(`📊 Products updated: ${syncStats.updated || 0}`);
    console.log(`📊 Images found: ${syncStats.image_found || 0}`);
    console.log(`📊 Images missing: ${syncStats.image_missing || 0}`);
    
    // Step 4: Verify migration results
    console.log('\n📍 Step 4: Verifying migration results...');
    
    // Wait a moment for the sync to complete fully
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const updatedProductsResponse = await makeRequest(`${BASE_URL}/admin/products?tenant_id=${FOUZI_TENANT_ID}&limit=200`);
    
    if (updatedProductsResponse.ok) {
      const updatedProducts = (updatedProductsResponse.json?.items) || [];
      const newFoodicsProducts = updatedProducts.filter(p => 
        p.image_url && (p.image_url.includes('foodics') || p.image_url.includes('amazonaws'))
      );
      const newCloudProducts = updatedProducts.filter(p => 
        p.image_url && p.image_url.includes('storage.googleapis.com')
      );
      
      console.log('\n📊 MIGRATION RESULTS:');
      console.log(`🔗 Remaining Foodics images: ${newFoodicsProducts.length} (was ${foodicsProducts.length})`);
      console.log(`☁️  Cloud storage images: ${newCloudProducts.length} (was ${cloudProducts.length})`);
      console.log(`✅ Successfully migrated: ${Math.max(0, cloudProducts.length - newCloudProducts.length)} images`);
      
      if (newFoodicsProducts.length === 0) {
        console.log('\n🎉 SUCCESS: All images have been migrated to Google Cloud Storage!');
      } else {
        console.log(`\n⚠️  ${newFoodicsProducts.length} images still using external URLs. This may be due to:`);
        console.log('   - Missing Foodics API credentials');
        console.log('   - Network issues during download');
        console.log('   - Invalid or inaccessible image URLs');
        
        // Show a few examples
        const examples = newFoodicsProducts.slice(0, 3);
        console.log('\n📋 Examples of remaining external images:');
        for (const product of examples) {
          console.log(`   • ${product.name}: ${product.image_url}`);
        }
      }
    }
    
    console.log('\n🏁 Migration process completed!');
    console.log('📝 Next steps:');
    console.log('   1. Verify images display correctly in the admin panel');
    console.log('   2. Check that new uploads go to cloud storage');
    console.log('   3. Monitor for any remaining external image references');
    
  } catch (error) {
    console.error('💥 Migration failed with error:', error.message);
    console.error(error);
  }
}

// Run the migration
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Migration script failed:', error);
    process.exit(1);
  });
}

module.exports = { main };