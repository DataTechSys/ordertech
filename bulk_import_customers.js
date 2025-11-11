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
const MAX_PAGES = parseInt(process.argv[2]) || 50; // Safety limit

async function bulkImportCustomers() {
  try {
    console.log(`🚀 Bulk Import: ALL customers for Koobs Cafe\n`);
    
    // Get token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    console.log(`🔒 Max Pages: ${MAX_PAGES}\n`);
    
    let page = 1;
    let totalFetched = 0;
    let totalImported = 0;
    let totalUpdated = 0;
    const perPage = 100;
    
    while (page <= MAX_PAGES) {
      console.log(`👥 Fetching page ${page}...`);
      
      const response = await fetch(
        `https://api.foodics.com/v5/customers?per_page=${perPage}&page=${page}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        console.log('✅ No more customers to fetch\n');
        break;
      }
      
      const customers = data.data;
      totalFetched += customers.length;
      
      console.log(`   Got ${customers.length} customers`);
      
      // Import customers
      for (const customer of customers) {
        try {
          const res = await pool.query(`
            INSERT INTO foodics_customers (
              tenant_id, id, name, phone, dial_code, email, gender, birth_date, notes,
              order_count, house_account_balance, house_account_limit, loyalty_balance,
              is_blacklisted, is_house_account_enabled, is_loyalty_enabled,
              last_order_at, deleted_at, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
            ON CONFLICT (tenant_id, id) DO UPDATE SET
              name = EXCLUDED.name,
              phone = EXCLUDED.phone,
              dial_code = EXCLUDED.dial_code,
              email = EXCLUDED.email,
              order_count = EXCLUDED.order_count,
              house_account_balance = EXCLUDED.house_account_balance,
              loyalty_balance = EXCLUDED.loyalty_balance,
              last_order_at = EXCLUDED.last_order_at,
              updated_at = EXCLUDED.updated_at,
              synced_at = NOW()
          `, [
            TENANT_ID,
            customer.id,
            customer.name,
            customer.phone,
            customer.dial_code,
            customer.email,
            customer.gender,
            customer.birth_date,
            customer.notes,
            customer.order_count,
            customer.house_account_balance,
            customer.house_account_limit,
            customer.loyalty_balance,
            customer.is_blacklisted,
            customer.is_house_account_enabled,
            customer.is_loyalty_enabled,
            customer.last_order_at,
            customer.deleted_at,
            customer.created_at,
            customer.updated_at
          ]);
          
          if (res.rowCount > 0) {
            totalImported++;
          } else {
            totalUpdated++;
          }
        } catch (err) {
          console.error(`   ❌ Error importing customer ${customer.id}:`, err.message);
        }
      }
      
      console.log(`   ✅ Imported: ${totalImported}, Updated: ${totalUpdated}\n`);
      
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
    console.log(`  Total Fetched:    ${totalFetched} customers`);
    console.log(`  Imported:         ${totalImported} new customers`);
    console.log(`  Updated:          ${totalUpdated} existing customers`);
    console.log(`  Pages Processed:  ${page - 1}`);
    
    // Show stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE order_count > 0) as customers_with_orders,
        SUM(order_count) as total_orders,
        AVG(order_count) as avg_orders_per_customer,
        COUNT(*) FILTER (WHERE is_loyalty_enabled) as loyalty_enabled,
        COUNT(*) FILTER (WHERE email IS NOT NULL) as with_email,
        COUNT(*) FILTER (WHERE phone IS NOT NULL) as with_phone
      FROM foodics_customers 
      WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    console.log('\n📈 Database Statistics:');
    console.log('─'.repeat(80));
    const s = stats.rows[0];
    console.log(`  Total Customers:      ${s.total_customers}`);
    console.log(`  With Orders:          ${s.customers_with_orders}`);
    console.log(`  Total Orders:         ${s.total_orders}`);
    console.log(`  Avg Orders/Customer:  ${parseFloat(s.avg_orders_per_customer || 0).toFixed(2)}`);
    console.log(`  Loyalty Enabled:      ${s.loyalty_enabled}`);
    console.log(`  With Email:           ${s.with_email}`);
    console.log(`  With Phone:           ${s.with_phone}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

console.log('Usage: node bulk_import_customers.js [MAX_PAGES]');
console.log('Example: node bulk_import_customers.js 50  (max 50 pages = 5000 customers)\n');

bulkImportCustomers();
