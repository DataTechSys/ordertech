#!/usr/bin/env node

// Test script to analyze Foodics API product-modifier relationships
// This will help debug why modifier groups show 0 products assigned

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
    console.error('❌ Foodics token not found. Set FOODICS_TOKEN env var or ensure ios/foodics_token.txt exists');
    process.exit(1);
}

async function testFoodicsModifiers() {
    console.log('🔍 Testing Foodics API product-modifier relationships...\n');
    
    try {
        const client = makeClient(FOODICS_TOKEN);
        
        // 1. Fetch all products (with modifiers included if possible)
        console.log('📦 Fetching products...');
        const productsResult = await client.listProducts();
        console.log(`✅ Found ${productsResult.items.length} products\n`);
        
        // 2. Fetch modifier groups
        console.log('🏷️  Fetching modifier groups...');
        const modifierGroupsResult = await client.listModifierGroups();
        console.log(`✅ Found ${modifierGroupsResult.items.length} modifier groups\n`);
        
        // 3. Fetch modifier options
        console.log('⚙️  Fetching modifier options...');
        const modifierOptionsResult = await client.listModifierOptions();
        console.log(`✅ Found ${modifierOptionsResult.items.length} modifier options\n`);
        
        // 4. Try to fetch product-modifier assignments
        console.log('🔗 Fetching product-modifier assignments...');
        let assignmentsResult = { items: [], requests: 0 };
        try {
            assignmentsResult = await client.listProductModifierAssignments();
            console.log(`✅ Found ${assignmentsResult.items.length} product-modifier assignments\n`);
        } catch (error) {
            console.log(`⚠️  Product-modifier assignments not available: ${error.message}\n`);
        }
        
        // 5. Analyze products with embedded modifier data
        console.log('=' .repeat(80));
        console.log('📊 PRODUCT-MODIFIER RELATIONSHIP ANALYSIS');
        console.log('=' .repeat(80));
        
        // Look for products with modifiers embedded
        const productsWithModifiers = productsResult.items.filter(product => {
            return product.modifiers && Array.isArray(product.modifiers) && product.modifiers.length > 0;
        });
        
        console.log(`\n🍕 Products with embedded modifiers: ${productsWithModifiers.length}/${productsResult.items.length}`);
        
        if (productsWithModifiers.length > 0) {
            console.log('\n📋 Sample products with modifiers:');
            productsWithModifiers.slice(0, 5).forEach((product, index) => {
                console.log(`\n${index + 1}. ${product.name} (ID: ${product.id})`);
                console.log(`   - ${product.modifiers.length} modifier groups:`);
                product.modifiers.forEach(mod => {
                    const optionCount = mod.options ? mod.options.length : 0;
                    console.log(`     • ${mod.name || mod.group_name || 'Unnamed'} (${optionCount} options)`);
                });
            });
        }
        
        // 6. Check if modifiers have product_id references
        console.log('\n🔗 Checking modifier structure for product references...');
        
        // Sample a few modifier groups to see their structure
        if (modifierGroupsResult.items.length > 0) {
            console.log('\n🏷️  Sample modifier group structure:');
            console.log(JSON.stringify(modifierGroupsResult.items[0], null, 2));
        }
        
        // Sample modifier options
        if (modifierOptionsResult.items.length > 0) {
            console.log('\n⚙️  Sample modifier option structure:');
            console.log(JSON.stringify(modifierOptionsResult.items[0], null, 2));
        }
        
        // 7. Check specific products mentioned in the issue
        console.log('\n🔍 Looking for specific products mentioned in the issue...');
        
        const searchTerms = ['ICED', 'Matcha', 'matcha', 'iced'];
        const matchingProducts = productsResult.items.filter(product => {
            return searchTerms.some(term => 
                product.name.toLowerCase().includes(term.toLowerCase())
            );
        });
        
        if (matchingProducts.length > 0) {
            console.log(`\n✅ Found ${matchingProducts.length} products matching search terms:`);
            matchingProducts.forEach(product => {
                console.log(`\n• ${product.name} (ID: ${product.id})`);
                console.log(`  - Reference: ${product.reference || 'None'}`);
                
                if (product.modifiers && product.modifiers.length > 0) {
                    console.log(`  - Modifiers: ${product.modifiers.length} groups`);
                    product.modifiers.forEach(mod => {
                        console.log(`    • ${mod.name || 'Unnamed'} - ${mod.options ? mod.options.length : 0} options`);
                    });
                } else {
                    console.log(`  - Modifiers: None embedded`);
                }
            });
        } else {
            console.log('❌ No products found matching "ICED", "Matcha", etc.');
        }
        
        // 8. Look for modifier groups with "Milk" in the name
        console.log('\n🥛 Looking for modifier groups with "Milk"...');
        const milkGroups = modifierGroupsResult.items.filter(group => 
            group.name.toLowerCase().includes('milk')
        );
        
        if (milkGroups.length > 0) {
            console.log(`✅ Found ${milkGroups.length} modifier groups with "Milk":`);
            milkGroups.forEach(group => {
                console.log(`• ${group.name} (ID: ${group.id}, Ref: ${group.reference || 'None'})`);
            });
            
            // Try to get options for the first milk group
            if (milkGroups[0]) {
                try {
                    console.log(`\n🔍 Fetching options for "${milkGroups[0].name}"...`);
                    const optionsResult = await client.listGroupOptions(milkGroups[0].id);
                    console.log(`✅ Found ${optionsResult.items.length} options:`);
                    optionsResult.items.slice(0, 10).forEach(option => {
                        console.log(`  • ${option.name} - ${option.price || 0} (${option.id})`);
                    });
                } catch (error) {
                    console.log(`⚠️  Could not fetch options: ${error.message}`);
                }
            }
        } else {
            console.log('❌ No modifier groups found with "Milk"');
        }
        
        // 9. Summary and recommendations
        console.log('\n' + '=' .repeat(80));
        console.log('📋 SUMMARY AND RECOMMENDATIONS');
        console.log('=' .repeat(80));
        
        console.log(`\n📊 Data Summary:`);
        console.log(`   • Products: ${productsResult.items.length}`);
        console.log(`   • Products with embedded modifiers: ${productsWithModifiers.length}`);
        console.log(`   • Modifier groups: ${modifierGroupsResult.items.length}`);
        console.log(`   • Modifier options: ${modifierOptionsResult.items.length}`);
        console.log(`   • Assignment records: ${assignmentsResult.items.length}`);
        
        console.log(`\n💡 Key Findings:`);
        if (productsWithModifiers.length > 0) {
            console.log(`   ✅ Products DO have modifiers embedded in the API response`);
            console.log(`   ✅ This suggests the relationship exists in Foodics`);
        } else {
            console.log(`   ❌ No products have modifiers embedded`);
            console.log(`   ❌ Either no relationships exist or they're in separate endpoints`);
        }
        
        if (assignmentsResult.items.length > 0) {
            console.log(`   ✅ Assignment endpoint is available with ${assignmentsResult.items.length} records`);
        } else {
            console.log(`   ⚠️  Assignment endpoint is not available or empty`);
        }
        
        console.log(`\n🔧 Next Steps:`);
        if (productsWithModifiers.length > 0) {
            console.log(`   1. Import should work - check local database for correct relationships`);
            console.log(`   2. Verify the product-modifier import logic in the sync process`);
            console.log(`   3. Check if the counting query in the admin panel is correct`);
        } else {
            console.log(`   1. Check if tenant has configured modifiers in Foodics dashboard`);
            console.log(`   2. Verify if different API endpoints or parameters are needed`);
            console.log(`   3. Consider manual relationship setup if API doesn't provide them`);
        }
        
        // Save detailed results
        const analysis = {
            timestamp: new Date().toISOString(),
            summary: {
                total_products: productsResult.items.length,
                products_with_modifiers: productsWithModifiers.length,
                total_modifier_groups: modifierGroupsResult.items.length,
                total_modifier_options: modifierOptionsResult.items.length,
                assignment_records: assignmentsResult.items.length
            },
            products_with_modifiers: productsWithModifiers.map(p => ({
                id: p.id,
                name: p.name,
                modifier_count: p.modifiers ? p.modifiers.length : 0,
                modifiers: p.modifiers ? p.modifiers.map(m => ({
                    name: m.name,
                    option_count: m.options ? m.options.length : 0
                })) : []
            })),
            matching_products: matchingProducts.map(p => ({
                id: p.id,
                name: p.name,
                reference: p.reference,
                has_modifiers: !!(p.modifiers && p.modifiers.length > 0)
            })),
            milk_groups: milkGroups.map(g => ({
                id: g.id,
                name: g.name,
                reference: g.reference
            }))
        };
        
        const outputFile = path.join(__dirname, 'tmp/foodics_modifier_analysis.json');
        // Ensure tmp directory exists
        const tmpDir = path.dirname(outputFile);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
        console.log(`\n💾 Detailed analysis saved to: ${outputFile}`);
        
        console.log('\n🎉 Analysis complete!');
        
    } catch (error) {
        console.error('❌ Error analyzing Foodics data:', error.message);
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            console.error('💡 Token might be expired. Please refresh the Foodics token.');
        }
        process.exit(1);
    }
}

// Run the analysis
testFoodicsModifiers().catch(error => {
    console.error('💥 Analysis failed:', error);
    process.exit(1);
});