// test-koobs-foodics.js
// Run this in browser console to test Koobs Foodics integration

async function testKoobsFoodicsSalesImport() {
    const tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    console.log('🧪 Testing Koobs Foodics Sales Import...');
    console.log(`📋 Tenant ID: ${tenantId}`);
    console.log('');

    try {
        // Step 1: Verify integration is configured
        console.log('1️⃣ Checking Foodics integration status...');
        const integResponse = await fetch(`/admin/tenants/${tenantId}/integrations`);
        
        if (integResponse.ok) {
            const integData = await integResponse.json();
            const foodics = integData.items?.find(item => item.provider === 'foodics');
            
            if (foodics?.has_token) {
                console.log('   ✅ Foodics token is configured');
                console.log(`   📅 Last updated: ${foodics.updated_at || 'Unknown'}`);
            } else {
                console.log('   ❌ Foodics token not found');
                return;
            }
        } else {
            console.log(`   ❌ Failed to check integrations: ${integResponse.status}`);
            return;
        }

        console.log('');

        // Step 2: Test dry run with minimal parameters
        console.log('2️⃣ Testing dry run import...');
        const dryRunResponse = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/import-sales`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                from_date: '2024-10-20',  // Yesterday
                to_date: '2024-10-21',   // Today
                limit: 3,
                dry_run: true
            })
        });

        console.log(`   📊 Status: ${dryRunResponse.status} ${dryRunResponse.statusText}`);
        console.log(`   📋 Headers:`, Object.fromEntries(dryRunResponse.headers.entries()));

        const responseText = await dryRunResponse.text();
        console.log(`   📄 Raw Response: ${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}`);

        if (dryRunResponse.ok) {
            try {
                const dryRunData = JSON.parse(responseText);
                console.log('   ✅ Dry run successful!');
                console.log(`   📊 Orders found: ${dryRunData.stats?.fetched || 0}`);
                
                if (dryRunData.stats?.fetched > 0) {
                    console.log('   📝 Sample orders:');
                    (dryRunData.sample_orders || []).slice(0, 2).forEach((order, i) => {
                        console.log(`     ${i+1}. ID: ${order.id}, Total: ${order.total} ${order.currency || 'N/A'}`);
                    });
                    
                    // Step 3: Try real import with one order
                    console.log('');
                    console.log('3️⃣ Testing real import (1 order)...');
                    
                    const realImportResponse = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/import-sales`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({
                            from_date: '2024-10-20',
                            to_date: '2024-10-21',
                            limit: 1,
                            dry_run: false
                        })
                    });
                    
                    console.log(`   📊 Status: ${realImportResponse.status} ${realImportResponse.statusText}`);
                    const realResponseText = await realImportResponse.text();
                    console.log(`   📄 Response: ${realResponseText}`);
                    
                    if (realImportResponse.ok) {
                        const realData = JSON.parse(realResponseText);
                        console.log('   ✅ Real import successful!');
                        console.log(`   📈 Imported: ${realData.stats?.imported || 0}`);
                        console.log(`   ⏩ Skipped: ${realData.stats?.skipped || 0}`);
                        console.log(`   ⚠️  Errors: ${realData.stats?.errors || 0}`);
                    } else {
                        console.log('   ❌ Real import failed');
                        try {
                            const errorData = JSON.parse(realResponseText);
                            console.log('   🔍 Error details:', errorData);
                        } catch {
                            console.log('   🔍 Raw error:', realResponseText);
                        }
                    }
                } else {
                    console.log('   📭 No orders found in the date range');
                    console.log('   💡 Try extending the date range or check recent Foodics orders');
                }
            } catch (parseError) {
                console.log('   ❌ Failed to parse dry run response');
                console.log('   🔍 Parse error:', parseError.message);
            }
        } else {
            console.log('   ❌ Dry run failed');
            
            try {
                const errorData = JSON.parse(responseText);
                console.log('   🔍 Error details:', errorData);
                
                // Specific error handling
                if (errorData.error === 'foodics_token_missing') {
                    console.log('   💡 Solution: Add Foodics API token in tenant integrations');
                } else if (errorData.error === 'foodics_client_unavailable') {
                    console.log('   💡 Solution: Server-side issue - check Foodics client configuration');
                } else if (errorData.error === 'import_failed') {
                    console.log('   💡 Solution: Check server logs for detailed error');
                    console.log('   📋 Error message:', errorData.message);
                }
            } catch {
                console.log('   🔍 Raw error response:', responseText);
            }
        }

        console.log('');

        // Step 4: Check current sales data
        console.log('4️⃣ Checking current sales data...');
        const salesResponse = await fetch(`/admin/tenants/${tenantId}/sales-orders?limit=5`);
        
        if (salesResponse.ok) {
            const salesData = await salesResponse.json();
            console.log(`   📊 Current sales orders: ${salesData.items?.length || 0}`);
            
            if (salesData.items?.length > 0) {
                console.log('   📝 Recent orders:');
                salesData.items.forEach((order, i) => {
                    console.log(`     ${i+1}. ${order.external_id}: ${order.total} ${order.currency} (${order.status}) - ${order.customer_name || 'No customer'}`);
                });
            } else {
                console.log('   📭 No sales orders found in database');
            }
        } else {
            console.log(`   ⚠️ Sales data check failed: ${salesResponse.status}`);
        }

        console.log('');
        console.log('✅ Test completed!');

    } catch (error) {
        console.error('💥 Test failed:', error);
    }
}

// Auto-run the test
console.log('🎯 Koobs Foodics Sales Import Test');
console.log('=' * 50);
testKoobsFoodicsSalesImport();