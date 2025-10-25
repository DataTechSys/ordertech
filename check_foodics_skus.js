#!/usr/bin/env node

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

async function checkFoodicsSKUs() {
    try {
        console.log('🔍 Checking Foodics product SKUs and identifiers...\n');
        
        const client = makeClient(FOODICS_TOKEN);
        const result = await client.listProducts();
        
        console.log(`✅ Found ${result.items.length} products\n`);
        
        // Check first few products for available fields
        console.log('📦 First 5 products with available fields:');
        for (let i = 0; i < Math.min(5, result.items.length); i++) {
            const product = result.items[i];
            console.log(`\n  Product ${i + 1}:`);
            console.log(`    id: ${product.id || 'N/A'}`);
            console.log(`    name: ${product.name || 'N/A'}`);
            console.log(`    name_localized: ${product.name_localized || 'N/A'}`);
            console.log(`    sku: ${product.sku || 'N/A'}`);
            console.log(`    reference: ${product.reference || 'N/A'}`);
            console.log(`    barcode: ${product.barcode || 'N/A'}`);
        }
        
        // Count products by identifier type
        const withSKU = result.items.filter(p => p.sku && p.sku.toString().trim()).length;
        const withReference = result.items.filter(p => p.reference && p.reference.toString().trim()).length;
        const withBarcode = result.items.filter(p => p.barcode && p.barcode.toString().trim()).length;
        const withLocalizedName = result.items.filter(p => p.name_localized).length;
        
        console.log('\n📊 Identifier Analysis:');
        console.log(`   • Products with SKU: ${withSKU}/${result.items.length}`);
        console.log(`   • Products with reference: ${withReference}/${result.items.length}`);
        console.log(`   • Products with barcode: ${withBarcode}/${result.items.length}`);
        console.log(`   • Products with Arabic names: ${withLocalizedName}/${result.items.length}`);
        
        // Show some examples of products with Arabic names
        const arabicProducts = result.items.filter(p => p.name_localized).slice(0, 3);
        if (arabicProducts.length > 0) {
            console.log('\n✨ Sample products with Arabic names:');
            arabicProducts.forEach((p, i) => {
                console.log(`   ${i + 1}. ${p.name} → ${p.name_localized}`);
                console.log(`      SKU: ${p.sku || 'N/A'}, ID: ${p.id}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking Foodics SKUs:', error.message);
    }
}

checkFoodicsSKUs();