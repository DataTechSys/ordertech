// import_foodics_sales_console.js
// Run this in your browser's Developer Console while logged into OrderTech admin

// Step 1: Test if sales import endpoint exists
async function testSalesImportEndpoint() {
    const tenantId = '494675';
    
    console.log('🧪 Testing Foodics sales import endpoints...');
    
    // Test different possible endpoints
    const endpoints = [
        `/admin/tenants/${tenantId}/integrations/foodics/sync-sales`,
        `/admin/tenants/${tenantId}/integrations/foodics/import-sales`,
        `/admin/tenants/${tenantId}/sales/import`,
        `/admin/tenants/${tenantId}/sync/sales`
    ];
    
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dry_run: true, from: '2024-10-13', limit: 5 })
            });
            
            if (response.status !== 404) {
                console.log(`✅ Found endpoint: ${endpoint} (Status: ${response.status})`);
                const data = await response.text();
                console.log('Response:', data.substring(0, 200));
            }
        } catch (error) {
            console.log(`❌ ${endpoint}: ${error.message}`);
        }
    }
}

// Step 2: Try to import sales using backfill script via API if available
async function importFoodicsSales() {
    const tenantId = '494675';
    const fromDate = '2024-10-13'; // Last 7 days
    
    console.log('🚀 Attempting to import Foodics sales data...');
    
    try {
        // Try the main sync endpoint first to ensure products are imported
        console.log('📦 Syncing products first...');
        const productSync = await fetch(`/admin/tenants/${tenantId}/integrations/foodics/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force_images: true })
        });
        
        const productResult = await productSync.json();
        console.log('Product sync result:', productResult);
        
        // Now check if there's a sales-specific endpoint
        console.log('💰 Checking for sales import...');
        
        // Check what sales data is already available
        const salesCheck = await fetch(`/admin/tenants/${tenantId}/sales-orders?limit=5`);
        
        if (salesCheck.ok) {
            const salesData = await salesCheck.json();
            console.log('📊 Current sales data:', salesData);
            
            if (salesData.items && salesData.items.length > 0) {
                console.log('✅ Sales data found! Orders already imported.');
                return salesData;
            } else {
                console.log('📭 No sales data found. Need to import from Foodics.');
            }
        }
        
        // If no sales data exists, we might need to trigger a background job
        console.log('🔄 Trying to trigger sales import job...');
        
        // Try job-based import
        const jobResponse = await fetch(`/admin/tenants/${tenantId}/jobs/import-foodics-sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                from_date: fromDate,
                to_date: new Date().toISOString().split('T')[0],
                dry_run: false
            })
        });
        
        if (jobResponse.ok) {
            const jobResult = await jobResponse.json();
            console.log('✅ Sales import job triggered:', jobResult);
            return jobResult;
        } else {
            console.log('❌ No sales import job endpoint available');
        }
        
    } catch (error) {
        console.error('💥 Import failed:', error);
    }
}

// Step 3: Manual sales data check
async function checkCurrentSalesData() {
    const tenantId = '494675';
    
    console.log('🔍 Checking current sales data...');
    
    try {
        const response = await fetch(`/admin/tenants/${tenantId}/sales-orders?limit=10`);
        
        if (response.ok) {
            const data = await response.json();
            console.log('📊 Sales orders response:', data);
            
            if (data.items && data.items.length > 0) {
                console.log(`✅ Found ${data.items.length} sales orders`);
                data.items.forEach((order, i) => {
                    console.log(`${i+1}. Order ${order.external_id || order.id}: ${order.total} ${order.currency} - ${order.status}`);
                });
            } else {
                console.log('📭 No sales orders found');
            }
        } else {
            console.log(`❌ Sales orders endpoint error: ${response.status}`);
        }
        
        // Also check local orders
        const localResponse = await fetch(`/admin/tenants/${tenantId}/orders?limit=10`);
        if (localResponse.ok) {
            const localData = await localResponse.json();
            console.log('🏪 Local orders response:', localData);
            
            if (localData.items && localData.items.length > 0) {
                console.log(`✅ Found ${localData.items.length} local orders`);
            } else {
                console.log('📭 No local orders found');
            }
        }
        
    } catch (error) {
        console.error('💥 Check failed:', error);
    }
}

// Run the functions
console.log('🎯 Foodics Sales Import Script');
console.log('Usage:');
console.log('  testSalesImportEndpoint() - Test available endpoints');
console.log('  importFoodicsSales() - Try to import sales data');
console.log('  checkCurrentSalesData() - Check existing data');
console.log('');
console.log('Quick start: Run checkCurrentSalesData() first');

// Auto-run data check
checkCurrentSalesData();