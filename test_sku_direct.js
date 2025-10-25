const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'c7c83e14-6fca-432b-a02b-b4f2c8b5e3a0'; // Fouzi Cafe

async function apiCall(method, endpoint, data = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Authorization': 'Bearer test-admin-token',
        'Content-Type': 'application/json'
      },
      data: data
    };
    
    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message,
      status: error.response?.status
    };
  }
}

async function setupAndTestSku() {
  console.log('Setting up test data and testing SKU update...\n');

  // Since we need products to exist, let's try to create them in-memory mode
  // by directly adding to the memory catalog if possible, or by testing with existing JSON catalog data

  // First, try to see if there are any existing products in the system
  console.log('1. Checking existing products in the system...');
  const publicProducts = await apiCall('GET', '/api/products');
  if (publicProducts.success && publicProducts.data.length > 0) {
    console.log(`Found ${publicProducts.data.length} products in public API`);
    
    // Get the first product's info
    const firstProduct = publicProducts.data[0];
    console.log(`First product: ${firstProduct.name} (ID: ${firstProduct.id}, SKU: ${firstProduct.sku})`);
    
    // Now try to access this product via the admin API to test SKU update
    console.log('\n2. Trying to access product via admin API...');
    const adminProduct = await apiCall('GET', `/admin/tenants/${TENANT_ID}/products/${firstProduct.id}`);
    
    if (adminProduct.success) {
      console.log(`✅ Admin API can access product: ${adminProduct.data.name}`);
      console.log(`   Current SKU: ${adminProduct.data.sku}`);
      
      // Test SKU update
      const newSku = `TEST-${Date.now().toString().slice(-6)}`;
      console.log(`\n3. Testing SKU update to: ${newSku}`);
      
      const updateResult = await apiCall('PUT', `/admin/tenants/${TENANT_ID}/products/${firstProduct.id}`, {
        sku: newSku
      });
      
      if (updateResult.success) {
        console.log('✅ SKU update API call succeeded');
        
        // Verify the change
        const verifyResult = await apiCall('GET', `/admin/tenants/${TENANT_ID}/products/${firstProduct.id}`);
        if (verifyResult.success) {
          const updatedSku = verifyResult.data.sku;
          console.log(`   Verified SKU: ${updatedSku}`);
          
          if (updatedSku === newSku) {
            console.log('\n🎉 SUCCESS! SKU update fix is working!');
            console.log('   The missing SKU update logic in the PUT endpoint has been fixed.');
            
            // Test one more time to be sure
            const newSku2 = `FINAL-${Date.now().toString().slice(-5)}`;
            console.log(`\n4. Final verification with SKU: ${newSku2}`);
            const finalUpdate = await apiCall('PUT', `/admin/tenants/${TENANT_ID}/products/${firstProduct.id}`, {
              sku: newSku2
            });
            
            if (finalUpdate.success) {
              const finalVerify = await apiCall('GET', `/admin/tenants/${TENANT_ID}/products/${firstProduct.id}`);
              if (finalVerify.success && finalVerify.data.sku === newSku2) {
                console.log('✅ Final verification successful!');
                console.log('\n✨ The SKU update fix is fully functional!');
                return;
              }
            }
          } else {
            console.log(`\n❌ FAILED: Expected SKU "${newSku}" but got "${updatedSku}"`);
          }
        } else {
          console.log('❌ Failed to verify SKU update:', verifyResult.error);
        }
      } else {
        console.log('❌ SKU update failed:', updateResult.error);
      }
    } else {
      console.log('❌ Cannot access product via admin API:', adminProduct.error);
    }
  } else {
    console.log('No products found in public API');
  }

  // If we get here, let's try to force create some data by putting it in memory
  console.log('\nTrying alternative approach: directly creating a product for testing...');
  
  // Try creating a basic category and product
  const categoryData = {
    name: 'Test Category for SKU',
    active: true
  };
  
  console.log('Creating test category...');
  const categoryResult = await apiCall('POST', `/admin/tenants/${TENANT_ID}/categories`, categoryData);
  
  if (categoryResult.success) {
    console.log('✅ Test category created');
    const categoryId = categoryResult.data.category?.id || categoryResult.data.id;
    
    const productData = {
      name: 'Test Product for SKU Update',
      category_id: categoryId,
      price: 10.00,
      active: true
    };
    
    console.log('Creating test product...');
    const productResult = await apiCall('POST', `/admin/tenants/${TENANT_ID}/products`, productData);
    
    if (productResult.success) {
      console.log('✅ Test product created');
      const product = productResult.data.product;
      console.log(`   Product: ${product.name} (ID: ${product.id}, SKU: ${product.sku})`);
      
      // Now test SKU update
      const testSku = `CREATE-${Date.now().toString().slice(-6)}`;
      console.log(`\nTesting SKU update to: ${testSku}`);
      
      const updateResult = await apiCall('PUT', `/admin/tenants/${TENANT_ID}/products/${product.id}`, {
        sku: testSku
      });
      
      if (updateResult.success) {
        console.log('✅ SKU update succeeded');
        
        const verifyResult = await apiCall('GET', `/admin/tenants/${TENANT_ID}/products/${product.id}`);
        if (verifyResult.success && verifyResult.data.sku === testSku) {
          console.log('🎉 SUCCESS! Created data and SKU update works!');
        } else {
          console.log('❌ SKU update did not persist');
        }
      } else {
        console.log('❌ SKU update failed:', updateResult.error);
      }
    } else {
      console.log('❌ Failed to create test product:', productResult.error);
    }
  } else {
    console.log('❌ Failed to create test category:', categoryResult.error);
  }
}

setupAndTestSku().catch(console.error);