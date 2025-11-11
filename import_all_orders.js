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

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe
const MAX_PAGES = parseInt(process.argv[2]) || 500; // Get up to 50,000 orders

async function importAllOrders() {
  try {
    console.log(`🚀 Importing ALL orders for Koobs Cafe (up to ${MAX_PAGES} pages)\n`);
    
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    let page = 1;
    let totalFetched = 0;
    let totalImported = 0;
    let totalSkipped = 0;
    const perPage = 100;
    
    const startTime = Date.now();
    
    while (page <= MAX_PAGES) {
      console.log(`📦 Page ${page}...`);
      
      const response = await fetch(
        `https://api.foodics.com/v5/orders?per_page=${perPage}&page=${page}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        console.log('✅ No more orders\n');
        break;
      }
      
      const orders = data.data;
      totalFetched += orders.length;
      
      // Import all orders
      for (const order of orders) {
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
          
          if (res.rowCount > 0) totalImported++;
          else totalSkipped++;
        } catch (err) {
          console.error(`   ❌ Error: ${err.message}`);
        }
      }
      
      if (page % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`   ✅ Progress: ${totalImported} imported, ${totalSkipped} skipped (${elapsed}s)\n`);
      }
      
      // Check pagination
      if (data.meta && data.meta.current_page >= data.meta.last_page) {
        console.log('✅ Reached last page\n');
        break;
      }
      
      page++;
      await new Promise(r => setTimeout(r, 50)); // Rate limit
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('═'.repeat(80));
    console.log('📊 Import Complete!');
    console.log('═'.repeat(80));
    console.log(`  Fetched:      ${totalFetched} orders`);
    console.log(`  Imported:     ${totalImported} new`);
    console.log(`  Skipped:      ${totalSkipped} duplicates`);
    console.log(`  Time:         ${totalTime}s`);
    console.log(`  Rate:         ${(totalFetched / totalTime).toFixed(1)} orders/sec`);
    
    // Stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        MIN(business_date) as earliest,
        MAX(business_date) as latest,
        SUM(total_price) as revenue,
        AVG(total_price) as avg_order,
        COUNT(DISTINCT business_date) as days,
        COUNT(*) FILTER (WHERE business_date >= CURRENT_DATE - INTERVAL '30 days') as last_30_days,
        COUNT(*) FILTER (WHERE business_date >= CURRENT_DATE - INTERVAL '90 days') as last_90_days
      FROM foodics_orders WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    console.log('\n📈 Database Statistics:');
    console.log('─'.repeat(80));
    const s = stats.rows[0];
    console.log(`  Total Orders:         ${s.total}`);
    console.log(`  Date Range:           ${s.earliest} to ${s.latest}`);
    console.log(`  Total Revenue:        ${parseFloat(s.revenue || 0).toFixed(3)} KWD`);
    console.log(`  Avg Order Value:      ${parseFloat(s.avg_order || 0).toFixed(3)} KWD`);
    console.log(`  Days with Orders:     ${s.days}`);
    console.log(`  Last 30 days:         ${s.last_30_days} orders`);
    console.log(`  Last 90 days:         ${s.last_90_days} orders`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

importAllOrders();
