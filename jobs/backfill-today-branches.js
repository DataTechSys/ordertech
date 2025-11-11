#!/usr/bin/env node
// Cloud Run Job: Backfill today's orders with branch data
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
const BATCH_SIZE = 50;
const MAX_PAGES = 200; // Fetch up to 10,000 orders (entire month)

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillTodayBranches() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Backfill Today's Branches - ${new Date().toISOString()}`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // Backfill entire November 2025
    const startDate = '2025-11-01';
    const endDate = '2025-11-30';
    console.log(`📅 Target period: ${startDate} to ${endDate}\n`);
    
    let allOrders = [];
    let page = 1;
    
    // Fetch ALL recent orders (don't stop early)
    console.log(`📥 Fetching all recent orders...`);
    while (page <= MAX_PAGES) {
      console.log(`   Page ${page}/${MAX_PAGES}...`);
      
      const response = await fetch(
        `https://api.foodics.com/v5/orders?per_page=${BATCH_SIZE}&page=${page}&sort=-created_at&include=branch`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.status !== 200) {
        console.error(`⚠️  API returned ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const orders = data.data || [];
      
      if (orders.length === 0) {
        console.log(`📭 No more orders`);
        break;
      }
      
      // Filter for orders in target period
      const periodOrders = orders.filter(o => o.business_date >= startDate && o.business_date <= endDate);
      allOrders.push(...periodOrders);
      
      console.log(`   Found ${orders.length} orders, ${periodOrders.length} in period`);
      
      // If this page has no period orders, we've gone too far back
      if (periodOrders.length === 0) {
        console.log(`✓ No more orders in period`);
        break;
      }
      
      page++;
      await sleep(200);
    }
    
    console.log(`\n📦 Total orders fetched in period: ${allOrders.length}\n`);
    
    let updated = 0;
    let noBranch = 0;
    let alreadyHad = 0;
    
    // Update all orders with branch data
    for (const order of allOrders) {
      try {
        if (!order.branch) {
          noBranch++;
          continue;
        }
        
        // Check if already has branch
        const check = await pool.query(
          `SELECT meta->>'branch_name' as branch FROM saas.foodics_orders 
           WHERE tenant_id = $1 AND id = $2`,
          [TENANT_ID, order.id]
        );
        
        if (check.rows[0]?.branch) {
          alreadyHad++;
          continue;
        }
        
        // Update with branch data
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
          WHERE tenant_id = $4 AND id = $5
        `, [
          JSON.stringify(order.branch.name),
          JSON.stringify(order.branch.id),
          JSON.stringify(order.branch.reference),
          TENANT_ID,
          order.id
        ]);
        
        updated++;
        
        if (updated % 50 === 0) {
          console.log(`📍 ${updated} updated so far...`);
        }
        
      } catch (err) {
        console.error(`❌ Error on order ${order.reference}:`, err.message);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(60));
    console.log('✅ Backfill Complete!');
    console.log('═'.repeat(60));
    console.log(`  Orders fetched:       ${allOrders.length}`);
    console.log(`  ✅ Updated:           ${updated}`);
    console.log(`  ⏭️  Already had branch: ${alreadyHad}`);
    console.log(`  ⚠️  No branch in API:  ${noBranch}`);
    console.log(`  Duration:             ${elapsed}s`);
    
    // Verify
    const verify = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN meta->>'branch_name' IS NOT NULL THEN 1 ELSE 0 END) as with_branch
      FROM saas.foodics_orders
      WHERE tenant_id = $1 AND business_date >= $2 AND business_date <= $3 AND status = 4
    `, [TENANT_ID, startDate, endDate]);
    
    const stats = verify.rows[0];
    console.log(`\n📊 Verification (${startDate} to ${endDate}):`);
    console.log(`  Total orders: ${stats.total}`);
    console.log(`  With branch: ${stats.with_branch} (${(stats.with_branch / stats.total * 100).toFixed(1)}%)`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

backfillTodayBranches();
