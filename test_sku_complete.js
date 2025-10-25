const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'c7c83e14-6fca-432b-a02b-b4f2c8b5e3a0'; // Fouzi Cafe

// Helper to make authenticated API requests
async function apiRequest(method, endpoint, data = null, additionalHeaders = {}) {
  const config = {
    method,
    url: `${BASE_URL}${endpoint}`,
    headers: {
      'Authorization': 'Bearer test-admin-token',
      'Content-Type': 'application/json',
      ...additionalHeaders
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

async function testComplete() {
  console.log('Testing complete SKU update workflow...\n');

  // 1. First check if we have any categories using the working admin endpoint
  console.log('1. Checking categories...');
  const categoriesResponse = await apiRequest('GET', '/admin/categories', null, {
    'X-Tenant-Id': TENANT_ID
  });
  if (!categoriesResponse.success) {
    console.error('Failed to fetch categories:', categoriesResponse.error);
    return;
  }

  let categories = categoriesResponse.data || [];
  let categoryId;

  if (categories.length === 0) {
    console.log('No categories found, creating one...');
    const createCategoryResponse = await apiRequest('POST', `/admin/tenants/${TENANT_ID}/categories`, {
      name: 'Test Category',
      active: true
    });

    if (!createCategoryResponse.success) {
      console.error('Failed to create category:', createCategoryResponse.error);
      return;
    }

    console.log('Created category:', createCategoryResponse.data);
    categoryId = createCategoryResponse.data.category?.id || createCategoryResponse.data.id;
  } else {
    categoryId = categories[0].id;
    console.log(`Using existing category: ${categories[0].name} (${categoryId})`);
  }

  // 2. Create a test product
  console.log('\n2. Creating test product...');
  const createProductResponse = await apiRequest('POST', `/admin/tenants/${TENANT_ID}/products`, {
    name: 'Test Product for SKU Update',
    category_id: categoryId,
    price: 10.50,
    active: true
  });

  if (!createProductResponse.success) {
    console.error('Failed to create product:', createProductResponse.error);
    return;
  }

  const product = createProductResponse.data.product;
  console.log(`Created product: ${product.name} (ID: ${product.id}, SKU: ${product.sku})`);

  // 3. Test individual product retrieval
  console.log('\n3. Testing individual product retrieval...');
  const getProductResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
  if (!getProductResponse.success) {
    console.error('Failed to get individual product:', getProductResponse.error);
    return;
  }

  console.log(`✅ Individual product retrieval works: ${getProductResponse.data.name} (SKU: ${getProductResponse.data.sku})`);

  // 4. Test SKU update
  const originalSku = product.sku;
  const newSku = `TEST-${Date.now().toString().slice(-6)}`;
  
  console.log(`\n4. Testing SKU update from "${originalSku}" to "${newSku}"...`);
  
  const updateResponse = await apiRequest('PUT', `/admin/tenants/${TENANT_ID}/products/${product.id}`, {
    sku: newSku
  });

  if (!updateResponse.success) {
    console.error('Failed to update SKU:', updateResponse.error);
    return;
  }

  console.log('✅ Update API call succeeded');

  // 5. Verify the SKU was actually updated in the database
  console.log('\n5. Verifying SKU was persisted in database...');
  const verifyResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
  if (!verifyResponse.success) {
    console.error('Failed to verify update:', verifyResponse.error);
    return;
  }

  const actualSku = verifyResponse.data.sku;
  console.log(`Current SKU in database: ${actualSku}`);

  if (actualSku === newSku) {
    console.log('✅ SUCCESS: SKU update is working correctly! The fix is successful.');
  } else {
    console.log(`❌ FAILED: Expected SKU "${newSku}" but got "${actualSku}"`);
    console.log('The fix did not work as expected.');
  }

  // 6. Test a few more updates to be sure
  console.log('\n6. Testing multiple rapid SKU updates...');
  
  for (let i = 1; i <= 3; i++) {
    const testSku = `MULTI-${i.toString().padStart(3, '0')}`;
    console.log(`  Testing update to ${testSku}...`);
    
    const updateResp = await apiRequest('PUT', `/admin/tenants/${TENANT_ID}/products/${product.id}`, {
      sku: testSku
    });
    
    if (!updateResp.success) {
      console.log(`  ❌ Update ${i} failed:`, updateResp.error);
      continue;
    }
    
    const verifyResp = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
    if (verifyResp.success && verifyResp.data.sku === testSku) {
      console.log(`  ✅ Update ${i} successful`);
    } else {
      console.log(`  ❌ Update ${i} not persisted: expected ${testSku}, got ${verifyResp.data?.sku}`);
    }
  }

  // 7. Cleanup - delete the test product
  console.log('\n7. Cleaning up test product...');
  const deleteResponse = await apiRequest('DELETE', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
  if (deleteResponse.success) {
    console.log('✅ Test product deleted successfully');
  } else {
    console.log('Warning: Failed to delete test product:', deleteResponse.error);
  }

  console.log('\n🎉 Test completed!');
}

if (require.main === module) {
  testComplete().catch(console.error);
}

module.exports = { testComplete };