#!/usr/bin/env node

// Cloud Run Job script for importing product-modifier relationships
// This script runs on Cloud Run and imports the product-modifier relationship data

const fs = require('fs');
const https = require('https');
const { Pool } = require('pg');

// Configuration
const CSV_DATA = `product_name,product_name_localized,product_sku,modifier_name,modifier_name_localized,modifier_reference,minimum_options,maximum_options,free_options,default_options,unique_options
"ICED | Black Spanish (M)","بلاك سبانش",PIC-101,Extra,,extra,0,2,0,,No
"ICED | Black Spanish (M)","بلاك سبانش",PIC-101,Delivery,,delivery,0,2,0,,No
"ICED | Black Spanish (M)","بلاك سبانش",PIC-101,"Milk | Medium",,milk_medium,1,2,0,,No
"ICED | Black Spanish (M)","بلاك سبانش",PIC-101,"Coffee | Shots",,coffee_shot,1,1,0,,No
"HOT | Spanish Latte (M)","سبانش لاتيه - ساخن",PHT-115,Extra,,extra,0,2,0,,No
"HOT | Spanish Latte (M)","سبانش لاتيه - ساخن",PHT-115,"Hot Milk","حليب ساخن",hot_milk,1,2,0,,No
"HOT | Spanish Latte (M)","سبانش لاتيه - ساخن",PHT-115,Delivery,,delivery,0,2,0,,No
"HOT | Spanish Latte (M)","سبانش لاتيه - ساخن",PHT-115,"Coffee | Shots",,coffee_shot,1,1,0,,No
"Croissant | Feta Cheese","كرواسان جبنة الفيتا",PCR-104,Delivery,,delivery,0,1,0,,No
"ICED | Spanish Latte (M)","سبانش لاتيه | مثلج",PIC-110,Extra,,extra,0,2,0,,No
"ICED | Spanish Latte (M)","سبانش لاتيه | مثلج",PIC-110,Delivery,,delivery,0,2,0,,No
"ICED | Spanish Latte (M)","سبانش لاتيه | مثلج",PIC-110,"Milk | Medium",,milk_medium,1,2,0,,No
"ICED | Spanish Latte (M)","سبانش لاتيه | مثلج",PIC-110,"Coffee | Shots",,coffee_shot,1,1,0,,No
"HOT | Americano (M)","امريكانو - ساخن",PHT-101,Extra,,extra,0,2,0,,No
"HOT | Americano (M)","امريكانو - ساخن",PHT-101,Option,,option,0,1,0,,No
"HOT | Americano (M)","امريكانو - ساخن",PHT-101,Delivery,,delivery,0,2,0,,No
"HOT | Americano (M)","امريكانو - ساخن",PHT-101,"Coffee | Shots",,coffee_shot,1,1,0,,No`;

const BATCH_SIZE = 10;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Database connection using environment variables from Cloud Run
function createDbPool() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('❌ DATABASE_URL environment variable not set');
        process.exit(1);
    }
    
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: false // Cloud SQL Proxy handles SSL
    });
    
    return pool;
}

// Parse CSV data
function parseCSV(csvContent) {
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        throw new Error('CSV data is empty');
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

// Database helper
async function db(pool, sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows;
    } finally {
        client.release();
    }
}

// Get product by name from database
async function getProductByName(pool, tenantId, productName) {
    const rows = await db(pool, 
        'SELECT id, name FROM products WHERE tenant_id = $1 AND name = $2 AND active = true',
        [tenantId, productName]
    );
    return rows.length > 0 ? rows[0] : null;
}

// Get modifier group by reference from database
async function getModifierGroupByReference(pool, tenantId, reference) {
    const rows = await db(pool,
        'SELECT id, name, reference FROM modifier_groups WHERE tenant_id = $1 AND reference = $2',
        [tenantId, reference]
    );
    return rows.length > 0 ? rows[0] : null;
}

// Check if product-modifier relationship already exists
async function checkExistingRelationship(pool, productId, modifierGroupId) {
    const rows = await db(pool,
        'SELECT 1 FROM product_modifier_groups WHERE product_id = $1 AND group_id = $2',
        [productId, modifierGroupId]
    );
    return rows.length > 0;
}

// Create product-modifier relationship
async function createProductModifierRelationship(pool, productId, modifierGroupId, relationshipData) {
    const minOptions = parseInt(relationshipData.minimum_options) || 0;
    const maxOptions = parseInt(relationshipData.maximum_options) || 0;
    const required = minOptions > 0;
    const uniqueOptions = relationshipData.unique_options === 'Yes';
    
    await db(pool, `
        INSERT INTO product_modifier_groups (product_id, group_id, sort_order, required, min_select, max_select, unique_options)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (product_id, group_id) DO UPDATE SET
            required = EXCLUDED.required,
            min_select = EXCLUDED.min_select,
            max_select = EXCLUDED.max_select,
            unique_options = EXCLUDED.unique_options
    `, [productId, modifierGroupId, 0, required, minOptions, maxOptions, uniqueOptions]);
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main import function
async function importProductModifierRelationships() {
    console.log('🚀 Starting Cloud Run product-modifier relationship import...\n');

    const pool = createDbPool();
    
    try {
        // Parse CSV data
        console.log('📁 Parsing CSV data...');
        const relationships = parseCSV(CSV_DATA);
        console.log(`✅ Parsed ${relationships.length} relationship records\n`);

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
                    const product = await getProductByName(pool, DEFAULT_TENANT_ID, relationship.product_name);
                    if (!product) {
                        console.log(`⚠️  Product not found: ${relationship.product_name}`);
                        errors++;
                        continue;
                    }

                    // Get modifier group by reference
                    const modifierGroup = await getModifierGroupByReference(pool, DEFAULT_TENANT_ID, relationship.modifier_reference);
                    if (!modifierGroup) {
                        console.log(`⚠️  Modifier group not found: ${relationship.modifier_reference}`);
                        errors++;
                        continue;
                    }

                    // Check if relationship already exists
                    const exists = await checkExistingRelationship(pool, product.id, modifierGroup.id);
                    if (exists) {
                        console.log(`⏭️  Relationship already exists: ${relationship.product_name} → ${relationship.modifier_reference}`);
                        skipped++;
                        continue;
                    }

                    // Create the relationship
                    await createProductModifierRelationship(pool, product.id, modifierGroup.id, relationship);
                    console.log(`✅ Linked: ${relationship.product_name} → ${relationship.modifier_reference} (min:${relationship.minimum_options}, max:${relationship.maximum_options})`);
                    successful++;

                } catch (error) {
                    console.log(`❌ Error processing ${relationship.product_name} → ${relationship.modifier_reference}:`, error.message);
                    errors++;
                }

                // Rate limiting
                await sleep(50);
            }

            // Pause between batches
            if (i + BATCH_SIZE < relationships.length) {
                console.log('⏳ Pausing between batches...');
                await sleep(500);
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
        } else if (skipped === processed) {
            console.log('\n✨ All relationships already exist in the system.');
        } else {
            console.log('\n⚠️  Import completed with some failures. Check the error messages above.');
        }

    } finally {
        await pool.end();
    }
}

// Run the import if this script is executed directly
if (require.main === module) {
    importProductModifierRelationships().catch(error => {
        console.error('💥 Import failed:', error);
        process.exit(1);
    });
}

module.exports = { importProductModifierRelationships };