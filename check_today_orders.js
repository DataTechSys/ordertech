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

async function checkToday() {
  try {
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Checking for orders on: ${today}\n`);
    
    // Try with business_date filter
    const response = await fetch(
      `https://api.foodics.com/v5/orders?per_page=50&page=1&filter[business_date]=${today}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      console.log(`✅ Found ${data.data.length} orders for TODAY (${today})!\n`);
      
      let totalRevenue = 0;
      data.data.forEach((o, i) => {
        console.log(`  ${i+1}. Ref: ${o.reference} | ${o.total_price} KWD | Status: ${o.status} | Created: ${o.created_at}`);
        totalRevenue += parseFloat(o.total_price || 0);
      });
      
      console.log(`\n💰 Total Revenue Today: ${totalRevenue.toFixed(3)} KWD`);
      
      // Now import them
      console.log('\n💾 Importing to database...');
      let imported = 0;
      
      for (const order of data.data) {
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
            'f8578f9c-782b-4d31-b04f-3b2d890c5896',
            order.id, order.app_id, order.promotion_id, order.discount_type, order.reference_x,
            order.number, order.type, order.source, order.status, order.delivery_status, order.guests,
            order.kitchen_notes, order.customer_notes, order.business_date,
            order.subtotal_price, order.discount_amount, order.rounding_amount, order.total_price,
            order.tax_exclusive_discount_amount, order.delay_in_seconds,
            order.opened_at, order.accepted_at, order.due_at, order.driver_assigned_at,
            order.dispatched_at, order.driver_collected_at, order.delivered_at, order.closed_at,
            order.created_at, order.updated_at, order.reference, order.check_number,
            JSON.stringify(order.meta)
          ]);
          
          if (res.rowCount > 0) imported++;
        } catch (err) {
          console.error(`Error importing order ${order.id}:`, err.message);
        }
      }
      
      console.log(`✅ Imported ${imported} new orders\n`);
    } else {
      console.log(`❌ No orders found for ${today}`);
      console.log('\nLet me check the latest orders in Foodics...\n');
      
      const response2 = await fetch(
        'https://api.foodics.com/v5/orders?per_page=5&page=1',
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const data2 = await response2.json();
      console.log('Latest 5 orders in Foodics:');
      data2.data.forEach((o, i) => {
        console.log(`  ${i+1}. Date: ${o.business_date} | ${o.total_price} KWD | Ref: ${o.reference}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkToday();
