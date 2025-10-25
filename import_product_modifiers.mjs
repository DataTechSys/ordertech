#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Configuration
const BASE_URL = 'http://localhost:3000';
const CSV_FILE = '/tmp/product_modifier_relationships.csv';
const BATCH_SIZE = 10;

// HTTP request helper
async function makeRequest(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${BASE_URL}${endpoint}`, options);
        const responseText = await response.text();
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.warn(`Failed to parse JSON response: ${responseText.substring(0, 100)}...`);
            data = { error: responseText };
        }

        return {
            status: response.status,
            ok: response.ok,
            data
        };
    } catch (error) {
        console.error(`Request failed for ${endpoint}:`, error.message);
        return {
            status: 0,
            ok: false,
            data: { error: error.message }
        };
    }
}

// Parse CSV file
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }
    
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim()); // Add the last value
        
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index];
            });
            rows.push(row);
        }
    }
    
    return rows;
}

// Get product by name
async function getProductByName(name) {
    const response = await makeRequest(`/products`);
    if (response.ok && Array.isArray(response.data)) {
        // Find exact match by name
        const exactMatch = response.data.find(p => p.name === name);
        if (exactMatch) return exactMatch;
        
        // If no exact match, try case-insensitive search
        const caseInsensitiveMatch = response.data.find(p => 
            p.name.toLowerCase() === name.toLowerCase()
        );
        return caseInsensitiveMatch || null;
    }
    return null;
}

// Get modifier group by reference
async function getModifierGroupByReference(reference) {
    const response = await makeRequest(`/modifier-groups?filters[reference]=${encodeURIComponent(reference)}`);
    if (response.ok && response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
    }
    return null;
}

// Link product to modifier group
async function linkProductToModifierGroup(productId, modifierGroupId, relationshipData) {
    const payload = {
        product_id: productId,
        modifier_group_id: modifierGroupId,
        minimum_options: parseInt(relationshipData.minimum_options) || 0,
        maximum_options: parseInt(relationshipData.maximum_options) || 0,
        free_options: parseInt(relationshipData.free_options) || 0,
        unique_options: relationshipData.unique_options === 'Yes',
    };

    // Add default_options if it exists and is not empty
    if (relationshipData.default_options && relationshipData.default_options.trim()) {
        payload.default_options = relationshipData.default_options.trim();
    }

    const response = await makeRequest('/product-modifier-groups', 'POST', payload);
    return response;
}

// Check if relationship already exists
async function checkExistingRelationship(productId, modifierGroupId) {
    const response = await makeRequest(`/product-modifier-groups?filters[product_id]=${productId}&filters[modifier_group_id]=${modifierGroupId}`);
    if (response.ok && response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
    }
    return null;
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main import function
async function importProductModifierRelationships() {
    console.log('🚀 Starting product-modifier relationship import...\n');

    // Parse CSV data
    console.log('📁 Reading CSV file...');
    let relationships;
    try {
        relationships = parseCSV(CSV_FILE);
        console.log(`✅ Parsed ${relationships.length} relationship records\n`);
    } catch (error) {
        console.error('❌ Failed to parse CSV file:', error.message);
        return;
    }

    // Statistics
    let processed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches
    for (let i = 0; i < relationships.length; i += BATCH_SIZE) {
        const batch = relationships.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(relationships.length / BATCH_SIZE)} (${batch.length} items):`);

        for (const relationship of batch) {
            processed++;
            
            try {
                // Get product by name
                const product = await getProductByName(relationship.product_name);
                if (!product) {
                    console.log(`⚠️  Product not found: name=${relationship.product_name}`);
                    errors++;
                    continue;
                }

                // Get modifier group by reference
                const modifierGroup = await getModifierGroupByReference(relationship.modifier_reference);
                if (!modifierGroup) {
                    console.log(`⚠️  Modifier group not found: reference=${relationship.modifier_reference}`);
                    errors++;
                    continue;
                }

                // Check if relationship already exists
                const existing = await checkExistingRelationship(product.id, modifierGroup.id);
                if (existing) {
                    console.log(`⏭️  Relationship already exists: ${relationship.product_name} → ${relationship.modifier_reference}`);
                    skipped++;
                    continue;
                }

                // Create the relationship
                const result = await linkProductToModifierGroup(product.id, modifierGroup.id, relationship);
                
                if (result.ok) {
                    console.log(`✅ Linked: ${relationship.product_name} → ${relationship.modifier_reference} (min:${relationship.minimum_options}, max:${relationship.maximum_options})`);
                    successful++;
                } else {
                    console.log(`❌ Failed to link ${relationship.product_name} → ${relationship.modifier_reference}:`, result.data.message || result.data.error || 'Unknown error');
                    errors++;
                }

            } catch (error) {
                console.log(`❌ Error processing ${relationship.product_name} → ${relationship.modifier_reference}:`, error.message);
                errors++;
            }

            // Rate limiting
            await sleep(100);
        }

        // Pause between batches
        if (i + BATCH_SIZE < relationships.length) {
            console.log('⏳ Pausing between batches...');
            await sleep(1000);
        }
    }

    // Final statistics
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed: ${processed}`);
    console.log(`✅ Successfully linked: ${successful}`);
    console.log(`⏭️  Skipped (already exist): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('='.repeat(60));

    if (successful > 0) {
        console.log('\n🎉 Import completed! Product-modifier relationships have been established.');
        console.log('\n💡 Next steps:');
        console.log('   1. Test the relationships by viewing products with their modifier groups');
        console.log('   2. Run a Foodics sync to ensure the system works end-to-end');
        console.log('   3. Verify the modifier options are properly grouped under products');
    } else if (skipped === processed) {
        console.log('\n✨ All relationships already exist in the system.');
    } else {
        console.log('\n⚠️  Import completed with some failures. Check the error messages above.');
    }
}

// Run the import
importProductModifierRelationships().catch(error => {
    console.error('💥 Import failed:', error);
    process.exit(1);
});

export { importProductModifierRelationships };
