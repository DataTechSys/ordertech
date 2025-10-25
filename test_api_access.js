#!/usr/bin/env node

/**
 * Test API access through app.ordertech.me vs direct Cloud Run
 */

async function testApiAccess() {
  const bearerToken = process.argv[2];
  if (!bearerToken) {
    console.log('Usage: node test_api_access.js <your_bearer_token>');
    return;
  }

  const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  
  const endpoints = [
    {
      name: 'Load Balancer (app.ordertech.me)',
      base: 'https://app.ordertech.me'
    },
    {
      name: 'Direct Cloud Run',
      base: 'https://ordertech-715493130630.me-central1.run.app'
    }
  ];

  for (const endpoint of endpoints) {
    console.log(`\n🔗 Testing ${endpoint.name}`);
    console.log(`   ${endpoint.base}`);
    
    try {
      // Test 1: Health check
      console.log('   ⚡ Health check...');
      const healthResponse = await fetch(`${endpoint.base}/health`);
      console.log(`   📊 Health: ${healthResponse.status} ${healthResponse.statusText}`);
      
      // Test 2: Modifier options (requires auth)
      console.log('   🔐 Modifier options...');
      const optionsResponse = await fetch(`${endpoint.base}/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`   📊 Options: ${optionsResponse.status} ${optionsResponse.statusText}`);
      
      if (optionsResponse.ok) {
        const data = await optionsResponse.json();
        console.log(`   ✅ Found ${data.items?.length || 0} modifier options`);
        
        if (data.items && data.items.length > 0) {
          const sample = data.items[0];
          console.log(`   📋 Sample: ${sample.name} ($${sample.price})`);
          console.log(`   🏷️  Enhanced fields: localized=${!!sample.name_localized}, tax_group=${!!sample.tax_group_reference}, external_id=${!!sample.external_id}`);
        }
      } else {
        const errorText = await optionsResponse.text();
        console.log(`   ❌ Error: ${errorText.slice(0, 200)}...`);
      }
      
      // Test 3: Owner assignment (if 401/403, user needs access)
      console.log('   👑 Owner assignment test...');
      const ownerResponse = await fetch(`${endpoint.base}/admin/tenants/${KOOBS_TENANT_ID}/owner`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: 'hussain@mosawi.com' })
      });
      
      console.log(`   📊 Owner: ${ownerResponse.status} ${ownerResponse.statusText}`);
      
      if (ownerResponse.ok) {
        const ownerData = await ownerResponse.json();
        console.log(`   ✅ Owner assignment: ${JSON.stringify(ownerData)}`);
      } else {
        const ownerError = await ownerResponse.text();
        console.log(`   ⚠️  Owner error: ${ownerError.slice(0, 100)}...`);
      }

    } catch (error) {
      console.log(`   💥 Connection failed: ${error.message}`);
    }
  }
  
  console.log('\n🎯 Summary:');
  console.log('• If both endpoints show the same results, the load balancer is working correctly');
  console.log('• If modifier options return 401/403, user needs proper tenant access');
  console.log('• If owner assignment fails with 401, user needs platform admin rights');
  console.log('• If owner assignment fails with 500, there\'s a database/transaction issue');
}

testApiAccess().catch(console.error);