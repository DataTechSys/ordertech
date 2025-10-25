const express = require('express');
const router = express.Router();
const { syncModifiersFromCSV } = require('../scripts/sync_modifiers_from_csv');

// Endpoint to trigger modifier sync from CSV
router.post('/trigger', async (req, res) => {
    try {
        console.log('🚀 Starting modifier sync via HTTP endpoint...');
        
        // Set response headers to keep connection alive during long operation
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');
        
        // Send initial response
        res.write('🚀 Starting modifier sync from CSV data...\n');
        
        // Override console.log to send updates to client
        const originalLog = console.log;
        const originalError = console.error;
        
        console.log = (...args) => {
            originalLog(...args);
            res.write(args.join(' ') + '\n');
        };
        
        console.error = (...args) => {
            originalError(...args);
            res.write('ERROR: ' + args.join(' ') + '\n');
        };
        
        // Run the sync
        await syncModifiersFromCSV();
        
        // Restore console functions
        console.log = originalLog;
        console.error = originalError;
        
        res.write('\n✅ Modifier sync completed successfully!\n');
        res.end();
        
    } catch (error) {
        console.error('❌ Sync failed:', error.message);
        res.write('\n❌ Sync failed: ' + error.message + '\n');
        res.status(500).end();
    }
});

// Status endpoint to check if sync is needed
router.get('/status', async (req, res) => {
    try {
        const { pool } = require('../models/database');
        
        const modifierGroupCount = await pool.query('SELECT COUNT(*) FROM modifier_groups');
        const modifierOptionCount = await pool.query('SELECT COUNT(*) FROM modifier_options');
        const productModifierCount = await pool.query('SELECT COUNT(*) FROM product_modifier_groups');
        const productsWithModifiers = await pool.query(`
            SELECT COUNT(DISTINCT p.id) 
            FROM products p 
            INNER JOIN product_modifier_groups pmg ON p.id = pmg.product_id
        `);
        
        res.json({
            status: 'ok',
            stats: {
                modifier_groups: parseInt(modifierGroupCount.rows[0].count),
                modifier_options: parseInt(modifierOptionCount.rows[0].count),
                product_modifier_links: parseInt(productModifierCount.rows[0].count),
                products_with_modifiers: parseInt(productsWithModifiers.rows[0].count)
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Debug endpoint to check table schemas and constraints
router.get('/debug-constraint', async (req, res) => {
    try {
        const { pool } = require('../models/database');
        
        // Check foreign key constraints on product_modifier_groups table
        const constraintsQuery = `
            SELECT 
                tc.constraint_name,
                tc.table_schema,
                tc.table_name,
                kcu.column_name,
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = 'product_modifier_groups'
            ORDER BY tc.table_schema, tc.constraint_name;
        `;
        
        const constraints = await pool.query(constraintsQuery);
        
        // Also check if tables exist in different schemas
        const tablesQuery = `
            SELECT schemaname, tablename 
            FROM pg_tables 
            WHERE tablename IN ('product_modifier_groups', 'modifier_groups', 'products')
            ORDER BY schemaname, tablename;
        `;
        
        const tables = await pool.query(tablesQuery);
        
        // Check some sample data
        const sampleModifierGroups = await pool.query(`
            SELECT 'catalog' as schema, id, tenant_id, reference, name 
            FROM catalog.modifier_groups 
            LIMIT 5
        `);
        
        const sampleProducts = await pool.query(`
            SELECT 'catalog' as schema, id, tenant_id, sku, name 
            FROM catalog.products 
            LIMIT 5
        `);
        
        res.json({
            constraints: constraints.rows,
            available_tables: tables.rows,
            sample_modifier_groups: sampleModifierGroups.rows,
            sample_products: sampleProducts.rows
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// Test insertion endpoint
router.get('/debug-test-insert', async (req, res) => {
    try {
        const { pool } = require('../models/database');
        
        // Get a sample product and modifier group from catalog schema
        const product = await pool.query(`
            SELECT id, sku, name FROM catalog.products LIMIT 1
        `);
        
        const modifierGroup = await pool.query(`
            SELECT id, reference, name FROM catalog.modifier_groups LIMIT 1
        `);
        
        if (product.rows.length === 0 || modifierGroup.rows.length === 0) {
            return res.json({
                message: 'No sample data available',
                products_count: product.rows.length,
                modifier_groups_count: modifierGroup.rows.length
            });
        }
        
        const productId = product.rows[0].id;
        const modifierGroupId = modifierGroup.rows[0].id;
        
        try {
            // Test insert into catalog.product_modifier_groups
            await pool.query(`
                INSERT INTO catalog.product_modifier_groups (product_id, group_id) 
                VALUES ($1, $2)
            `, [productId, modifierGroupId]);
            
            // Clean up the test insert
            await pool.query(`
                DELETE FROM catalog.product_modifier_groups 
                WHERE product_id = $1 AND group_id = $2
            `, [productId, modifierGroupId]);
            
            res.json({
                success: true,
                message: 'Test insert succeeded',
                test_product: product.rows[0],
                test_modifier_group: modifierGroup.rows[0]
            });
            
        } catch (insertError) {
            res.json({
                success: false,
                message: 'Test insert failed',
                error: insertError.message,
                test_product: product.rows[0],
                test_modifier_group: modifierGroup.rows[0]
            });
        }
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;
