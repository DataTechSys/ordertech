// import_real_foodics_sales.js
// Run this script in the browser console while logged into OrderTech admin

async function importRealFoodicsSales(tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896') {
    console.log('🚀 Starting real Foodics sales import for tenant:', tenantId);
    
    try {
        // First, check current status
        console.log('📊 Checking current sales data...');
        const currentSales = await fetch(`/admin/tenants/${tenantId}/sales-orders?limit=5`);
        if (currentSales.ok) {
            const salesData = await currentSales.json();
            console.log(`Current sales orders: ${salesData.items?.length || 0}`);
            salesData.items?.forEach((order, i) => {
                console.log(`  ${i+1}. ${order.external_id}: ${order.total} ${order.currency} - ${order.status}`);
            });
        }
        
        // Try dry run first
        console.log('🧪 Running dry run to test Foodics connection...');
        const dryRunResponse = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/import-sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_date: '2024-10-13',  // Last 8 days
                to_date: new Date().toISOString().split('T')[0],
                limit: 10,
                dry_run: true
            })
        });
        
        if (!dryRunResponse.ok) {
            throw new Error(`Dry run failed: ${dryRunResponse.status} ${dryRunResponse.statusText}`);
        }
        
        const dryRunResult = await dryRunResponse.json();
        console.log('🔍 Dry run results:', dryRunResult);
        
        if (dryRunResult.stats?.fetched > 0) {
            console.log(`✅ Found ${dryRunResult.stats.fetched} orders in Foodics`);
            console.log('📝 Sample orders:', dryRunResult.sample_orders?.slice(0, 2));
            
            // Confirm real import
            const proceed = confirm(`Found ${dryRunResult.stats.fetched} orders in Foodics. Proceed with real import?`);
            if (!proceed) {
                console.log('❌ Import cancelled by user');
                return;
            }
            
            // Real import
            console.log('💾 Starting real import...');
            const importResponse = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/import-sales`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_date: '2024-10-13',
                    to_date: new Date().toISOString().split('T')[0],
                    limit: 50,  // Import up to 50 orders
                    dry_run: false
                })
            });
            
            if (!importResponse.ok) {
                throw new Error(`Import failed: ${importResponse.status} ${importResponse.statusText}`);
            }
            
            const importResult = await importResponse.json();
            console.log('✅ Import completed!', importResult);
            
            // Check final status
            console.log('📈 Checking updated sales data...');
            const finalSales = await fetch(`/admin/tenants/${tenantId}/sales-orders?limit=10`);
            if (finalSales.ok) {
                const finalData = await finalSales.json();
                console.log(`Final sales orders count: ${finalData.items?.length || 0}`);
                console.log('🎉 Recent orders:');
                finalData.items?.slice(0, 5).forEach((order, i) => {
                    console.log(`  ${i+1}. ${order.external_id}: ${order.total} ${order.currency} - ${order.customer_name || 'No customer'}`);
                });
            }
            
        } else {
            console.log('📭 No orders found in Foodics for the specified date range');
            console.log('💡 Try extending the date range or check Foodics integration settings');
        }
        
    } catch (error) {
        console.error('💥 Import failed:', error);
        
        if (error.message.includes('foodics_token_missing')) {
            console.log('🔑 Foodics token is missing. Please configure Foodics integration first.');
            console.log('📍 Go to tenant settings and add your Foodics API token.');
        } else if (error.message.includes('401')) {
            console.log('🔒 Authentication failed. Please refresh the page and try again.');
        } else if (error.message.includes('503')) {
            console.log('⚡ Service unavailable. The Foodics client may not be properly configured.');
        }
    }
}

async function quickCheck(tenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896') {
    console.log('🔍 Quick status check...');
    try {
        const [salesRes, localRes] = await Promise.all([
            fetch(`/admin/tenants/${tenantId}/sales-orders?limit=1`),
            fetch(`/admin/tenants/${tenantId}/orders?limit=1`)
        ]);
        
        const [salesData, localData] = await Promise.all([
            salesRes.ok ? salesRes.json() : { items: [] },
            localRes.ok ? localRes.json() : { items: [] }
        ]);
        
        console.log(`📊 Sales orders (Foodics): ${salesData.items?.length || 0}`);
        console.log(`🏪 Local orders: ${localData.items?.length || 0}`);
        
        if (salesData.items?.length === 0) {
            console.log('💡 No Foodics sales found. Run importRealFoodicsSales() to import them.');
        }
        
    } catch (error) {
        console.error('❌ Status check failed:', error);
    }
}

// Auto-run quick check
console.log('🎯 Foodics Sales Import Tool');
console.log('📋 Available functions:');
console.log('  • quickCheck() - Check current data status');
console.log('  • importRealFoodicsSales() - Import real Foodics sales data');
console.log('');

quickCheck();