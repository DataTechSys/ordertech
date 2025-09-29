#!/usr/bin/env node

// Cloud Run Job script for importing modifier groups
// This script runs on Cloud Run and imports modifier groups from CSV data

const fs = require('fs');
const { Pool } = require('pg');

// Configuration - Using actual modifier groups from data/modifiers.csv
const CSV_DATA = `id,reference,name,name_localized
9f815227-3b59-40b7-a522-390bf80da02d,,Pro | Milk,
9d76be85-0ced-4c1f-b56f-9fbdf1a4e8bc,,Coffee | Shots,
9cdfc461-cd9d-44e4-85f2-6f2f1503b467,,Milk | Medium,
9cdf625b-9d33-4049-97c2-ee63ff4f8386,,Milk | Large,
9cddcb75-dfa5-4b81-904e-53afec316cf3,,Delivery,
9c3852f0-d5ea-476e-b209-d0e92108f2bf,,Topping,
9b73d230-eb52-47a1-8621-9830f3a5ee37,,Hot Milk,حليب ساخن
99441b7f-4e0b-4868-8af5-9a7e2b83e087,,Cups,كوب
98d1f6b8-24d0-43b0-b2d2-24cdcfccd677,35,Flavors,
958c955e-85f4-4004-8c83-9717b6954e4a,11,Option,
92a842cb-5ab1-4fb5-a86a-e87fa223a29a,15,Color,
928883e2-31ea-4d77-88c4-fce6cb0feefa,22,Extra,`;

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

// Check if modifier group exists
async function modifierGroupExists(pool, tenantId, reference, name) {
    if (reference) {
        const rows = await db(pool,
            'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND reference = $2',
            [tenantId, reference]
        );
        return rows.length > 0;
    } else {
        const rows = await db(pool,
            'SELECT id FROM modifier_groups WHERE tenant_id = $1 AND name = $2',
            [tenantId, name]
        );
        return rows.length > 0;
    }
}

// Create modifier group
async function createModifierGroup(pool, tenantId, groupData) {
    const reference = groupData.reference || null;
    const name = groupData.name || 'Unnamed Group';
    const nameLocalized = groupData.name_localized || null;
    
    await db(pool, `
        INSERT INTO modifier_groups (tenant_id, reference, name, name_localized)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, reference) DO UPDATE SET
            name = EXCLUDED.name,
            name_localized = EXCLUDED.name_localized
    `, [tenantId, reference, name, nameLocalized]);
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main import function
async function importModifierGroups() {
    console.log('🚀 Starting Cloud Run modifier groups import...\n');

    const pool = createDbPool();
    
    try {
        // Parse CSV data
        console.log('📁 Parsing CSV data...');
        const groups = parseCSV(CSV_DATA);
        console.log(`✅ Parsed ${groups.length} modifier group records\n`);

        // Statistics
        let processed = 0;
        let successful = 0;
        let skipped = 0;
        let errors = 0;

        // Process in batches
        for (let i = 0; i < groups.length; i += BATCH_SIZE) {
            const batch = groups.slice(i, i + BATCH_SIZE);
            console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(groups.length / BATCH_SIZE)} (${batch.length} items):`);

            for (const group of batch) {
                processed++;
                
                try {
                    // Skip if no name
                    if (!group.name || !group.name.trim()) {
                        console.log(`⏭️  Skipping empty group name`);
                        skipped++;
                        continue;
                    }

                    // Check if group already exists
                    const exists = await modifierGroupExists(pool, DEFAULT_TENANT_ID, group.reference, group.name);
                    if (exists) {
                        console.log(`⏭️  Group already exists: ${group.name} (ref: ${group.reference || 'null'})`);
                        skipped++;
                        continue;
                    }

                    // Create the modifier group
                    await createModifierGroup(pool, DEFAULT_TENANT_ID, group);
                    console.log(`✅ Created: ${group.name} (ref: ${group.reference || 'null'})`);
                    successful++;

                } catch (error) {
                    console.log(`❌ Error processing ${group.name}:`, error.message);
                    errors++;
                }

                // Rate limiting
                await sleep(50);
            }

            // Pause between batches
            if (i + BATCH_SIZE < groups.length) {
                console.log('⏳ Pausing between batches...');
                await sleep(500);
            }
        }

        // Final statistics
        console.log('\n' + '='.repeat(60));
        console.log('📊 IMPORT SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total processed: ${processed}`);
        console.log(`✅ Successfully created: ${successful}`);
        console.log(`⏭️  Skipped (already exist): ${skipped}`);
        console.log(`❌ Errors: ${errors}`);
        console.log('='.repeat(60));

        if (successful > 0) {
            console.log('\n🎉 Import completed! Modifier groups have been created.');
        } else if (skipped === processed) {
            console.log('\n✨ All modifier groups already exist in the system.');
        } else {
            console.log('\n⚠️  Import completed with some failures. Check the error messages above.');
        }

    } finally {
        await pool.end();
    }
}

// Run the import if this script is executed directly
if (require.main === module) {
    importModifierGroups().catch(error => {
        console.error('💥 Import failed:', error);
        process.exit(1);
    });
}

module.exports = { importModifierGroups };