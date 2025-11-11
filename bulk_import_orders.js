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

// Get days from command line (default 30)
const DAYS_TO_IMPORT = parseInt(process.argv[2]) || 30;
const MAX_PAGES = parseInt(process.argv[3]) || 100; // Safety limit

async function bulkImportOrders() {
  try {
    console.log(`🚀 Bulk Import: Last ${DAYS_TO_IMPORT} days of orders for Koobs Cafe\n`);
    
    // Get token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - DAYS_TO_IMPORT);
    
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];
    
    console.log(`📅 Date Range: ${fromStr} to ${toStr}`);
    console.log(`🔒 Max Pages: ${MAX_PAGES}\n`);
    
    let page = 1;
    let totalFetched = 0;
    let totalImported = 0;
    let totalSkipped = 0;
    const perPage = 100;
    
    while (page <= MAX_PAGES) {
      console.log(`📦 Fetching page ${page}...`);
      
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
        console.log('✅ No more orders to fetch\n');
        break;
      }
      
      const orders = data.data;
      totalFetched += orders.length;
      
      console.log(`   Got ${orders.length} orders`);
      
      // Filter by date range
      const filtered = orders.filter(o => {
        if (!o.business_date) return false;
        return o.business_date >= fromStr && o.business_date <= toStr;
      });
      
      console.log(`   Filtered: ${filtered.length} in date range`);
      
      // Import in batches
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
            TENANT_ID,
            order.id,
            order.app_id,
            order.promotion_id,
            order.discount_type,
            order.reference_x,
            order.number,
            order.type,
            order.source,
            order.status,
            order.delivery_status,
            order.guests,
            order.kitchen_notes,
            order.customer_notes,
            order.business_date,
            order.subtotal_price,
            order.discount_amount,
            order.rounding_amount,
            order.total_price,
            order.tax_exclusive_discount_amount,
            order.delay_in_seconds,
            order.opened_at,
            order.accepted_at,
            order.due_at,
            order.driver_assigned_at,
            order.dispatched_at,
            order.driver_collected_at,
            order.delivered_at,
            order.closed_at,
            order.created_at,
            order.updated_at,
            order.reference,
            order.check_number,
            JSON.stringify(order.meta)
          ]);
          
          if (res.rowCount > 0) {
            totalImported++;
          } else {
            totalSkipped++;
          }
        } catch (err) {
          console.error(`   ❌ Error importing order ${order.id}:`, err.message);
        }
      }
      
      console.log(`   ✅ Imported: ${totalImported}, Skipped: ${totalSkipped}\n`);
      
      // Check if we should continue
      const oldestDate = orders[orders.length - 1]?.business_date;
      if (oldestDate && oldestDate < fromStr) {
        console.log(`✅ Reached orders before ${fromStr}, stopping\n`);
        break;
      }
      
      // Check pagination
      if (data.meta && data.meta.current_page >= data.meta.last_page) {
        console.log('✅ Reached last page\n');
        break;
      }
      
      page++;
      
      // Rate limiting - wait 100ms between pages
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log('═'.repeat(80));
    console.log('📊 Import Summary:');
    console.log('═'.repeat(80));
    console.log(`  Total Fetched:    ${totalFetched} orders`);
    console.log(`  Imported:         ${totalImported} new orders`);
    console.log(`  Skipped:          ${totalSkipped} (already exist)`);
    console.log(`  Pages Processed:  ${page - 1}`);
    
    // Show stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        MIN(business_date) as earliest_date,
        MAX(business_date) as latest_date,
        SUM(total_price) as total_revenue,
        AVG(total_price) as avg_order_value,
        COUNT(DISTINCT business_date) as days_with_orders
      FROM foodics_orders 
      WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    console.log('\n📈 Database Statistics:');
    console.log('─'.repeat(80));
    const s = stats.rows[0];
    console.log(`  Total Orders in DB:   ${s.total_orders}`);
    console.log(`  Date Range:           ${s.earliest_date} to ${s.latest_date}`);
    console.log(`  Total Revenue:        ${parseFloat(s.total_revenue || 0).toFixed(3)} KWD`);
    console.log(`  Avg Order Value:      ${parseFloat(s.avg_order_value || 0).toFixed(3)} KWD`);
    console.log(`  Days with Orders:     ${s.days_with_orders}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

console.log('Usage: node bulk_import_orders.js [DAYS] [MAX_PAGES]');
console.log('Example: node bulk_import_orders.js 30 100  (import last 30 days, max 100 pages)\n');

bulkImportOrders();
