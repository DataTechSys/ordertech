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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillBranchData() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Backfill Branch Data - ${new Date().toISOString()}\n`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    if (!result.rows[0]?.token) {
      throw new Error('Foodics API token not found');
    }
    
    const token = result.rows[0].token;
    
    // Find orders with type but no branch_name in meta (only in our date range)
    const ordersNeedingBranch = await pool.query(`
      SELECT id, reference, created_at, type
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND type IS NOT NULL
        AND (meta->>'branch_name' IS NULL OR meta->>'branch_name' = '')
        AND status = 4
        AND business_date >= '2025-10-31'
        AND business_date <= '2025-11-10'
      ORDER BY created_at DESC
    `);
    
    const total = ordersNeedingBranch.rows.length;
    console.log(`📊 Found ${total} orders needing branch data\n`);
    
    if (total === 0) {
      console.log('✅ All orders already have branch data!');
      return;
    }
    
    let updated = 0;
    let failed = 0;
    let errors = [];
    
    for (let i = 0; i < ordersNeedingBranch.rows.length; i++) {
      const order = ordersNeedingBranch.rows[i];
      
      try {
        // Fetch full order data with branch from Foodics API
        const response = await fetch(
          `https://api.foodics.com/v5/orders/${order.id}?include=branch`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (response.status !== 200) {
          console.log(`⚠️  Order ${order.reference}: API returned ${response.status}`);
          failed++;
          errors.push({ ref: order.reference, error: `HTTP ${response.status}` });
          continue;
        }
        
        const data = await response.json();
        const fullOrder = data.data;
        
        if (!fullOrder.branch) {
          console.log(`⚠️  Order ${order.reference}: No branch in API response`);
          failed++;
          errors.push({ ref: order.reference, error: 'No branch in response' });
          continue;
        }
        
        // Update meta with branch info
        await pool.query(`
          UPDATE saas.foodics_orders
          SET meta = jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(meta, '{}'::jsonb),
                '{branch_name}',
                $1::jsonb
              ),
              '{branch_id}',
              $2::jsonb
            ),
            '{branch_reference}',
            $3::jsonb
          )
          WHERE id = $4
        `, [
          JSON.stringify(fullOrder.branch.name),
          JSON.stringify(fullOrder.branch.id),
          JSON.stringify(fullOrder.branch.reference),
          order.id
        ]);
        
        updated++;
        
        if ((i + 1) % 10 === 0) {
          const progress = ((i + 1) / total * 100).toFixed(1);
          console.log(`📍 Progress: ${i + 1}/${total} (${progress}%) - ${updated} updated, ${failed} failed`);
        }
        
        // Rate limiting: 300ms between requests
        await sleep(300);
        
      } catch (error) {
        console.error(`❌ Order ${order.reference}: ${error.message}`);
        failed++;
        errors.push({ ref: order.reference, error: error.message });
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📊 Total orders processed: ${total}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors:');
      errors.slice(0, 10).forEach(e => {
        console.log(`   Order ${e.ref}: ${e.error}`);
      });
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more`);
      }
    }
    
    // Verify the fix
    console.log('\n📊 Verification:');
    const check = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN type IS NOT NULL AND meta->>'branch_name' IS NOT NULL THEN 1 ELSE 0 END) as with_both,
        SUM(CASE WHEN type IS NOT NULL AND (meta->>'branch_name' IS NULL OR meta->>'branch_name' = '') THEN 1 ELSE 0 END) as type_only,
        SUM(CASE WHEN type IS NULL AND meta->>'branch_name' IS NOT NULL THEN 1 ELSE 0 END) as branch_only
      FROM saas.foodics_orders
      WHERE tenant_id = (SELECT tenant_id FROM saas.tenants WHERE foodics_id = '494675')
        AND status = 4
        AND business_date >= '2025-10-31'
        AND business_date <= '2025-11-10'
    `);
    
    const stats = check.rows[0];
    console.log(`   Total orders (Oct 31 - Nov 10): ${stats.total}`);
    console.log(`   ✅ With both type AND branch: ${stats.with_both} (${(stats.with_both / stats.total * 100).toFixed(1)}%)`);
    console.log(`   ⚠️  Type only (no branch): ${stats.type_only} (${(stats.type_only / stats.total * 100).toFixed(1)}%)`);
    console.log(`   ⚠️  Branch only (no type): ${stats.branch_only} (${(stats.branch_only / stats.total * 100).toFixed(1)}%)`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

backfillBranchData();
