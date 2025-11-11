#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe

async function importCustomers() {
  try {
    console.log('📦 Loading customers from customers_sample_50.json...');
    const customers = JSON.parse(fs.readFileSync('customers_sample_50.json', 'utf8'));
    console.log(`✅ Loaded ${customers.length} customers\n`);
    
    console.log('💾 Importing to foodics_customers table...');
    
    let imported = 0;
    let skipped = 0;
    
    for (const customer of customers) {
      try {
        await pool.query(`
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
        
        imported++;
      } catch (err) {
        console.error(`Error importing customer ${customer.id}:`, err.message);
      }
    }
    
    console.log(`\n✅ Import complete!`);
    console.log(`   Imported/Updated: ${imported} customers\n`);
    
    // Show sample
    const result = await pool.query(`
      SELECT 
        id, 
        name, 
        phone,
        order_count,
        loyalty_balance,
        created_at
      FROM foodics_customers 
      WHERE tenant_id = $1 
      ORDER BY order_count DESC, name ASC
      LIMIT 15
    `, [TENANT_ID]);
    
    console.log('📊 Sample of imported customers:');
    console.log('─'.repeat(80));
    result.rows.forEach(row => {
      const phone = row.phone || 'N/A';
      console.log(`  ${row.name.padEnd(25)} | ${phone.padEnd(12)} | Orders: ${String(row.order_count).padStart(3)} | Loyalty: ${row.loyalty_balance}`);
    });
    
    // Show stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE order_count > 0) as customers_with_orders,
        SUM(order_count) as total_orders,
        AVG(order_count) as avg_orders_per_customer,
        COUNT(*) FILTER (WHERE is_loyalty_enabled) as loyalty_enabled
      FROM foodics_customers 
      WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    console.log('\n📈 Customer Statistics:');
    console.log('─'.repeat(80));
    const s = stats.rows[0];
    console.log(`  Total Customers:          ${s.total_customers}`);
    console.log(`  With Orders:              ${s.customers_with_orders}`);
    console.log(`  Total Orders:             ${s.total_orders}`);
    console.log(`  Avg Orders/Customer:      ${parseFloat(s.avg_orders_per_customer || 0).toFixed(2)}`);
    console.log(`  Loyalty Enabled:          ${s.loyalty_enabled}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importCustomers();
