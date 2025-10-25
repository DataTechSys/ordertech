#!/usr/bin/env node

// Script to check products table schema

const { Pool } = require('pg');

// Database connection
function createDbPool() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('❌ DATABASE_URL environment variable not set');
        process.exit(1);
    }
    
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: false
    });
    
    return pool;
}

async function checkProductsSchema() {
    console.log('🔍 Checking products table schema...\n');

    const pool = createDbPool();
    
    try {
        // Check products table columns
        const columns = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'products' 
            AND table_schema = 'public'
            ORDER BY ordinal_position
        `);

        console.log('📊 PRODUCTS TABLE COLUMNS:');
        console.log('='.repeat(80));
        columns.rows.forEach(col => {
            console.log(`${col.column_name.padEnd(25)} | ${col.data_type.padEnd(20)} | ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });

        // Check if there are any price related columns
        const priceColumns = columns.rows.filter(col => 
            col.column_name.toLowerCase().includes('price')
        );

        console.log('\n💰 PRICE-RELATED COLUMNS:');
        if (priceColumns.length === 0) {
            console.log('❌ No price-related columns found!');
        } else {
            priceColumns.forEach(col => {
                console.log(`✅ ${col.column_name} (${col.data_type})`);
            });
        }

    } catch (error) {
        console.error('💥 Schema check failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the check operation if this script is executed directly
if (require.main === module) {
    checkProductsSchema().catch(error => {
        console.error('💥 Schema check failed:', error);
        process.exit(1);
    });
}

module.exports = { checkProductsSchema };