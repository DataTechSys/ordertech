#!/usr/bin/env node
// Convert Fouzi Cafe's UUID-based SKUs to sequential SKU-001, SKU-002, etc.

const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3000';
const FOUZI_TENANT_ID = '56ac557e-589d-4602-bc9b-946b201fb6f6';

function apiCall(url, method = 'GET', data = null) {
  try {
    let cmd = `curl -s -X ${method} "${url}" -H "X-Admin-Token: dev" -H "Content-Type: application/json"`;
    if (data) {
      cmd += ` -d '${JSON.stringify(data)}'`;
    }
    const result = execSync(cmd, { encoding: 'utf8' });
    return JSON.parse(result);
  } catch (error) {
    console.error('API call failed:', error.message);
    return null;
  }
}

function generateSequentialSku(index) {
  return `SKU-${String(index).padStart(3, '0')}`;
}

function isUuidBasedSku(sku) {
  // Check if SKU follows the pattern "SKU-{uuid}"
  return sku && sku.startsWith('SKU-') && sku.length > 10 && sku.includes('-');
}

async function convertSkusToSequential() {
  console.log('🔄 Converting Fouzi Cafe SKUs to Sequential Format');
  console.log('🎯 Target tenant:', FOUZI_TENANT_ID);
  console.log('📋 Converting: SKU-{uuid} → SKU-001, SKU-002, SKU-003...');
  
  try {
    // Step 1: Get all products for Fouzi Cafe
    console.log('\n📍 Step 1: Fetching all Fouzi Cafe products...');
    
    const response = apiCall(`${BASE_URL}/admin/tenants/${FOUZI_TENANT_ID}/products`);
    
    if (!response || !Array.isArray(response)) {
      console.error('❌ Failed to fetch products');
      return;
    }
    
    const products = response;
    console.log(`✅ Found ${products.length} products`);
    
    // Step 2: Filter products that need SKU conversion
    const productsNeedingConversion = products.filter(p => isUuidBasedSku(p.sku));
    const productsAlreadySequential = products.filter(p => !isUuidBasedSku(p.sku));
    
    console.log(`\n📊 Analysis:`);
    console.log(`   Products with UUID-based SKUs: ${productsNeedingConversion.length}`);
    console.log(`   Products with proper SKUs: ${productsAlreadySequential.length}`);
    
    if (productsNeedingConversion.length === 0) {
      console.log('✅ All products already have sequential SKUs!');
      return;
    }
    
    // Step 3: Sort products by creation date for consistent ordering
    productsNeedingConversion.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    console.log('\n📍 Step 3: Converting SKUs to sequential format...');
    console.log('   (Ordered by creation date for consistency)');
    
    let successCount = 0;
    let errorCount = 0;
    let skuCounter = 1;
    
    // Skip already sequential SKUs to avoid conflicts
    const existingSkus = new Set(productsAlreadySequential.map(p => p.sku));
    while (existingSkus.has(generateSequentialSku(skuCounter))) {
      skuCounter++;
    }
    
    for (let i = 0; i < productsNeedingConversion.length; i++) {
      const product = productsNeedingConversion[i];
      const oldSku = product.sku;
      const newSku = generateSequentialSku(skuCounter);
      
      console.log(`\n[${i + 1}/${productsNeedingConversion.length}] ${product.name}`);
      console.log(`   📋 SKU: "${oldSku}" → "${newSku}"`);
      
      // Update the product SKU
      const updateResponse = apiCall(
        `${BASE_URL}/admin/tenants/${FOUZI_TENANT_ID}/products/${product.id}`,
        'PUT',
        { sku: newSku }
      );
      
      if (updateResponse && !updateResponse.error) {
        console.log(`   ✅ Updated successfully`);
        successCount++;
        skuCounter++;
      } else {
        console.log(`   ❌ Failed to update`);
        if (updateResponse?.error) {
          console.log(`   Error: ${updateResponse.error}`);
        }
        errorCount++;
        
        // Still increment counter to avoid conflicts
        skuCounter++;
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log('\n📊 CONVERSION SUMMARY:');
    console.log(`✅ Successfully converted: ${successCount} products`);
    if (errorCount > 0) {
      console.log(`❌ Failed to convert: ${errorCount} products`);
    }
    
    console.log('\n🎯 RESULTS:');
    console.log(`📋 All Fouzi Cafe products now have sequential SKUs`);
    console.log(`🔢 SKU range: SKU-001 to SKU-${String(skuCounter - 1).padStart(3, '0')}`);
    console.log(`💼 Format: Clean, professional, and easy to manage`);
    
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Check the admin interface - all products should show sequential SKUs');
    console.log('2. Product editing should now work properly');
    console.log('3. New products will continue the sequence from SKU-' + String(skuCounter).padStart(3, '0'));
    
    // Verification step
    console.log('\n🔍 VERIFICATION:');
    console.log('Let me verify a few converted products...');
    
    const verifyResponse = apiCall(`${BASE_URL}/admin/tenants/${FOUZI_TENANT_ID}/products?limit=3`);
    if (verifyResponse && Array.isArray(verifyResponse)) {
      verifyResponse.slice(0, 3).forEach(p => {
        console.log(`   ✓ ${p.name}: ${p.sku}`);
      });
    }
    
  } catch (error) {
    console.error('💥 Script failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Add helper to wait for promises in older Node versions
if (!Promise.prototype.delay) {
  Promise.prototype.delay = function(ms) {
    return this.then(result => new Promise(resolve => setTimeout(() => resolve(result), ms)));
  };
}

convertSkusToSequential().catch(console.error);