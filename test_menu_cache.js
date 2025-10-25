#!/usr/bin/env node

/**
 * Test script to verify menu cache API endpoint
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testMenuCacheAPI() {
    console.log('🧪 Testing Menu Cache API Integration...\n');
    
    try {
        // Step 1: Get AI token
        console.log('1️⃣ Getting AI token...');
        const deviceId = 'test-client-' + Math.random().toString(36).substr(2, 9);
        
        const tokenResponse = await fetch('http://localhost:3000/ai/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Tenant-Id': 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
            },
            body: JSON.stringify({
                device_id: deviceId,
                branch_name: 'Koobs Main'
            })
        });
        
        if (!tokenResponse.ok) {
            throw new Error(`Token request failed: ${tokenResponse.status}`);
        }
        
        const tokenData = await tokenResponse.json();
        console.log(`   ✅ Token acquired: ${tokenData.token.substring(0, 20)}...`);
        
        // Step 2: Test menu data endpoint
        console.log('\n2️⃣ Testing menu data endpoint...');
        const menuResponse = await fetch('http://localhost:3000/ai/menu-data', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenData.token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!menuResponse.ok) {
            throw new Error(`Menu data request failed: ${menuResponse.status}`);
        }
        
        const menuData = await menuResponse.json();
        
        if (menuData.success) {
            const stats = menuData.metadata;
            console.log(`   ✅ Menu data loaded successfully:`);
            console.log(`      📊 Categories: ${stats.categories_count}`);
            console.log(`      🍽️  Products: ${stats.products_count}`);
            console.log(`      🔧 Modifiers: ${stats.modifiers_count}`);
            console.log(`      ⏱️  Load time: ${stats.load_time_ms}ms`);
            
            // Step 3: Show sample data
            console.log('\n3️⃣ Sample menu data:');
            if (menuData.data.categories.length > 0) {
                console.log(`   📁 First category: ${menuData.data.categories[0].name}`);
            }
            if (menuData.data.products.length > 0) {
                const firstProduct = menuData.data.products[0];
                console.log(`   🍽️  First product: ${firstProduct.name} - ${firstProduct.price} ${firstProduct.currency}`);
            }
            
            console.log('\n✅ Menu Cache API Test PASSED!');
            console.log('\n📋 Next Steps:');
            console.log('1. Open http://localhost:3000/Ai-Chat.html in your browser');
            console.log('2. Watch for "Menu data loaded" message');
            console.log('3. Test menu questions like "What categories do you have?"');
            console.log('4. Verify instant responses for menu queries');
            
        } else {
            console.log('   ❌ Menu data API returned error');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('- Make sure the server is running (npm start)');
        console.log('- Check that the database connection is working');
        console.log('- Verify tenant ID is correct');
    }
}

// Run the test
testMenuCacheAPI();