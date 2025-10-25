const fetch = require('node-fetch');

async function setupFoodicsIntegration() {
  const CLOUD_RUN_URL = 'https://ordertech-715493130630.me-central1.run.app';
  const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  
  // Get the Foodics token from the local environment or secret
  const FOODICS_TOKEN = process.env.FOODICS_TOKEN;
  
  if (!FOODICS_TOKEN) {
    console.error('FOODICS_TOKEN environment variable is required');
    process.exit(1);
  }

  console.log('Setting up Foodics integration for tenant:', TENANT_ID);
  console.log('Using token:', FOODICS_TOKEN.substring(0, 20) + '...');

  try {
    const response = await fetch(`${CLOUD_RUN_URL}/admin/tenants/${TENANT_ID}/integrations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'test-admin-token', // This might need to be a real admin token
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        provider: 'foodics',
        token: FOODICS_TOKEN,
        status: 'active',
        meta: {
          configured_at: new Date().toISOString(),
          configured_by: 'setup_script'
        }
      })
    });

    const result = await response.text();
    
    if (response.ok) {
      console.log('✅ Successfully configured Foodics integration');
      console.log('Response:', result);
    } else {
      console.error('❌ Failed to configure Foodics integration');
      console.error('Status:', response.status);
      console.error('Response:', result);
    }
  } catch (error) {
    console.error('❌ Error setting up Foodics integration:', error.message);
  }
}

// Test the sync endpoint after setup
async function testSync() {
  const CLOUD_RUN_URL = 'https://ordertech-715493130630.me-central1.run.app';
  const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  
  console.log('\\nTesting sync endpoint...');
  
  try {
    const response = await fetch(`${CLOUD_RUN_URL}/admin/tenants/${TENANT_ID}/integrations/foodics/sync?phase=groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'test-admin-token',
        'Authorization': 'Bearer test-token'
      }
    });

    const result = await response.text();
    
    if (response.ok) {
      console.log('✅ Sync test successful');
      console.log('Response:', result);
    } else {
      console.error('❌ Sync test failed');
      console.error('Status:', response.status);
      console.error('Response:', result);
    }
  } catch (error) {
    console.error('❌ Sync test error:', error.message);
  }
}

// Run the setup
setupFoodicsIntegration().then(() => {
  // Wait a bit for the integration to be saved
  setTimeout(testSync, 2000);
});