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
const MAX_PAGES = parseInt(process.argv[2]) || 37200; // All pages

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importAllOrders() {
  try {
    console.log(`🚀 Importing ALL orders with items for Koobs Cafe (up to ${MAX_PAGES} pages)\n`);
    
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    const token = result.rows[0].token;
    
    let page = 1;
    let totalOrdersImported = 0;
    let totalOrdersSkipped = 0;
    let totalItemsImported = 0;
    const perPage = 100;
    
    const startTime = Date.now();
    
    while (page <= MAX_PAGES) {
      console.log(`📦 Page ${page}...`);
      
      let response;
      let retries = 0;
      
      // Retry on rate limit
      while (retries < 5) {
        response = await fetch(
          `https://api.foodics.com/v5/orders?per_page=${perPage}&page=${page}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (response.status === 429) {
          const waitTime = Math.pow(2, retries) * 5000; // Exponential backoff: 5s, 10s, 20s, 40s, 80s
          console.log(`   ⚠️  Rate limit (429), waiting ${waitTime/1000}s...`);
          await sleep(waitTime);
          retries++;
          continue;
        }
        
        break;
      }
      
      if (response.status !== 200) {
        console.log(`   ❌ Error: ${response.status} ${response.statusText}`);
        break;
      }
      
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        console.log('✅ No more orders\n');
        break;
      }
      
      const orders = data.data;
      
      // Import each order and fetch its items
      for (const order of orders) {
        try {
          // Import order
          const res = await pool.query(`
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
            ON CONFLICT (tenant_id, id) DO NOTHING
            RETURNING id
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
          
          const isNewOrder = res.rowCount > 0;
          if (isNewOrder) {
            totalOrdersImported++;
            
            // Fetch order details to get order_items
            let detailsRetries = 0;
            let orderDetails = null;
            
            while (detailsRetries < 3) {
              const detailsResponse = await fetch(
                `https://api.foodics.com/v5/orders/${order.id}`,
                {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                  }
                }
              );
              
              if (detailsResponse.status === 429) {
                console.log(`   ⚠️  Rate limit on order details, waiting 5s...`);
                await sleep(5000);
                detailsRetries++;
                continue;
              }
              
              if (detailsResponse.status === 200) {
                orderDetails = await detailsResponse.json();
                break;
              }
              
              break;
            }
            
            // Import order items
            if (orderDetails && orderDetails.data && orderDetails.data.order_items) {
              const items = orderDetails.data.order_items;
              for (const item of items) {
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
                totalItemsImported++;
              }
            }
            
            await sleep(100); // 100ms delay between order detail fetches
          } else {
            totalOrdersSkipped++;
          }
        } catch (err) {
          console.error(`   ❌ Error on order ${order.id}: ${err.message}`);
        }
      }
      
      if (page % 5 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`   ✅ Progress: ${totalOrdersImported} orders, ${totalItemsImported} items, ${totalOrdersSkipped} skipped (${elapsed}s)\n`);
      }
      
      // Check pagination
      if (data.meta && data.meta.current_page >= data.meta.last_page) {
        console.log('✅ Reached last page\n');
        break;
      }
      
      page++;
      await sleep(200); // 200ms between pages
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('═'.repeat(80));
    console.log('📊 Import Complete!');
    console.log('═'.repeat(80));
    console.log(`  Orders imported:  ${totalOrdersImported}`);
    console.log(`  Orders skipped:   ${totalOrdersSkipped}`);
    console.log(`  Items imported:   ${totalItemsImported}`);
    console.log(`  Time:             ${totalTime}s`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importAllOrders();
