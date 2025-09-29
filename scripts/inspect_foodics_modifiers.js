#!/usr/bin/env node

// Quick inspection of Foodics modifier data structure

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
    console.error('❌ Foodics token not found');
    process.exit(1);
}

async function inspectFoodicsData() {
    console.log('🔍 Inspecting Foodics modifier data structure...\n');

    const client = makeClient(FOODICS_TOKEN);
    
    try {
        const [modifierGroupsResult, modifierOptionsResult] = await Promise.all([
            client.listModifierGroups(), 
            client.listModifierOptions()
        ]);

        console.log('📊 Data Summary:');
        console.log(`   - Modifier Groups: ${modifierGroupsResult.items.length}`);
        console.log(`   - Modifier Options: ${modifierOptionsResult.items.length}\n`);

        // Show sample modifier group
        if (modifierGroupsResult.items.length > 0) {
            console.log('🏷️ Sample Modifier Group:');
            console.log(JSON.stringify(modifierGroupsResult.items[0], null, 2));
            console.log('\n');
        }

        // Show sample modifier option
        if (modifierOptionsResult.items.length > 0) {
            console.log('⚙️ Sample Modifier Option:');
            console.log(JSON.stringify(modifierOptionsResult.items[0], null, 2));
            console.log('\n');
        }

        // Check how many options have modifier_group_id
        const optionsWithGroup = modifierOptionsResult.items.filter(o => o.modifier_group_id);
        console.log(`📈 Options with modifier_group_id: ${optionsWithGroup.length}/${modifierOptionsResult.items.length}`);

        if (optionsWithGroup.length > 0) {
            console.log('\n⚙️ Sample Option with Group:');
            console.log(JSON.stringify(optionsWithGroup[0], null, 2));
        }

    } catch (error) {
        console.error('💥 Error:', error.message);
        process.exit(1);
    }
}

inspectFoodicsData();