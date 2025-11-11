#!/usr/bin/env node
const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function verify() {
  try {
    console.log('🔍 Verifying Branch Data Fix\n');
    
    // Overall stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN type IS NOT NULL THEN 1 ELSE 0 END) as with_type,
        SUM(CASE WHEN meta->>'branch_name' IS NOT NULL AND meta->>'branch_name' != '' THEN 1 ELSE 0 END) as with_branch,
        SUM(CASE WHEN type IS NOT NULL AND (meta->>'branch_name' IS NOT NULL AND meta->>'branch_name' != '') THEN 1 ELSE 0 END) as with_both,
        SUM(CASE WHEN type IS NOT NULL AND (meta->>'branch_name' IS NULL OR meta->>'branch_name' = '') THEN 1 ELSE 0 END) as type_only
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND status = 4
        AND business_date >= '2025-10-31'
        AND business_date <= '2025-11-10'
    `);
    
    const s = stats.rows[0];
    console.log('📊 Overall Statistics (Oct 31 - Nov 10):');
    console.log('─'.repeat(60));
    console.log(`Total orders:                    ${s.total}`);
    console.log(`Orders with type:                ${s.with_type} (${(s.with_type / s.total * 100).toFixed(1)}%)`);
    console.log(`Orders with branch_name:         ${s.with_branch} (${(s.with_branch / s.total * 100).toFixed(1)}%)`);
    console.log(`Orders with BOTH type & branch:  ${s.with_both} (${(s.with_both / s.total * 100).toFixed(1)}%)`);
    console.log(`Orders with type ONLY:           ${s.type_only} (${(s.type_only / s.total * 100).toFixed(1)}%)`);
    
    // Most recent orders
    console.log('\n\n🆕 Recent Orders (last 10):');
    console.log('─'.repeat(60));
    
    const recent = await pool.query(`
      SELECT 
        reference,
        type,
        meta->>'branch_name' as branch_name,
        total_price,
        created_at
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    recent.rows.forEach(r => {
      const typeStr = r.type ? `Type: ${r.type}` : 'Type: NULL';
      const branchStr = r.branch_name || 'Branch: NULL';
      console.log(`  ${r.reference} | ${typeStr.padEnd(10)} | ${branchStr.padEnd(30)} | ${r.total_price} KWD`);
    });
    
    // By order type and branch
    console.log('\n\n📈 Order Types by Branch (with both fields):');
    console.log('─'.repeat(60));
    
    const breakdown = await pool.query(`
      SELECT 
        TRIM(split_part(meta->>'branch_name',' | ',2)) as branch,
        type,
        COUNT(*) as count,
        SUM(total_price) as total_sales
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND status = 4
        AND type IS NOT NULL
        AND meta->>'branch_name' IS NOT NULL
        AND business_date >= '2025-10-31'
        AND business_date <= '2025-11-10'
      GROUP BY TRIM(split_part(meta->>'branch_name',' | ',2)), type
      ORDER BY branch, type
    `);
    
    console.log(`Found ${breakdown.rows.length} branch+type combinations\n`);
    
    let currentBranch = null;
    breakdown.rows.forEach(r => {
      if (r.branch !== currentBranch) {
        console.log(`\n${r.branch || 'Unknown'}:`);
        currentBranch = r.branch;
      }
      const typeName = ['', 'Dine-in', 'Pickup', 'Delivery', 'Drive-thru'][r.type] || 'Unknown';
      console.log(`  ${typeName.padEnd(12)} ${r.count.toString().padStart(4)} orders  ${r.total_sales} KWD`);
    });
    
    console.log('\n✅ Verification complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

verify();
