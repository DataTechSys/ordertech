// test-foodics-import.js
// Manual test script to verify Foodics sales import functionality

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs tenant
const API_BASE = 'https://app.ordertech.me';

async function testFoodicsImport() {
    console.log('🧪 Testing Foodics sales import functionality...');
    console.log(`📋 Tenant ID: ${TENANT_ID}`);
    console.log(`🔗 API Base: ${API_BASE}`);
    console.log('');

    try {
        // Test 1: Check current sales data
        console.log('1️⃣ Checking current sales data...');
        const salesResponse = await fetch(`${API_BASE}/admin/tenants/${TENANT_ID}/sales-orders?limit=5`);
        
        if (salesResponse.ok) {
            const salesData = await salesResponse.json();
            console.log(`   📊 Current sales orders: ${salesData.items?.length || 0}`);
            if (salesData.items?.length > 0) {
                console.log('   📝 Recent orders:');
                salesData.items.slice(0, 3).forEach((order, i) => {
                    console.log(`     ${i+1}. ${order.external_id}: ${order.total} ${order.currency} (${order.status})`);
                });
            }
        } else {
            console.log(`   ❌ Failed to fetch sales data: ${salesResponse.status}`);
        }

        console.log('');

        // Test 2: Dry run import test
        console.log('2️⃣ Testing dry run import...');
        const dryRunResponse = await fetch(`${API_BASE}/admin/tenants/${TENANT_ID}/integrations/foodics/import-sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_date: '2024-10-13',
                to_date: new Date().toISOString().split('T')[0],
                limit: 5,
                dry_run: true
            })
        });

        if (dryRunResponse.ok) {
            const dryRunData = await dryRunResponse.json();
            console.log(`   ✅ Dry run successful: Found ${dryRunData.stats?.fetched || 0} orders`);
            if (dryRunData.sample_orders?.length > 0) {
                console.log('   📝 Sample orders found:');
                dryRunData.sample_orders.slice(0, 2).forEach((order, i) => {
                    console.log(`     ${i+1}. ${order.id}: ${order.total} ${order.currency}`);
                });
            }
        } else {
            const errorData = await dryRunResponse.text();
            console.log(`   ❌ Dry run failed: ${dryRunResponse.status} - ${errorData}`);
        }

        console.log('');

        // Test 3: Check automated import endpoint (admin only)
        console.log('3️⃣ Testing automated import endpoint (requires admin token)...');
        const autoImportResponse = await fetch(`${API_BASE}/admin/integrations/foodics/auto-import-sales`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-token': 'test-admin-token'  // Default development token
            },
            body: JSON.stringify({})
        });

        if (autoImportResponse.ok) {
            const autoImportData = await autoImportResponse.json();
            console.log(`   ✅ Auto import test successful`);
            console.log(`   📊 Tenants processed: ${autoImportData.tenantsProcessed || 0}`);
            console.log(`   📈 Total imported: ${autoImportData.totalImported || 0}`);
            console.log(`   ⚠️  Total errors: ${autoImportData.totalErrors || 0}`);
        } else {
            const errorData = await autoImportResponse.text();
            console.log(`   ❌ Auto import failed: ${autoImportResponse.status} - ${errorData}`);
        }

        console.log('');
        console.log('✅ Test completed!');
        console.log('');
        console.log('💡 Next steps:');
        console.log('   • The Cloud Scheduler job will run every 5 minutes automatically');
        console.log('   • Check sales data in the unified orders page');
        console.log('   • Monitor logs for import activity');
        console.log('   • Use the "Import Sales" button in tenant admin for manual imports');

    } catch (error) {
        console.error('💥 Test failed:', error.message);
    }
}

// Run the test
console.log('🎯 Foodics Sales Import Test');
console.log('=' * 50);
testFoodicsImport();