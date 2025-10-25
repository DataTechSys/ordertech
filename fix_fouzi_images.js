#!/usr/bin/env node

// Fix Fouzi Cafe Image Loading Issues
// This script addresses the image loading problems by:
// 1. Testing the API endpoints to ensure data is accessible
// 2. Checking image URLs and proposing fixes
// 3. Providing recommendations for image migration

const http = require('http');
const https = require('https');

const baseURL = 'http://localhost:3000';
const fouziTenantId = '56ac557e-589d-4602-bc9b-946b201fb6f6';

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

async function analyzeImageIssues() {
  console.log('🔍 Analyzing Fouzi Cafe Image Issues');
  console.log('====================================\n');

  // Test 1: Check if API is returning products
  console.log('📡 Testing product API endpoint...');
  try {
    const result = await makeRequest(`/api/products?tenant=${fouziTenantId}`);
    if (result.status === 200 && Array.isArray(result.data)) {
      console.log(`✅ API working: Found ${result.data.length} products`);
      
      // Analyze image URLs
      let totalImages = 0;
      let foodicsImages = 0;
      let cloudStorageImages = 0;
      let missingImages = 0;
      
      const imageAnalysis = result.data.slice(0, 10).map(product => {
        const imageUrl = product.image_url;
        totalImages++;
        
        let imageType = 'missing';
        if (imageUrl) {
          if (imageUrl.includes('foodics') || imageUrl.includes('amazonaws')) {
            imageType = 'foodics';
            foodicsImages++;
          } else if (imageUrl.includes('storage.googleapis.com')) {
            imageType = 'cloud';
            cloudStorageImages++;
          } else {
            imageType = 'other';
          }
        } else {
          missingImages++;
        }
        
        return {
          id: product.id,
          name: product.name.substring(0, 30),
          imageType,
          imageUrl: imageUrl ? imageUrl.substring(0, 80) + (imageUrl.length > 80 ? '...' : '') : 'none'
        };
      });
      
      console.log('\n📊 Image Analysis Summary:');
      console.log(`Total products analyzed: ${totalImages}`);
      console.log(`Foodics images: ${foodicsImages} (${Math.round(foodicsImages/totalImages*100)}%)`);
      console.log(`Cloud storage images: ${cloudStorageImages} (${Math.round(cloudStorageImages/totalImages*100)}%)`);
      console.log(`Missing images: ${missingImages} (${Math.round(missingImages/totalImages*100)}%)`);
      
      console.log('\n🖼️  Sample Product Images:');
      console.log('ID'.padEnd(8) + ' | ' + 'Name'.padEnd(30) + ' | ' + 'Type'.padEnd(8) + ' | ' + 'URL');
      console.log('-'.repeat(120));
      imageAnalysis.forEach(item => {
        console.log(
          item.id.substring(0, 7).padEnd(8) + ' | ' +
          item.name.padEnd(30) + ' | ' +
          item.imageType.padEnd(8) + ' | ' +
          item.imageUrl
        );
      });
      
    } else {
      console.log(`❌ API issue: Status ${result.status}`);
      console.log('Response:', JSON.stringify(result.data).substring(0, 200));
    }
  } catch (error) {
    console.log(`❌ API request failed: ${error.message}`);
  }

  // Test 2: Check admin products endpoint (what the frontend uses)
  console.log('\n📡 Testing admin products endpoint...');
  try {
    const result = await makeRequest(`/admin/tenants/${fouziTenantId}/products?status=all`);
    if (result.status === 200 && Array.isArray(result.data)) {
      console.log(`✅ Admin API working: Found ${result.data.length} products`);
    } else {
      console.log(`❌ Admin API issue: Status ${result.status}`);
      console.log('Response:', JSON.stringify(result.data).substring(0, 200));
    }
  } catch (error) {
    console.log(`❌ Admin API request failed: ${error.message}`);
  }

  // Test 3: Check image proxy endpoint
  console.log('\n🖼️  Testing image proxy...');
  const sampleFoodicsUrl = 'https://foodics-console-production.s3.eu-west-1.amazonaws.com/images/494675_1696161223_9a43d4b7-c82a-48ed-a91f-3c8efaef642e.png';
  try {
    const result = await makeRequest(`/img?u=${encodeURIComponent(sampleFoodicsUrl)}`);
    if (result.status === 200) {
      console.log('✅ Image proxy working');
    } else {
      console.log(`❌ Image proxy issue: Status ${result.status}`);
    }
  } catch (error) {
    console.log(`❌ Image proxy request failed: ${error.message}`);
  }

  // Test 4: Check environment configuration
  console.log('\n⚙️  Checking server configuration...');
  try {
    const result = await makeRequest('/config.json');
    if (result.status === 200 && result.data) {
      console.log('✅ Server config accessible');
      // Check if assets bucket is mentioned
      const configStr = JSON.stringify(result.data);
      if (configStr.includes('storage.googleapis.com') || configStr.includes('assets')) {
        console.log('✅ Cloud storage configuration detected');
      } else {
        console.log('⚠️  No cloud storage configuration in public config');
      }
    }
  } catch (error) {
    console.log(`❌ Config request failed: ${error.message}`);
  }

  // Recommendations
  console.log('\n💡 Recommendations');
  console.log('==================');
  console.log('1. **Root Cause**: Images are stored as external Foodics URLs');
  console.log('2. **Short-term Fix**: Image proxy is available at `/img?u=URL` endpoint');
  console.log('3. **Long-term Fix**: Migrate images to Google Cloud Storage');
  console.log('4. **Frontend Fix**: Ensure proper error handling for image loading');
  
  console.log('\n🔧 Quick Fixes:');
  console.log('1. Check if image proxy endpoint is working in browser:');
  console.log(`   http://localhost:3000/img?u=${encodeURIComponent(sampleFoodicsUrl)}`);
  console.log('2. Verify ASSETS_BUCKET environment variable is loaded on server');
  console.log('3. Test image migration for a single product first');
  
  console.log('\n📋 Next Steps:');
  console.log('1. Open browser dev tools and check for CORS/404 errors on images');
  console.log('2. Try accessing the admin panel and check network tab for failed requests');
  console.log('3. Consider running image sync with proper Foodics API token if available');
}

if (require.main === module) {
  analyzeImageIssues().catch(console.error);
}

module.exports = { analyzeImageIssues };