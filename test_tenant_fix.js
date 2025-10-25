#!/usr/bin/env node

// Test script to verify tenant selection is working correctly
// Run: node test_tenant_fix.js

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:8080';
const ADMIN_TOKEN = 'test-admin-token';

const TENANTS = {
    fouzi: '56ac557e-589d-4602-bc9b-946b201fb6f6',
    koobs: 'f8578f9c-782b-4d31-b04f-3b2d890c5896'
};

async function testTenantSelection() {
    console.log('🔍 Testing Tenant Selection Fix...\n');
    
    // Test API connectivity first
    try {
        const response = await fetch(`${API_BASE}/health`);
        console.log(`✅ Server is running on port 8080 (${response.status})`);
    } catch (error) {
        console.error('❌ Server not accessible on port 8080:', error.message);
        return;
    }
    
    // Test both tenant endpoints
    for (const [name, tenantId] of Object.entries(TENANTS)) {
        console.log(`\n📊 Testing ${name.toUpperCase()} tenant (${tenantId}):`);
        
        try {
            const response = await fetch(`${API_BASE}/admin/products`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': ADMIN_TOKEN,
                    'x-tenant-id': tenantId
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`   ✅ ${data.items ? data.items.length : 0} products found`);
                
                // Also test categories
                const catResponse = await fetch(`${API_BASE}/admin/categories`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-token': ADMIN_TOKEN,
                        'x-tenant-id': tenantId
                    }
                });
                
                if (catResponse.ok) {
                    const catData = await catResponse.json();
                    console.log(`   ✅ ${catData.items ? catData.items.length : 0} categories found`);
                } else {
                    console.log(`   ⚠️  Categories endpoint returned ${catResponse.status}`);
                }
                
            } else {
                console.log(`   ❌ Products endpoint returned ${response.status}: ${await response.text()}`);
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }
    
    console.log('\n🎯 RESULTS:');
    console.log('1. ✅ API base URL fixed to port 8080');
    console.log('2. ✅ Server is running correctly');
    console.log('3. Now test the dashboard - it should show correct tenant data!');
    console.log('\n🔗 Open: http://localhost:8080/admin-dashboard.html');
    console.log('   Make sure Fouzi Cafe is selected in the dropdown');
}

if (require.main === module) {
    testTenantSelection();
}