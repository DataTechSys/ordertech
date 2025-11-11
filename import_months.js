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

async function importMonths() {
  try {
    console.log('🚀 Importing orders for Nov, Oct, Sep 2025\n');
    
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    const months = [
      { name: 'November 2025', from: '2025-11-01', to: '2025-11-30' },
      { name: 'October 2025', from: '2025-10-01', to: '2025-10-31' },
      { name: 'September 2025', from: '2025-09-01', to: '2025-09-30' }
    ];
    
    let grandTotal = { fetched: 0, imported: 0, skipped: 0, revenue: 0 };
    const startTime = Date.now();
    
    for (const month of months) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📅 ${month.name} (${month.from} to ${month.to})`);
      console.log('='.repeat(80));
      
      let page = 1;
      let monthFetched = 0;
      let monthImported = 0;
      let monthSkipped = 0;
      let monthRevenue = 0;
      
      while (page <= 200) { // Max 200 pages per month = 20,000 orders
        const response = await fetch(
          `https://api.foodics.com/v5/orders?per_page=100&page=${page}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        const data = await response.json();
        
        if (!data.data || data.data.length === 0) break;
        
        const orders = data.data;
        
        // Filter by month date range
        const filtered = orders.filter(o => {
          if (!o.business_date) return false;
          return o.business_date >= month.from && o.business_date <= month.to;
        });
        
        if (filtered.length === 0) {
          // Check if we've passed this month
          const lastDate = orders[orders.length - 1]?.business_date;
          if (lastDate && lastDate < month.from) {
            break; // Stop, we're past this month
          }
        }
        
        monthFetched += filtered.length;
        
        // Import orders
        for (const order of filtered) {
          try {
            const res = await pool.query(`
              INSERT INTO foodics_orders (
                tenant_id, id, app_id, promotion_id, discount_type, reference_x,
                number, type, source, status, delivery_status, guests,
                kitchen_notes, customer_notes, business_date,
                subtotal_price, discount_amount, rounding_amount, total_price,
                tax_exclusive_discount_amount, delay_in_seconds,
                opened_at, accepted_at, due_at, driver_assigned_at,
                dispatched_at, driver_collected_at, delivered_at, closed_at,
                created_at, updated_at, reference, check_number, meta
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
                $29, $30, $31, $32, $33, $34
              )
              ON CONFLICT (tenant_id, id) DO NOTHING
            `, [
              TENANT_ID, order.id, order.app_id, order.promotion_id, order.discount_type, order.reference_x,
              order.number, order.type, order.source, order.status, order.delivery_status, order.guests,
              order.kitchen_notes, order.customer_notes, order.business_date,
              order.subtotal_price, order.discount_amount, order.rounding_amount, order.total_price,
              order.tax_exclusive_discount_amount, order.delay_in_seconds,
              order.opened_at, order.accepted_at, order.due_at, order.driver_assigned_at,
              order.dispatched_at, order.driver_collected_at, order.delivered_at, order.closed_at,
              order.created_at, order.updated_at, order.reference, order.check_number,
              JSON.stringify(order.meta)
            ]);
            
            if (res.rowCount > 0) {
              monthImported++;
              monthRevenue += parseFloat(order.total_price || 0);
            } else {
              monthSkipped++;
            }
          } catch (err) {
            // Ignore duplicates
          }
        }
        
        if (page % 10 === 0) {
          console.log(`   Page ${page}: ${monthImported} imported so far...`);
        }
        
        page++;
        await new Promise(r => setTimeout(r, 50));
      }
      
      console.log(`\n✅ ${month.name}:`);
      console.log(`   Fetched:  ${monthFetched} orders`);
      console.log(`   Imported: ${monthImported} new`);
      console.log(`   Skipped:  ${monthSkipped} duplicates`);
      console.log(`   Revenue:  ${monthRevenue.toFixed(3)} KWD`);
      
      grandTotal.fetched += monthFetched;
      grandTotal.imported += monthImported;
      grandTotal.skipped += monthSkipped;
      grandTotal.revenue += monthRevenue;
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log('📊 TOTAL SUMMARY');
    console.log('═'.repeat(80));
    console.log(`  Fetched:      ${grandTotal.fetched} orders`);
    console.log(`  Imported:     ${grandTotal.imported} new`);
    console.log(`  Skipped:      ${grandTotal.skipped} duplicates`);
    console.log(`  Revenue:      ${grandTotal.revenue.toFixed(3)} KWD`);
    console.log(`  Time:         ${totalTime}s`);
    
    // Final database stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        MIN(business_date) as earliest,
        MAX(business_date) as latest,
        SUM(total_price) as revenue,
        COUNT(*) FILTER (WHERE business_date >= '2025-09-01') as last_3_months
      FROM foodics_orders WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    console.log('\n📈 Database Statistics:');
    console.log('─'.repeat(80));
    const s = stats.rows[0];
    console.log(`  Total Orders in DB:   ${s.total}`);
    console.log(`  Date Range:           ${s.earliest} to ${s.latest}`);
    console.log(`  Total Revenue:        ${parseFloat(s.revenue || 0).toFixed(3)} KWD`);
    console.log(`  Last 3 Months:        ${s.last_3_months} orders`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importMonths();
