#!/usr/bin/env node

// Debug script to test modifiers API response

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

async function debugModifiersApi() {
    console.log('🔍 Testing modifiers API queries...\n');

    const pool = createDbPool();
    
    try {
        // Simulate the API query for groups
        console.log('📊 MODIFIER GROUPS API QUERY:');
        const groupsRows = await pool.query(`
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

        console.log(`Total groups: ${groupsRows.rows.length}`);
        
        const deletedGroups = groupsRows.rows.filter(g => g.deleted_at);
        const activeGroups = groupsRows.rows.filter(g => !g.deleted_at);
        
        console.log(`Active groups: ${activeGroups.length}`);
        console.log(`Deleted groups: ${deletedGroups.length}`);
        
        if (deletedGroups.length > 0) {
            console.log('\n🗑️  DELETED GROUPS:');
            deletedGroups.forEach(g => {
                console.log(`   - ${g.name} | deleted_at: ${g.deleted_at} | external_id: ${g.external_id || 'NULL'}`);
            });
        }

        // Test options API query
        console.log('\n⚙️  MODIFIER OPTIONS API QUERY:');
        const optionsRows = await pool.query(`
            select o.id, o.tenant_id, o.group_id, g.name as group_name, 
                   g.reference as group_reference, o.name, o.name_localized, o.reference, 
                   o.external_id, o.tax_group_reference, o.costing_method, o.price, 
                   o.is_active, o.sort_order, o.created_at, o.deleted_at 
            from modifier_options o 
            join modifier_groups g on g.id=o.group_id 
            where o.tenant_id=$1
            order by g.name asc, coalesce(o.sort_order, 999999) asc, o.name asc`, [DEFAULT_TENANT_ID]);

        console.log(`Total options: ${optionsRows.rows.length}`);
        
        const deletedOptions = optionsRows.rows.filter(o => o.deleted_at);
        const activeOptions = optionsRows.rows.filter(o => !o.deleted_at);
        
        console.log(`Active options: ${activeOptions.length}`);
        console.log(`Deleted options: ${deletedOptions.length}`);
        
        if (deletedOptions.length > 0) {
            console.log('\n🗑️  DELETED OPTIONS:');
            deletedOptions.forEach(o => {
                console.log(`   - ${o.name} | group: ${o.group_name} | deleted_at: ${o.deleted_at} | external_id: ${o.external_id || 'NULL'}`);
            });
        }

        // Sample a few active items to verify external_id
        console.log('\n📝 SAMPLE ACTIVE GROUPS WITH EXTERNAL_ID:');
        const samplesWithExternal = activeGroups.filter(g => g.external_id).slice(0, 3);
        samplesWithExternal.forEach(g => {
            console.log(`   - ${g.name} | external_id: ${g.external_id}`);
        });

    } catch (error) {
        console.error('💥 Debug operation failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the debug operation
if (require.main === module) {
    debugModifiersApi().catch(error => {
        console.error('💥 Debug operation failed:', error);
        process.exit(1);
    });
}

module.exports = { debugModifiersApi };