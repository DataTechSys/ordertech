#!/usr/bin/env node

/**
 * Test script to verify menu cache API endpoint on Cloud Run with Koobs tenant
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const CLOUD_URL = 'https://ordertech-715493130630.me-central1.run.app';
const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs tenant ID

async function testCloudMenuCacheAPI() {
    console.log('🧪 Testing Cloud Menu Cache API Integration...\n');
    console.log(`🌍 Cloud URL: ${CLOUD_URL}`);
    console.log(`🏢 Testing with Koobs tenant: ${KOOBS_TENANT_ID}\n`);
    
    try {
        // Step 1: Health check
        console.log('1️⃣ Health check...');
        const healthResponse = await fetch(`${CLOUD_URL}/health`);
        if (!healthResponse.ok) {
            throw new Error(`Health check failed: ${healthResponse.status}`);
        }
        console.log('   ✅ Service is healthy');
        
        // Step 2: Get AI token for Koobs
        console.log('\n2️⃣ Getting AI token for Koobs...');
        const deviceId = 'cloud-test-' + Math.random().toString(36).substr(2, 9);
        
        const tokenResponse = await fetch(`${CLOUD_URL}/ai/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Tenant-Id': KOOBS_TENANT_ID
            },
            body: JSON.stringify({
                device_id: deviceId,
                branch_name: 'Koobs Main Branch'
            })
        });
        
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            throw new Error(`Token request failed: ${tokenResponse.status} - ${errorText}`);
        }
        
        const tokenData = await tokenResponse.json();
        console.log(`   ✅ Token acquired for Koobs: ${tokenData.token.substring(0, 20)}...`);
        
        // Step 3: Test menu data endpoint for Koobs
        console.log('\n3️⃣ Testing menu data endpoint for Koobs...');
        const menuResponse = await fetch(`${CLOUD_URL}/ai/menu-data`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenData.token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!menuResponse.ok) {
            const errorText = await menuResponse.text();
            throw new Error(`Menu data request failed: ${menuResponse.status} - ${errorText}`);
        }
        
        const menuData = await menuResponse.json();
        
        if (menuData.success) {
            const stats = menuData.metadata;
            console.log(`   ✅ Koobs menu data loaded successfully:`);
            console.log(`      🏢 Tenant: Koobs (${KOOBS_TENANT_ID})`);
            console.log(`      📊 Categories: ${stats.categories_count}`);
            console.log(`      🍽️  Products: ${stats.products_count}`);
            console.log(`      🔧 Modifiers: ${stats.modifiers_count}`);
            console.log(`      ⏱️  Load time: ${stats.load_time_ms}ms`);
            
            // Step 4: Show sample Koobs menu data
            console.log('\n4️⃣ Sample Koobs menu data:');
            if (menuData.data.categories && menuData.data.categories.length > 0) {
                console.log(`   📁 Categories:`);
                menuData.data.categories.slice(0, 3).forEach((cat, index) => {
                    console.log(`      ${index + 1}. ${cat.name} - ${cat.description || 'No description'}`);
                });
                if (menuData.data.categories.length > 3) {
                    console.log(`      ... and ${menuData.data.categories.length - 3} more categories`);
                }
            }
            
            if (menuData.data.products && menuData.data.products.length > 0) {
                console.log(`   🍽️  Sample products:`);
                menuData.data.products.slice(0, 3).forEach((prod, index) => {
                    console.log(`      ${index + 1}. ${prod.name} - ${prod.price} ${prod.currency} (${prod.category})`);
                });
                if (menuData.data.products.length > 3) {
                    console.log(`      ... and ${menuData.data.products.length - 3} more products`);
                }
            }
            
            console.log('\n✅ Cloud Menu Cache API Test for Koobs PASSED!');
            console.log('\n📋 Next Steps:');
            console.log('1. Open the Cloud AI Chat page in your browser:');
            console.log(`   ${CLOUD_URL}/Ai-Chat.html`);
            console.log('2. Watch for "Menu data loaded" message with Koobs data');
            console.log('3. Test tenant-specific menu questions');
            console.log('4. Verify AI Assistant uses OpenAI API with cached Koobs menu');
            console.log('\n🔗 Cloud Service URL:');
            console.log(`   ${CLOUD_URL}`);
            
        } else {
            console.log('   ❌ Menu data API returned error:', menuData.error || 'Unknown error');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('- Check that the Cloud Run service is deployed and healthy');
        console.log('- Verify the database connection is working in the cloud');
        console.log('- Confirm the OpenAI secrets are properly set in Secret Manager');
        console.log('- Check Cloud Run logs for any deployment issues');
        console.log('\n📊 Cloud Run Logs:');
        console.log('gcloud logs read --service=ordertech --region=me-central1');
    }
}

// Run the test
testCloudMenuCacheAPI();