#!/usr/bin/env node

// Script to debug actual API response structure

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
        ssl: false
    });
    
    return pool;
}

async function debugApiResponse() {
    console.log('🔍 Debugging API response structure...\n');

    const pool = createDbPool();
    
    try {
        // Simulate the exact API query that the web frontend calls
        console.log('📡 SIMULATING API CALL: /admin/tenants/{id}/modifiers/groups');
        
        const rows = await pool.query(`
      select mg.id,
             mg.tenant_id,
             mg.name,
             mg.name_localized,
             mg.reference,
             mg.external_id,
             mg.min_select,
             mg.max_select,
             mg.required,
             mg.created_at,
             mg.deleted_at,
             coalesce(o.cnt,0) as options_count,
             coalesce(p.cnt,0) as products_count
        from modifier_groups mg
   left join (
             select group_id, count(*)::int as cnt
               from modifier_options
              where tenant_id=$1
              group by group_id
             ) o on o.group_id=mg.id
   left join (
             select group_id, count(*)::int as cnt
               from product_modifier_groups
              group by group_id
             ) p on p.group_id=mg.id
       where mg.tenant_id=$1
       order by mg.name asc`, [DEFAULT_TENANT_ID]);

        const items = rows.rows;
        
        console.log(`✅ API Response Structure:`);
        console.log(`   Total items: ${items.length}`);
        console.log(`   Response format: { items: [...] }\n`);
        
        // Show first few items with full structure
        console.log('📋 FIRST 3 ITEMS (showing full structure):');
        items.slice(0, 3).forEach((item, index) => {
            console.log(`\n${index + 1}. ${item.name}:`);
            console.log(`   - id: ${item.id}`);
            console.log(`   - name: ${item.name}`);
            console.log(`   - deleted_at: ${item.deleted_at || 'NULL'}`);
            console.log(`   - deleted_at type: ${typeof item.deleted_at}`);
            console.log(`   - !!deleted_at: ${!!item.deleted_at}`);
            console.log(`   - reference: ${item.reference || 'NULL'}`);
            console.log(`   - external_id: ${item.external_id || 'NULL'}`);
            console.log(`   - options_count: ${item.options_count}`);
        });
        
        // Show deleted items specifically
        console.log('\n🗑️  DELETED ITEMS (deleted_at is not null):');
        const deletedItems = items.filter(item => item.deleted_at);
        console.log(`   Count: ${deletedItems.length}`);
        
        deletedItems.forEach((item, index) => {
            console.log(`\n${index + 1}. ${item.name}:`);
            console.log(`   - deleted_at: ${item.deleted_at}`);
            console.log(`   - deleted_at (raw): ${JSON.stringify(item.deleted_at)}`);
            console.log(`   - typeof deleted_at: ${typeof item.deleted_at}`);
            console.log(`   - Boolean(deleted_at): ${Boolean(item.deleted_at)}`);
            console.log(`   - !!deleted_at: ${!!item.deleted_at}`);
        });
        
        // Test the JavaScript filtering logic that the frontend uses
        console.log('\n🔍 TESTING FRONTEND FILTERING LOGIC:');
        const filteredForDeleted = items.filter(g => g.deleted_at);
        console.log(`   JavaScript filter result: ${filteredForDeleted.length} items`);
        console.log(`   Names: ${filteredForDeleted.map(g => g.name).join(', ')}`);
        
        // Show what the actual API response would look like
        console.log('\n📦 SIMULATED API RESPONSE JSON:');
        console.log(JSON.stringify({ 
            items: items.map(item => ({
                id: item.id,
                name: item.name,
                deleted_at: item.deleted_at,
                reference: item.reference,
                external_id: item.external_id,
                options_count: item.options_count,
                products_count: item.products_count
            }))
        }, null, 2));

    } catch (error) {
        console.error('💥 Debug operation failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the debug operation
if (require.main === module) {
    debugApiResponse().catch(error => {
        console.error('💥 Debug operation failed:', error);
        process.exit(1);
    });
}

module.exports = { debugApiResponse };