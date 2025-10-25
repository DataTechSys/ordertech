#!/usr/bin/env node

// Script to re-sync Foodics modifier groups with proper deleted_at filtering
// This will update existing groups and skip deleted ones from Foodics

const { Pool } = require('pg');
const { makeClient } = require('../server/integrations/foodics.js');
const fs = require('fs');
const path = require('path');

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

async function resyncModifierGroups() {
    console.log('🔄 Re-syncing Foodics modifier groups with deleted_at filtering...\n');

    const pool = new Pool({
        host: '127.0.0.1',
        port: 6555,
        user: 'ordertech', 
        database: 'ordertech',
        ssl: false
    });

    const client = makeClient(FOODICS_TOKEN);
    
    try {
        // Get koobs tenant ID
        const tenants = await pool.query(`
            SELECT id, name FROM tenants 
            WHERE name ILIKE '%koobs%' 
            LIMIT 1
        `);
        
        if (!tenants.rows.length) {
            console.error('❌ Koobs tenant not found');
            return;
        }
        
        const tenantId = tenants.rows[0].id;
        console.log(`🏢 Found tenant: ${tenants.rows[0].name} (${tenantId})\n`);

        // Get current groups from database
        const currentGroups = await pool.query(`
            SELECT id, name, external_id, deleted_at 
            FROM modifier_groups 
            WHERE tenant_id = $1
        `, [tenantId]);
        
        console.log(`📊 Current groups in database: ${currentGroups.rows.length}`);

        // Fetch fresh data from Foodics
        const foodicsGroups = await client.listModifierGroups();
        console.log(`📊 Groups from Foodics: ${foodicsGroups.items.length}`);

        let activeCount = 0;
        let deletedCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;

        // Process each group from Foodics
        for (const g of foodicsGroups.items) {
            const name = g.name || '';
            const deleted_at = g.deleted_at ? new Date(g.deleted_at) : null;
            const is_ready = g.is_ready != null ? !!g.is_ready : true;
            
            if (deleted_at || !is_ready) {
                console.log(`❌ Skipping: ${name} (deleted_at: ${deleted_at}, is_ready: ${is_ready})`);
                skippedCount++;
                continue;
            }
            
            activeCount++;
            
            // Update the group to ensure deleted_at is NULL for active groups
            try {
                await pool.query(`
                    UPDATE modifier_groups 
                    SET deleted_at = NULL 
                    WHERE tenant_id = $1 
                    AND name = $2
                `, [tenantId, name]);
                updatedCount++;
            } catch (error) {
                console.log(`⚠️ Could not update group: ${name}`);
            }
        }

        // Now mark groups as deleted if they exist locally but are deleted in Foodics
        const foodicsActiveNames = new Set(
            foodicsGroups.items
                .filter(g => !g.deleted_at && (g.is_ready !== false))
                .map(g => g.name)
        );

        const localGroupsToDelete = currentGroups.rows.filter(row => 
            row.deleted_at === null && !foodicsActiveNames.has(row.name)
        );

        for (const group of localGroupsToDelete) {
            console.log(`🗑️ Marking as deleted: ${group.name}`);
            await pool.query(`
                UPDATE modifier_groups 
                SET deleted_at = NOW() 
                WHERE id = $1
            `, [group.id]);
            deletedCount++;
        }

        console.log('\n📈 Summary:');
        console.log(`   - Active groups from Foodics: ${activeCount}`);
        console.log(`   - Deleted/inactive groups skipped: ${skippedCount}`);
        console.log(`   - Local groups updated: ${updatedCount}`);
        console.log(`   - Local groups marked as deleted: ${deletedCount}`);
        
        console.log('\n✅ Re-sync completed! The product edit page should now show fewer, cleaner groups.');

    } catch (error) {
        console.error('💥 Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

resyncModifierGroups();