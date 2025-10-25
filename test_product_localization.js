#!/usr/bin/env node

// Script to test and inspect Foodics product localization fields

const fs = require('fs');
const path = require('path');
const { makeClient } = require('./server/integrations/foodics.js');

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, 'ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
    FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

if (!FOODICS_TOKEN) {
    console.error('❌ Foodics token not found');
    process.exit(1);
}

async function testProductLocalization() {
    try {
        console.log('🧪 Testing Foodics product localization...\n');
        
        const client = makeClient(FOODICS_TOKEN);
        
        // Fetch first few products to inspect
        console.log('📡 Fetching products from Foodics API...');
        const result = await client.listProducts();
        
        if (!result || !result.items || result.items.length === 0) {
            console.log('❌ No products found');
            return;
        }
        
        console.log(`✅ Found ${result.items.length} products\n`);
        
        // Inspect first few products for localization fields
        const samplesToInspect = Math.min(5, result.items.length);
        console.log(`🔍 Inspecting first ${samplesToInspect} products for localization fields:\n`);
        
        for (let i = 0; i < samplesToInspect; i++) {
            const product = result.items[i];
            console.log(`📦 Product ${i + 1}:`);
            console.log(`   ID: ${product.id}`);
            console.log(`   name: ${product.name || 'N/A'}`);
            console.log(`   name_localized: ${product.name_localized || 'N/A'}`);
            console.log(`   name_ar: ${product.name_ar || 'N/A'}`);
            
            // Show all keys that might be localization-related
            const keys = Object.keys(product);
            const localizationKeys = keys.filter(key => 
                key.includes('name') || 
                key.includes('localized') || 
                key.includes('_ar') || 
                key.includes('_en') ||
                key.includes('title') ||
                key.includes('label')
            );
            
            if (localizationKeys.length > 0) {
                console.log(`   📝 All localization-related fields:`);
                localizationKeys.forEach(key => {
                    console.log(`      ${key}: ${product[key] || 'N/A'}`);
                });
            }
            
            console.log(''); // Empty line between products
        }
        
        // Summary
        const hasNameLocalized = result.items.some(p => p.name_localized);
        const hasNameAr = result.items.some(p => p.name_ar);
        const hasOtherLocalizations = result.items.some(p => 
            Object.keys(p).some(k => 
                (k.includes('_ar') || k.includes('_en') || k.includes('localized')) && 
                k !== 'name_localized' && k !== 'name_ar'
            )
        );
        
        console.log('📊 Localization Summary:');
        console.log(`   • Products with name_localized: ${result.items.filter(p => p.name_localized).length}/${result.items.length}`);
        console.log(`   • Products with name_ar: ${result.items.filter(p => p.name_ar).length}/${result.items.length}`);
        console.log(`   • Any name_localized found: ${hasNameLocalized ? '✅ Yes' : '❌ No'}`);
        console.log(`   • Any name_ar found: ${hasNameAr ? '✅ Yes' : '❌ No'}`);
        console.log(`   • Other localization fields: ${hasOtherLocalizations ? '✅ Yes' : '❌ No'}`);
        
        // Also test categories for comparison
        console.log('\n🏷️ Testing category localization for comparison...');
        const categoriesResult = await client.listCategories();
        if (categoriesResult && categoriesResult.items && categoriesResult.items.length > 0) {
            const firstCategory = categoriesResult.items[0];
            console.log(`📂 First category:`);
            console.log(`   name: ${firstCategory.name || 'N/A'}`);
            console.log(`   name_localized: ${firstCategory.name_localized || 'N/A'}`);
            console.log(`   name_ar: ${firstCategory.name_ar || 'N/A'}`);
        }
        
        console.log('\n🎯 Recommendation:');
        if (hasNameLocalized || hasNameAr) {
            console.log('✅ Foodics API provides product localization! The sync should now capture these fields.');
            if (hasNameLocalized) {
                console.log('   → Use product.name_localized as the primary localized field');
            }
            if (hasNameAr) {
                console.log('   → Also check product.name_ar as fallback');
            }
        } else {
            console.log('⚠️  No product localization fields found in the API response.');
            console.log('   This might be because:');
            console.log('   • The tenant doesn\'t have localized content');
            console.log('   • Localization is configured differently');
            console.log('   • The API requires different parameters to include localized fields');
        }
        
    } catch (error) {
        console.error('❌ Error testing product localization:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testProductLocalization().catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
});