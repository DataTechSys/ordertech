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
const DELAY_MS = 10000; // 10 seconds between requests
const BATCH_SIZE = parseInt(process.argv[2]) || 1000; // How many orders to process

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importOrderItems() {
  try {
    console.log(`🌙 Overnight Import - Processing ${BATCH_SIZE} orders`);
    console.log(`⏱️  Rate: 1 order every ${DELAY_MS/1000} seconds\n`);
    
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // Get orders that don't have items imported yet (most recent first)
    const ordersResult = await pool.query(`
      SELECT o.id, o.number, o.business_date, o.total_price
      FROM saas.foodics_orders o
      WHERE o.tenant_id = $1
        AND o.status = 4
        AND NOT EXISTS (
          SELECT 1 FROM saas.foodics_order_items oi 
          WHERE oi.order_id = o.id AND oi.tenant_id = $1
        )
      ORDER BY o.business_date DESC
      LIMIT $2
    `, [TENANT_ID, BATCH_SIZE]);
    
    console.log(`📦 Found ${ordersResult.rows.length} orders without items\n`);
    
    if (ordersResult.rows.length === 0) {
      console.log('✅ All orders already have items imported!');
      await pool.end();
      return;
    }
    
    let totalItems = 0;
    let ordersProcessed = 0;
    let errors = 0;
    const startTime = Date.now();
    
    for (const order of ordersResult.rows) {
      try {
        // Fetch order details from API
        const response = await fetch(
          `https://api.foodics.com/v5/orders/${order.id}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (response.status === 429) {
          console.log(`⚠️  Rate limit hit at order ${ordersProcessed + 1}, stopping...`);
          break;
        }
        
        if (response.status !== 200) {
          console.log(`   ⚠️  Order ${order.number}: ${response.status} ${response.statusText}`);
          errors++;
          await sleep(DELAY_MS);
          continue;
        }
        
        const data = await response.json();
        const orderItems = data.data?.order_items || [];
        
        // Import order items
        for (const item of orderItems) {
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
            item.product_id,
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
        }
        
        totalItems += orderItems.length;
        ordersProcessed++;
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const eta = ((ordersResult.rows.length - ordersProcessed) * DELAY_MS / 1000 / 60).toFixed(1);
        
        if (ordersProcessed % 10 === 0) {
          console.log(`   ✅ Progress: ${ordersProcessed}/${ordersResult.rows.length} orders, ${totalItems} items (${elapsed}s, ETA: ${eta} min)`);
        }
        
        // Wait before next request
        await sleep(DELAY_MS);
        
      } catch (err) {
        console.error(`   ❌ Error on order ${order.id}: ${err.message}`);
        errors++;
        await sleep(DELAY_MS);
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalMinutes = (totalTime / 60).toFixed(1);
    
    console.log('\n' + '═'.repeat(60));
    console.log('📊 Import Session Complete!');
    console.log('═'.repeat(60));
    console.log(`  Orders processed: ${ordersProcessed}/${ordersResult.rows.length}`);
    console.log(`  Items imported:   ${totalItems}`);
    console.log(`  Errors:           ${errors}`);
    console.log(`  Time:             ${totalMinutes} minutes`);
    console.log(`  Remaining:        ${ordersResult.rows.length - ordersProcessed} orders`);
    
    // Check total progress
    const totalResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM saas.foodics_order_items oi 
          WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id
        )) as with_items,
        COUNT(*) as total
      FROM saas.foodics_orders o
      WHERE o.tenant_id = $1 AND o.status = 4
    `, [TENANT_ID]);
    
    const stats = totalResult.rows[0];
    const percentage = ((stats.with_items / stats.total) * 100).toFixed(1);
    
    console.log(`\n📈 Overall Progress: ${stats.with_items}/${stats.total} orders (${percentage}%)`);
    
    if (ordersProcessed < ordersResult.rows.length) {
      console.log('\n💡 Run again to continue importing more orders');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importOrderItems();
