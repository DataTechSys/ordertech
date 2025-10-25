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

async function testSkuUpdate() {
  console.log('Testing SKU update fix...\n');

  // 1. Get first product from Fouzi Cafe
  console.log('1. Fetching products...');
  const productsResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products`);
  if (!productsResponse.success) {
    console.error('Failed to fetch products:', productsResponse.error);
    return;
  }

  const products = productsResponse.data || [];
  if (products.length === 0) {
    console.log('No products found');
    return;
  }

  const testProduct = products[0];
  console.log(`Found test product: ${testProduct.name} (ID: ${testProduct.id}, Current SKU: ${testProduct.sku})`);

  // 2. Try to get individual product details
  console.log('\n2. Fetching individual product details...');
  const productResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${testProduct.id}`);
  if (!productResponse.success) {
    console.error('Failed to fetch individual product:', productResponse.error);
    return;
  }

  console.log(`Individual product fetch successful: ${productResponse.data.name} (SKU: ${productResponse.data.sku})`);

  // 3. Try to update the SKU
  const oldSku = testProduct.sku;
  const newSku = `TEST-${Date.now().toString().slice(-6)}`; // Generate test SKU
  
  console.log(`\n3. Attempting to update SKU from "${oldSku}" to "${newSku}"...`);
  
  const updateResponse = await apiRequest('PUT', `/admin/tenants/${TENANT_ID}/products/${testProduct.id}`, {
    sku: newSku
  });

  if (!updateResponse.success) {
    console.error('Failed to update SKU:', updateResponse.error);
    return;
  }

  console.log('Update API call succeeded');

  // 4. Verify the SKU was actually updated
  console.log('\n4. Verifying SKU was updated...');
  const verifyResponse = await apiRequest('GET', `/admin/tenants/${TENANT_ID}/products/${testProduct.id}`);
  if (!verifyResponse.success) {
    console.error('Failed to verify update:', verifyResponse.error);
    return;
  }

  const updatedSku = verifyResponse.data.sku;
  console.log(`Current SKU after update: ${updatedSku}`);

  if (updatedSku === newSku) {
    console.log('✅ SUCCESS: SKU update is working correctly!');
  } else {
    console.log(`❌ FAILED: Expected SKU "${newSku}" but got "${updatedSku}"`);
  }

  // 5. Restore original SKU
  console.log(`\n5. Restoring original SKU "${oldSku}"...`);
  const restoreResponse = await apiRequest('PUT', `/admin/tenants/${TENANT_ID}/products/${testProduct.id}`, {
    sku: oldSku
  });

  if (restoreResponse.success) {
    console.log('Original SKU restored successfully');
  } else {
    console.log('Warning: Failed to restore original SKU:', restoreResponse.error);
  }
}

if (require.main === module) {
  testSkuUpdate().catch(console.error);
}

module.exports = { testSkuUpdate };