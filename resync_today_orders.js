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

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resyncTodayOrders() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Re-syncing Today's Orders - ${new Date().toISOString()}\n`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // Get today's orders that need branch data
    const ordersNeedingBranch = await pool.query(`
      SELECT id, reference, created_at, type
      FROM saas.foodics_orders
      WHERE tenant_id = $1
        AND business_date = '2025-11-10'
        AND status = 4
        AND (meta->>'branch_name' IS NULL OR meta->>'branch_name' = '')
      ORDER BY created_at DESC
    `, [TENANT_ID]);
    
    const total = ordersNeedingBranch.rows.length;
    console.log(`📊 Found ${total} orders from today needing branch data\n`);
    
    if (total === 0) {
      console.log('✅ All orders already have branch data!');
      return;
    }
    
    let updated = 0;
    let notFound = 0;
    let noBranch = 0;
    let failed = 0;
    
    console.log('Starting updates...\n');
    
    for (let i = 0; i < ordersNeedingBranch.rows.length; i++) {
      const order = ordersNeedingBranch.rows[i];
      
      try {
        // Fetch full order with branch from Foodics API
        const response = await fetch(
          `https://api.foodics.com/v5/orders/${order.id}?include=branch`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (response.status === 404) {
          notFound++;
          continue;
        }
        
        if (response.status !== 200) {
          console.log(`⚠️  Order ${order.reference}: HTTP ${response.status}`);
          failed++;
          await sleep(200);
          continue;
        }
        
        const data = await response.json();
        const fullOrder = data.data;
        
        if (!fullOrder.branch) {
          noBranch++;
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
        
        if ((i + 1) % 20 === 0 || (i + 1) === total) {
          const progress = ((i + 1) / total * 100).toFixed(1);
          console.log(`📍 Progress: ${i + 1}/${total} (${progress}%) - ✅ ${updated} updated, ⚠️  ${noBranch} no branch, ❌ ${failed} failed`);
        }
        
        // Rate limiting: 150ms between requests
        await sleep(150);
        
      } catch (error) {
        console.error(`❌ Order ${order.reference}: ${error.message}`);
        failed++;
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ RE-SYNC COMPLETE');
    console.log('='.repeat(70));
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📊 Total orders processed: ${total}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`⚠️  No branch in API: ${noBranch}`);
    console.log(`❌ Failed: ${failed}`);
    
    // Verify results
    console.log('\n📊 Verification for Today (Nov 10):');
    const check = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN meta->>'branch_name' IS NOT NULL AND meta->>'branch_name' != '' THEN 1 ELSE 0 END) as with_branch,
        SUM(CASE WHEN type IS NOT NULL THEN 1 ELSE 0 END) as with_type
      FROM saas.foodics_orders
      WHERE tenant_id = $1
        AND status = 4
        AND business_date = '2025-11-10'
    `, [TENANT_ID]);
    
    const stats = check.rows[0];
    console.log(`   Total orders: ${stats.total}`);
    console.log(`   ✅ With branch: ${stats.with_branch} (${(stats.with_branch / stats.total * 100).toFixed(1)}%)`);
    console.log(`   ✅ With type: ${stats.with_type} (${(stats.with_type / stats.total * 100).toFixed(1)}%)`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

resyncTodayOrders();
