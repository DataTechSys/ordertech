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
const BATCH_SIZE = parseInt(process.argv[2]) || 50; // Default 50 orders per sync

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncNewOrders() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Foodics Sync - ${new Date().toISOString()}`);
    console.log(`📦 Batch size: ${BATCH_SIZE} orders\n`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // Get the latest order reference we have
    const latestOrder = await pool.query(`
      SELECT reference, business_date, created_at
      FROM saas.foodics_orders
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [TENANT_ID]);
    
    const lastRef = latestOrder.rows[0]?.reference || '0';
    const lastDate = latestOrder.rows[0]?.created_at || new Date('2025-10-01');
    
    console.log(`📍 Last order in DB: ref=${lastRef}, date=${lastDate}\n`);
    
    // Fetch new orders from Foodics (page 1 only, most recent orders)
    const response = await fetch(
      `https://api.foodics.com/v5/orders?per_page=${BATCH_SIZE}&page=1`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (response.status !== 200) {
      console.log(`⚠️  API returned ${response.status}: ${response.statusText}`);
      await pool.end();
      return;
    }
    
    const data = await response.json();
    const orders = data.data || [];
    
    console.log(`📥 Fetched ${orders.length} most recent orders from Foodics\n`);
    
    let newOrders = 0;
    let newItems = 0;
    let skippedOrders = 0;
    
    for (const order of orders) {
      try {
        // Check if order already exists
        const exists = await pool.query(
          `SELECT id FROM saas.foodics_orders WHERE tenant_id = $1 AND reference = $2`,
          [TENANT_ID, order.reference?.toString()]
        );
        
        if (exists.rows.length > 0) {
          skippedOrders++;
          continue; // Already have this order
        }
        
        // Insert new order
        const orderResult = await pool.query(`
          INSERT INTO saas.foodics_orders (
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
          ON CONFLICT (tenant_id, reference) DO NOTHING
          RETURNING id
        `, [
          TENANT_ID, order.id, order.app_id, order.promotion_id, order.discount_type, order.reference_x,
          order.number, order.type, order.source, order.status, order.delivery_status, order.guests,
          order.kitchen_notes, order.customer_notes, order.business_date,
          order.subtotal_price, order.discount_amount, order.rounding_amount, order.total_price,
          order.tax_exclusive_discount_amount, order.delay_in_seconds,
          order.opened_at, order.accepted_at, order.due_at, order.driver_assigned_at,
          order.dispatched_at, order.driver_collected_at, order.delivered_at, order.closed_at,
          order.created_at, order.updated_at, order.reference?.toString(), order.check_number,
          JSON.stringify(order.meta)
        ]);
        
        if (orderResult.rows.length === 0) {
          skippedOrders++;
          continue;
        }
        
        newOrders++;
        
        // Fetch order details to get order_items
        await sleep(100); // Small delay between requests
        
        const detailsResponse = await fetch(
          `https://api.foodics.com/v5/orders/${order.id}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (detailsResponse.status === 200) {
          const orderDetails = await detailsResponse.json();
          const items = orderDetails.data?.order_items || [];
          
          // Import order items
          for (const item of items) {
            const productResult = await pool.query(
              `SELECT id FROM saas.foodics_products WHERE tenant_id = $1 AND sku = $2 LIMIT 1`,
              [TENANT_ID, item.product?.sku]
            );
            
            const productId = productResult.rows[0]?.id || null;
            
            await pool.query(`
              INSERT INTO saas.foodics_order_items (
                tenant_id, id, order_id, product_id,
                quantity, unit_price, price, total_price, discount_amount, tax_amount,
                product_name, product_sku, notes, meta,
                created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
              )
              ON CONFLICT (tenant_id, id) DO NOTHING
            `, [
              TENANT_ID,
              item.id,
              order.id,
              productId,
              item.quantity,
              item.unit_price,
              item.price,
              item.total_price,
              item.discount_amount,
              item.tax_amount,
              item.product?.name || null,
              item.product?.sku || null,
              item.notes,
              JSON.stringify(item),
              item.created_at,
              item.updated_at
            ]);
            
            newItems++;
          }
        }
        
      } catch (err) {
        console.error(`   ❌ Error on order ${order.reference}:`, err.message);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Sync Complete!');
    console.log('═'.repeat(50));
    console.log(`  New orders:     ${newOrders}`);
    console.log(`  New items:      ${newItems}`);
    console.log(`  Skipped:        ${skippedOrders} (already in DB)`);
    console.log(`  Time:           ${elapsed}s`);
    console.log(`  Next sync:      5 minutes\n`);
    
  } catch (error) {
    console.error('❌ Sync error:', error.message);
  } finally {
    await pool.end();
  }
}

syncNewOrders();
