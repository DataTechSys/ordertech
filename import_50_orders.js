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

async function importOrders() {
  try {
    console.log('📦 Loading orders from orders_sample_50.json...');
    const orders = JSON.parse(fs.readFileSync('orders_sample_50.json', 'utf8'));
    console.log(`✅ Loaded ${orders.length} orders\n`);
    
    console.log('💾 Importing to foodics_orders table...');
    
    let imported = 0;
    let skipped = 0;
    
    for (const order of orders) {
      try {
        await pool.query(`
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
        
        imported++;
      } catch (err) {
        if (err.code === '23505') { // Unique violation
          skipped++;
        } else {
          console.error(`Error importing order ${order.id}:`, err.message);
        }
      }
    }
    
    console.log(`\n✅ Import complete!`);
    console.log(`   Imported: ${imported} orders`);
    console.log(`   Skipped: ${skipped} (already exist)\n`);
    
    // Show sample
    const result = await pool.query(`
      SELECT 
        id, 
        business_date, 
        total_price, 
        status,
        type,
        created_at
      FROM foodics_orders 
      WHERE tenant_id = $1 
      ORDER BY business_date DESC 
      LIMIT 10
    `, [TENANT_ID]);
    
    console.log('📊 Sample of imported orders:');
    console.log('─'.repeat(80));
    result.rows.forEach(row => {
      console.log(`  ${row.business_date} | ${String(row.total_price).padStart(7)} KWD | Status: ${row.status} | Type: ${row.type}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importOrders();
