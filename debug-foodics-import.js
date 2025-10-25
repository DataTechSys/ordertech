// debug-foodics-import.js
// Run this script in the browser console to debug Foodics import issues

async function debugFoodicsImport() {
    const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    console.log('🔍 Debugging Foodics Sales Import...');
    
    try {
        // Step 1: Check if we can access the endpoint at all
        console.log('1️⃣ Testing basic endpoint access...');
        const basicTest = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/import-sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_date: '2024-10-20',
                to_date: '2024-10-21',
                limit: 1,
                dry_run: true
            })
        });
        
        console.log(`   Response status: ${basicTest.status}`);
        console.log(`   Response headers:`, [...basicTest.headers.entries()]);
        
        const responseText = await basicTest.text();
        console.log(`   Response body:`, responseText);
        
        if (!basicTest.ok) {
            console.log('❌ Basic endpoint test failed');
            
            let errorData;
            try {
                errorData = JSON.parse(responseText);
            } catch {
                errorData = { raw: responseText };
            }
            
            if (basicTest.status === 409) {
                console.log('🔑 This looks like a missing Foodics token issue');
                console.log('💡 Please ensure Foodics integration is configured for this tenant');
            } else if (basicTest.status === 500) {
                console.log('💥 Internal server error - checking specific issue...');
                console.log('Error details:', errorData);
            }
            
            return;
        }
        
        console.log('✅ Basic endpoint access successful');
        
        // Step 2: Check current sales data
        console.log('2️⃣ Checking current sales data...');
        const salesResponse = await fetch(`/admin/tenants/${tenantId}/sales-orders?limit=3`);
        
        if (salesResponse.ok) {
            const salesData = await salesResponse.json();
            console.log(`   📊 Current sales orders: ${salesData.items?.length || 0}`);
            if (salesData.items?.length > 0) {
                console.log('   📝 Sample orders:');
                salesData.items.forEach((order, i) => {
                    console.log(`     ${i+1}. ${order.external_id}: ${order.total} ${order.currency}`);
                });
            }
        } else {
            console.log(`   ⚠️ Sales data endpoint issue: ${salesResponse.status}`);
        }
        
        // Step 3: Test with a very recent date range
        console.log('3️⃣ Testing with recent date range...');
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const today = new Date();
        
        const recentTest = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/import-sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_date: yesterday.toISOString().split('T')[0],
                to_date: today.toISOString().split('T')[0],
                limit: 5,
                dry_run: true
            })
        });
        
        if (recentTest.ok) {
            const recentData = await recentTest.json();
            console.log('   ✅ Recent test successful');
            console.log('   📊 Found orders:', recentData.stats);
            if (recentData.sample_orders?.length > 0) {
                console.log('   📋 Sample orders:');
                recentData.sample_orders.forEach((order, i) => {
                    console.log(`     ${i+1}. ID: ${order.id}, Total: ${order.total} ${order.currency}`);
                });
            } else {
                console.log('   📭 No recent orders found in Foodics');
            }
        } else {
            const errorText = await recentTest.text();
            console.log(`   ❌ Recent test failed: ${recentTest.status}`);
            console.log('   Error:', errorText);
        }
        
    } catch (error) {
        console.error('💥 Debug failed:', error);
    }
}

// Helper function to check integration status
async function checkIntegrationStatus() {
    const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    console.log('🔧 Checking Foodics integration status...');
    
    try {
        const response = await fetch(`/admin/tenants/${tenantId}/integrations`);
        if (response.ok) {
            const data = await response.json();
            const foodics = data.items?.find(item => item.provider === 'foodics');
            
            if (foodics) {
                console.log('✅ Foodics integration found:');
                console.log(`   Has token: ${foodics.has_token}`);
                console.log(`   Status: ${foodics.status || 'N/A'}`);
                console.log(`   Updated: ${foodics.updated_at || 'N/A'}`);
            } else {
                console.log('❌ No Foodics integration found');
                console.log('💡 Please configure Foodics integration first');
            }
        } else {
            console.log(`❌ Failed to check integrations: ${response.status}`);
        }
    } catch (error) {
        console.error('Error checking integration status:', error);
    }
}

console.log('🎯 Foodics Import Debug Tool');
console.log('Available functions:');
console.log('  • debugFoodicsImport() - Full debug test');
console.log('  • checkIntegrationStatus() - Check if Foodics is configured');
console.log('');

// Auto-run integration check
checkIntegrationStatus();