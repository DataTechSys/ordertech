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
const BATCH_SIZE = parseInt(process.argv[2]) || 100; // How many orders to process

async function importOrderItems() {
  try {
    console.log(`🚀 Importing order items for ${BATCH_SIZE} orders\n`);
    
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    // Get orders that don't have items imported yet
    const ordersResult = await pool.query(`
      SELECT o.id, o.number, o.business_date
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
    
    let totalItems = 0;
    let ordersProcessed = 0;
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
          console.log('⚠️  Rate limit hit, waiting 2 seconds...');
          await new Promise(r => setTimeout(r, 2000));
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
        
        if (ordersProcessed % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`   ✅ Progress: ${ordersProcessed} orders, ${totalItems} items (${elapsed}s)`);
        }
        
        // Rate limit: 50ms between requests
        await new Promise(r => setTimeout(r, 50));
        
      } catch (err) {
        console.error(`   ❌ Error processing order ${order.id}:`, err.message);
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n═'.repeat(60));
    console.log('📊 Import Complete!');
    console.log('═'.repeat(60));
    console.log(`  Orders processed: ${ordersProcessed}`);
    console.log(`  Items imported:   ${totalItems}`);
    console.log(`  Time:             ${totalTime}s`);
    console.log(`  Rate:             ${(ordersProcessed / totalTime).toFixed(1)} orders/sec`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

importOrderItems();
