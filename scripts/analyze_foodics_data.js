#!/usr/bin/env node

// Analyze Foodics product and modifier data to understand the structure
// for proper import and cashier integration

const fs = require('fs');
const path = require('path');
const { makeClient } = require('../server/integrations/foodics.js');

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, '../ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
    FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

if (!FOODICS_TOKEN) {
    console.error('❌ Foodics token not found. Set FOODICS_TOKEN env var or ensure ios/foodics_token.txt exists');
    process.exit(1);
}

async function analyzeFoodicsData() {
    console.log('🚀 Analyzing Foodics API data structure...\n');
    
    try {
        const client = makeClient(FOODICS_TOKEN);
        
        // 1. Fetch products with full modifier information
        console.log('📦 Fetching products with modifier information...');
        const productsResult = await client.listProducts();
        console.log(`✅ Found ${productsResult.items.length} products (${productsResult.requests} API calls)\n`);
        
        // 2. Fetch modifier groups
        console.log('🏷️  Fetching modifier groups...');
        const modifierGroupsResult = await client.listModifierGroups();
        console.log(`✅ Found ${modifierGroupsResult.items.length} modifier groups (${modifierGroupsResult.requests} API calls)\n`);
        
        // 3. Fetch modifier options
        console.log('⚙️  Fetching modifier options...');
        const modifierOptionsResult = await client.listModifierOptions();
        console.log(`✅ Found ${modifierOptionsResult.items.length} modifier options (${modifierOptionsResult.requests} API calls)\n`);
        
        // 4. Fetch product-modifier assignments (optional - might not exist)
        console.log('🔗 Fetching product-modifier assignments...');
        let assignmentsResult = { items: [], requests: 0 };
        try {
            assignmentsResult = await client.listProductModifierAssignments();
            console.log(`✅ Found ${assignmentsResult.items.length} product-modifier assignments (${assignmentsResult.requests} API calls)\n`);
        } catch (error) {
            console.log(`⚠️  Product-modifier assignments not available: ${error.message}`);
            console.log('   (This is expected - assignments are usually embedded in products)\n');
        }
        
        // Analyze the structure
        console.log('=' .repeat(80));
        console.log('📊 DATA STRUCTURE ANALYSIS');
        console.log('=' .repeat(80));
        
        // Analyze products with modifiers
        console.log('\n🍕 PRODUCTS WITH MODIFIERS:');
        const productsWithModifiers = productsResult.items.filter(product => 
            product.modifiers && Array.isArray(product.modifiers) && product.modifiers.length > 0
        );
        console.log(`Found ${productsWithModifiers.length} products with modifiers attached`);
        
        if (productsWithModifiers.length > 0) {
            const sampleProduct = productsWithModifiers[0];
            console.log(`\nSample product: ${sampleProduct.name} (ID: ${sampleProduct.id})`);
            console.log('Modifiers structure:');
            console.log(JSON.stringify(sampleProduct.modifiers, null, 2));
            
            // Check if modifiers have options embedded
            if (sampleProduct.modifiers[0] && sampleProduct.modifiers[0].options) {
                console.log('\nSample modifier options:');
                console.log(JSON.stringify(sampleProduct.modifiers[0].options.slice(0, 3), null, 2));
            }
        }
        
        // Analyze modifier groups structure
        console.log('\n🏷️  MODIFIER GROUPS STRUCTURE:');
        if (modifierGroupsResult.items.length > 0) {
            const sampleGroup = modifierGroupsResult.items[0];
            console.log('Sample modifier group:');
            console.log(JSON.stringify(sampleGroup, null, 2));
            
            // Check for options in the group
            if (sampleGroup.id) {
                console.log(`\n⚙️  Fetching options for group: ${sampleGroup.name} (ID: ${sampleGroup.id})`);
                try {
                    const groupOptions = await client.listGroupOptions(sampleGroup.id);
                    console.log(`Found ${groupOptions.items.length} options for this group`);
                    if (groupOptions.items.length > 0) {
                        console.log('Sample options:');
                        console.log(JSON.stringify(groupOptions.items.slice(0, 3), null, 2));
                    }
                } catch (error) {
                    console.log(`Could not fetch group options: ${error.message}`);
                }
            }
        }
        
        // Analyze modifier options structure
        console.log('\n⚙️  MODIFIER OPTIONS STRUCTURE:');
        if (modifierOptionsResult.items.length > 0) {
            console.log('Sample modifier options:');
            console.log(JSON.stringify(modifierOptionsResult.items.slice(0, 3), null, 2));
        }
        
        // Analyze product-modifier assignments
        console.log('\n🔗 PRODUCT-MODIFIER ASSIGNMENTS:');
        if (assignmentsResult.items.length > 0) {
            console.log('Sample assignments:');
            console.log(JSON.stringify(assignmentsResult.items.slice(0, 5), null, 2));
        }
        
        // Generate mapping analysis
        console.log('\n📋 MAPPING ANALYSIS:');
        
        // Products by category
        const categoriesMap = new Map();
        productsResult.items.forEach(product => {
            const categoryId = product.category_id || product.category?.id || 'uncategorized';
            const categoryName = product.category?.name || 'Uncategorized';
            if (!categoriesMap.has(categoryId)) {
                categoriesMap.set(categoryId, { name: categoryName, count: 0, products: [] });
            }
            categoriesMap.get(categoryId).count++;
            categoriesMap.get(categoryId).products.push(product.name);
        });
        
        console.log(`\n📂 Products by category (${categoriesMap.size} categories):`);
        for (const [id, data] of categoriesMap) {
            console.log(`  • ${data.name}: ${data.count} products`);
        }
        
        // Modifier groups by usage
        const modifierUsage = new Map();
        productsWithModifiers.forEach(product => {
            product.modifiers.forEach(modifier => {
                const groupId = modifier.id || modifier.group_id;
                const groupName = modifier.name || modifier.group_name || 'Unknown';
                if (!modifierUsage.has(groupId)) {
                    modifierUsage.set(groupId, { name: groupName, productCount: 0, products: [] });
                }
                modifierUsage.get(groupId).productCount++;
                modifierUsage.get(groupId).products.push(product.name);
            });
        });
        
        console.log(`\n🏷️  Modifier groups by usage (${modifierUsage.size} groups):`);
        for (const [id, data] of modifierUsage) {
            console.log(`  • ${data.name}: used in ${data.productCount} products`);
        }
        
        // Generate import suggestions
        console.log('\n💡 IMPORT RECOMMENDATIONS:');
        console.log('1. Product Import:');
        console.log(`   - Import ${productsResult.items.length} products`);
        console.log(`   - ${productsWithModifiers.length} products have modifiers attached`);
        console.log(`   - ${categoriesMap.size} categories to organize products`);
        
        console.log('2. Modifier Import:');
        console.log(`   - Import ${modifierGroupsResult.items.length} modifier groups`);
        console.log(`   - Import ${modifierOptionsResult.items.length} modifier options`);
        console.log(`   - Create ${assignmentsResult.items.length} product-modifier assignments`);
        
        console.log('3. Database Schema Requirements:');
        console.log('   - products table: id, name, description, price, category_id, active');
        console.log('   - modifier_groups table: id, name, reference, min_select, max_select');
        console.log('   - modifier_options table: id, group_id, name, price, reference');
        console.log('   - product_modifier_groups table: product_id, group_id, required, min_select, max_select');
        
        // Save detailed analysis to file
        const analysis = {
            timestamp: new Date().toISOString(),
            summary: {
                products: productsResult.items.length,
                productsWithModifiers: productsWithModifiers.length,
                modifierGroups: modifierGroupsResult.items.length,
                modifierOptions: modifierOptionsResult.items.length,
                assignments: assignmentsResult.items.length,
                categories: categoriesMap.size
            },
            products: productsResult.items,
            modifierGroups: modifierGroupsResult.items,
            modifierOptions: modifierOptionsResult.items,
            assignments: assignmentsResult.items,
            categoriesMap: Object.fromEntries(categoriesMap),
            modifierUsage: Object.fromEntries(modifierUsage)
        };
        
        const outputFile = path.join(__dirname, '../tmp/foodics_analysis.json');
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
if (require.main === module) {
    analyzeFoodicsData().catch(error => {
        console.error('💥 Analysis failed:', error);
        process.exit(1);
    });
}

module.exports = { analyzeFoodicsData };