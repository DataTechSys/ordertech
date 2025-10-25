#!/usr/bin/env node

// Script to move inactive modifier groups and options to deleted status
// This will mark inactive items with deleted_at timestamps

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Configuration
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Database connection
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

async function moveInactiveToDeleted() {
    console.log('🔄 Starting to move inactive items to deleted status...\n');

    const pool = createDbPool();
    
    try {
        let movedGroups = 0;
        let movedOptions = 0;
        let skippedGroups = 0;
        let skippedOptions = 0;

        // Move inactive modifier groups to deleted
        console.log('🏷️  MOVING INACTIVE MODIFIER GROUPS TO DELETED...');
        
        // First, find inactive groups that are not already deleted
        const inactiveGroups = await db(pool, 
            `SELECT id, name, required 
             FROM modifier_groups 
             WHERE tenant_id = $1 
               AND deleted_at IS NULL 
               AND (required = false OR required IS NULL)
             ORDER BY name`,
            [DEFAULT_TENANT_ID]
        );

        console.log(`📋 Found ${inactiveGroups.length} potentially inactive groups to review...`);

        for (const group of inactiveGroups) {
            try {
                // Check if this group has any active options
                const activeOptionsCount = await db(pool, 
                    'SELECT COUNT(*) as count FROM modifier_options WHERE group_id = $1 AND is_active = true AND deleted_at IS NULL',
                    [group.id]
                );

                const hasActiveOptions = parseInt(activeOptionsCount[0]?.count || 0) > 0;

                // Only move groups that are not required and have no active options
                if (!group.required && !hasActiveOptions) {
                    // Mark as deleted with current timestamp
                    const result = await db(pool, 
                        'UPDATE modifier_groups SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2',
                        [group.id, DEFAULT_TENANT_ID]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`✅ Moved group to deleted: ${group.name}`);
                        movedGroups++;
                    }
                } else {
                    console.log(`⏭️  Skipped group (required or has active options): ${group.name}`);
                    skippedGroups++;
                }
            } catch (error) {
                console.log(`❌ Error processing group ${group.name}:`, error.message);
                skippedGroups++;
            }
        }

        // Move inactive modifier options to deleted
        console.log('\n⚙️  MOVING INACTIVE MODIFIER OPTIONS TO DELETED...');
        
        // Find inactive options that are not already deleted
        const inactiveOptions = await db(pool, 
            `SELECT o.id, o.name, g.name as group_name 
             FROM modifier_options o 
             JOIN modifier_groups g ON g.id = o.group_id
             WHERE o.tenant_id = $1 
               AND o.deleted_at IS NULL 
               AND (o.is_active = false OR o.is_active IS NULL)
             ORDER BY g.name, o.name`,
            [DEFAULT_TENANT_ID]
        );

        console.log(`📋 Found ${inactiveOptions.length} inactive options to move...`);

        for (const option of inactiveOptions) {
            try {
                // Mark as deleted with current timestamp
                const result = await db(pool, 
                    'UPDATE modifier_options SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2',
                    [option.id, DEFAULT_TENANT_ID]
                );
                
                if (result.rowCount > 0) {
                    console.log(`✅ Moved option to deleted: ${option.name} (${option.group_name})`);
                    movedOptions++;
                }
            } catch (error) {
                console.log(`❌ Error processing option ${option.name}:`, error.message);
                skippedOptions++;
            }
        }

        // Also move inactive products to deleted (if any exist)
        console.log('\n📦 MOVING INACTIVE PRODUCTS TO DELETED...');
        
        const inactiveProducts = await db(pool, 
            `SELECT id, name 
             FROM products 
             WHERE tenant_id = $1 
               AND deleted_at IS NULL 
               AND (active = false OR active IS NULL)
             ORDER BY name`,
            [DEFAULT_TENANT_ID]
        );

        console.log(`📋 Found ${inactiveProducts.length} inactive products to move...`);

        let movedProducts = 0;
        for (const product of inactiveProducts) {
            try {
                // Mark as deleted with current timestamp
                const result = await db(pool, 
                    'UPDATE products SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2',
                    [product.id, DEFAULT_TENANT_ID]
                );
                
                if (result.rowCount > 0) {
                    console.log(`✅ Moved product to deleted: ${product.name}`);
                    movedProducts++;
                }
            } catch (error) {
                console.log(`❌ Error processing product ${product.name}:`, error.message);
            }
        }

        // Final summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 MOVE INACTIVE ITEMS TO DELETED SUMMARY');
        console.log('='.repeat(80));
        console.log(`🏷️  Modifier Groups:`);
        console.log(`   ✅ Moved to deleted: ${movedGroups}`);
        console.log(`   ⏭️  Skipped: ${skippedGroups}`);
        console.log(`⚙️  Modifier Options:`);
        console.log(`   ✅ Moved to deleted: ${movedOptions}`);
        console.log(`   ⏭️  Skipped: ${skippedOptions}`);
        console.log(`📦 Products:`);
        console.log(`   ✅ Moved to deleted: ${movedProducts}`);
        console.log('='.repeat(80));

        const totalMoved = movedGroups + movedOptions + movedProducts;
        if (totalMoved > 0) {
            console.log(`\n🎉 Successfully moved ${totalMoved} inactive items to deleted status!`);
            console.log('💡 You can now see these items in the "Deleted" tab in your admin interface.');
            console.log('💡 The "All" tab will still show everything, while "Deleted" will show only deleted items.');
        } else {
            console.log('\n📝 No inactive items found to move to deleted status.');
        }

    } catch (error) {
        console.error('💥 Move operation failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the move operation if this script is executed directly
if (require.main === module) {
    moveInactiveToDeleted().catch(error => {
        console.error('💥 Move operation failed:', error);
        process.exit(1);
    });
}

module.exports = { moveInactiveToDeleted };