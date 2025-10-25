const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'c7c83e14-6fca-432b-a02b-b4f2c8b5e3a0'; // Fouzi Cafe

// Helper to make authenticated API requests
async function apiRequest(method, endpoint, data = null) {
  const config = {
    method,
    url: `${BASE_URL}${endpoint}`,
    headers: {
      'Authorization': 'Bearer test-admin-token',
      'Content-Type': 'application/json'
    }
  };
  
  if (data) config.data = data;
  
  try {
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message, 
      status: error.response?.status 
    };
  }
}

async function testSkuFix() {
  console.log('Testing SKU update fix (simplified)...\n');

  // Step 1: Create a test product directly using the working tenant-based admin endpoint
  console.log('1. Creating test product with known category...');
  
  // Use a fixed category ID - let's use the default one or create the product with inline category creation
  const testProduct = {
    name: 'SKU Test Product',
    price: 15.99,
    active: true,
    // We'll create this with existing category or handle the error gracefully
    category_id: 'test-category-id'
  };

  // First, let's try to create the product and see what happens
  const createResponse = await apiRequest('POST', `/admin/tenants/${TENANT_ID}/products`, testProduct);
  
  if (!createResponse.success) {
    console.log('Failed to create product directly, trying to create a category first...');
    
    // Use in-memory mode approach - just create product with minimal data
    const minimalProduct = {
      name: 'SKU Test Product',
      price: 15.99,
      active: true
    };
    
    console.log('Attempting to create product without category_id...');
    const createResponse2 = await apiRequest('POST', `/admin/tenants/${TENANT_ID}/products`, minimalProduct);
    
    if (!createResponse2.success) {
      console.error('Failed to create test product:', createResponse2.error);
      console.log('\nLet\'s check if there are existing products we can test with...');
      
      // Try to get existing products
      const listResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products`);
      if (listResponse.success && listResponse.data.length > 0) {
        const existingProduct = listResponse.data[0];
        console.log(`Found existing product: ${existingProduct.name} (${existingProduct.id})`);
        await testSkuUpdateOnProduct(existingProduct);
        return;
      } else {
        console.log('No existing products found either. Cannot test SKU update.');
        return;
      }
    } else {
      console.log('Product created successfully!');
      await testSkuUpdateOnProduct(createResponse2.data.product);
      return;
    }
  } else {
    console.log('Product created successfully!');
    await testSkuUpdateOnProduct(createResponse.data.product);
    return;
  }
}

async function testSkuUpdateOnProduct(product) {
  console.log(`\n2. Testing SKU update on product: ${product.name} (ID: ${product.id})`);
  console.log(`   Original SKU: ${product.sku}`);

  // Test SKU update
  const newSku = `FIXED-${Date.now().toString().slice(-6)}`;
  console.log(`   Updating SKU to: ${newSku}`);

  const updateResponse = await apiRequest('PUT', `/admin/tenants/${TENANT_ID}/products/${product.id}`, {
    sku: newSku
  });

  if (!updateResponse.success) {
    console.error('❌ SKU update failed:', updateResponse.error);
    return;
  }

  console.log('   ✅ Update API call succeeded');

  // Verify the change was persisted
  console.log('\n3. Verifying SKU was persisted...');
  const verifyResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
  
  if (!verifyResponse.success) {
    console.error('❌ Failed to verify update:', verifyResponse.error);
    return;
  }

  const actualSku = verifyResponse.data.sku;
  console.log(`   Current SKU in database: ${actualSku}`);

  if (actualSku === newSku) {
    console.log('\n🎉 SUCCESS! SKU update fix is working correctly!');
    console.log('   The missing SKU update logic has been successfully added to the PUT endpoint.');
  } else {
    console.log('\n❌ FAILED! SKU was not updated properly.');
    console.log(`   Expected: ${newSku}, Got: ${actualSku}`);
  }

  // Test a few more updates
  console.log('\n4. Testing additional SKU updates...');
  for (let i = 1; i <= 2; i++) {
    const testSku = `VERIFY-${String(i).padStart(3, '0')}`;
    console.log(`   Testing update ${i} to: ${testSku}`);
    
    const updateResp = await apiRequest('PUT', `/admin/tenants/${TENANT_ID}/products/${product.id}`, {
      sku: testSku
    });
    
    if (updateResp.success) {
      const checkResp = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
      if (checkResp.success && checkResp.data.sku === testSku) {
        console.log(`   ✅ Update ${i} successful`);
      } else {
        console.log(`   ❌ Update ${i} failed - SKU not persisted`);
        break;
      }
    } else {
      console.log(`   ❌ Update ${i} API call failed:`, updateResp.error);
      break;
    }
  }

  // Clean up by deleting the test product if we created it
  if (product.name === 'SKU Test Product') {
    console.log('\n5. Cleaning up test product...');
    const deleteResponse = await apiRequest('DELETE', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
    if (deleteResponse.success) {
      console.log('   ✅ Test product cleaned up');
    } else {
      console.log('   ⚠️  Failed to clean up test product:', deleteResponse.error);
    }
  }
}

if (require.main === module) {
  testSkuFix().catch(console.error);
}