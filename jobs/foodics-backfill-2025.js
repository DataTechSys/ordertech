#!/usr/bin/env node
// Cloud Run Job: Backfill 2025 Foodics orders slowly
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe
const FOODICS_ID = '494675';
const BATCH_SIZE = 50;
const DELAY_BETWEEN_PAGES = 2000; // 2 seconds between pages (slow sync)
const DELAY_BETWEEN_ITEMS = 150; // 150ms between item fetches

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillOrders() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Foodics 2025 Backfill Job started - ${new Date().toISOString()}`);
    console.log(`⏱️  Running slowly: ${DELAY_BETWEEN_PAGES}ms between pages, ${DELAY_BETWEEN_ITEMS}ms between items`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = $1`,
      [FOODICS_ID]
    );
    
    if (!result.rows[0]?.token) {
      throw new Error('Foodics API token not found');
    }
    
    const token = result.rows[0].token;
    
    // Define date range for 2025
    const startDate = '2025-01-01';
    const endDate = new Date().toISOString().split('T')[0]; // Today
    
    console.log(`📅 Date range: ${startDate} to ${endDate}\n`);
    
    let totalOrders = 0;
    let newOrders = 0;
    let skippedOrders = 0;
    let totalItems = 0;
    let errors = [];
    let page = 1;
    let hasMore = true;
    
    // Fetch all pages slowly
    while (hasMore) {
      const pageStartTime = Date.now();
      console.log(`\n📄 Fetching page ${page}...`);
      
      try {
        const response = await fetch(
          `https://api.foodics.com/v5/orders?per_page=${BATCH_SIZE}&page=${page}&sort=created_at&include=branch`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (response.status === 429) {
          console.log('⏸️  Rate limited, waiting 10 seconds...');
          await sleep(10000);
          continue; // Retry same page
        }
        
        if (response.status !== 200) {
          console.error(`⚠️  API returned ${response.status}: ${response.statusText}`);
          errors.push(`Page ${page}: ${response.status} ${response.statusText}`);
          break;
        }
        
        const data = await response.json();
        const orders = data.data || [];
        
        if (orders.length === 0) {
          console.log(`📭 No more orders on page ${page}`);
          hasMore = false;
          break;
        }
        
        console.log(`   Found ${orders.length} orders`);
        totalOrders += orders.length;
        
        // Filter orders by date range
        const ordersInRange = orders.filter(order => {
          const orderDate = order.created_at?.split('T')[0];
          return orderDate >= startDate && orderDate <= endDate;
        });
        
        console.log(`   ${ordersInRange.length} in 2025 date range`);
        
        // If no orders in range, we've gone past 2025
        if (ordersInRange.length === 0 && orders[0]?.created_at > endDate) {
          console.log(`✓ Reached end of 2025 orders`);
          hasMore = false;
          break;
        }
        
        // Process each order
        for (const order of ordersInRange) {
          try {
            // Check if order already exists
            const exists = await pool.query(
              `SELECT id FROM saas.foodics_orders WHERE tenant_id = $1 AND reference = $2`,
              [TENANT_ID, order.reference?.toString()]
            );
            
            if (exists.rows.length > 0) {
              skippedOrders++;
              continue;
            }
            
            // Insert new order with branch data
            const metaWithBranch = {
              ...order.meta,
              branch_name: order.branch?.name || null,
              branch_id: order.branch?.id || null,
              branch_reference: order.branch?.reference || null
            };
            
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
              JSON.stringify(metaWithBranch)
            ]);
            
            if (orderResult.rows.length === 0) {
              skippedOrders++;
              continue;
            }
            
            newOrders++;
            
            // Fetch order items
            await sleep(DELAY_BETWEEN_ITEMS);
            
            const itemsResponse = await fetch(
              `https://api.foodics.com/v5/orders/${order.id}/order-items`,
              {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Accept': 'application/json'
                }
              }
            );
            
            if (itemsResponse.status === 200) {
              const itemsData = await itemsResponse.json();
              const items = itemsData.data || [];
              
              // Import order items
              for (const item of items) {
                try {
                  // Get or create product
                  const productResult = await pool.query(`
                    INSERT INTO saas.foodics_products (
                      tenant_id, id, name, name_localized, description, description_localized,
                      image, is_active, is_stock_product, is_ready, preparation_time, price,
                      cost, calories, sku, barcode
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                    ON CONFLICT (tenant_id, id) 
                    DO UPDATE SET 
                      name = EXCLUDED.name,
                      price = EXCLUDED.price,
                      cost = EXCLUDED.cost
                    RETURNING id
                  `, [
                    TENANT_ID, item.product_id, item.product_name, item.product_name_localized,
                    null, null, null, true, false, true, null,
                    item.unit_price, null, null, item.product_sku, item.product_barcode
                  ]);
                  
                  // Insert order item
                  await pool.query(`
                    INSERT INTO saas.foodics_order_items (
                      tenant_id, id, order_id, product_id, option_id, tax_id,
                      quantity, unit_price, total_price, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (tenant_id, id) DO NOTHING
                  `, [
                    TENANT_ID, item.id, order.id, item.product_id, item.option_id, item.tax_id,
                    item.quantity, item.unit_price, item.total_price, item.notes
                  ]);
                  
                  totalItems++;
                } catch (itemErr) {
                  console.error(`   ⚠️  Error inserting item ${item.id}: ${itemErr.message}`);
                  errors.push(`Item ${item.id}: ${itemErr.message}`);
                }
              }
            } else if (itemsResponse.status === 429) {
              console.log('   ⏸️  Rate limited on items, waiting...');
              await sleep(5000);
            }
            
          } catch (orderErr) {
            console.error(`   ⚠️  Error processing order ${order.reference}: ${orderErr.message}`);
            errors.push(`Order ${order.reference}: ${orderErr.message}`);
          }
        }
        
        const pageDuration = Date.now() - pageStartTime;
        console.log(`   ✓ Page ${page} completed in ${(pageDuration / 1000).toFixed(1)}s`);
        console.log(`   Stats: ${newOrders} new, ${skippedOrders} skipped, ${totalItems} items`);
        
        page++;
        
        // Check if we have more pages
        const meta = data.meta;
        if (!meta || page > meta.last_page) {
          hasMore = false;
        }
        
        // Wait before next page
        if (hasMore) {
          console.log(`   ⏸️  Waiting ${DELAY_BETWEEN_PAGES / 1000}s before next page...`);
          await sleep(DELAY_BETWEEN_PAGES);
        }
        
      } catch (pageErr) {
        console.error(`❌ Error on page ${page}: ${pageErr.message}`);
        errors.push(`Page ${page}: ${pageErr.message}`);
        break;
      }
    }
    
    const duration = (Date.now() - startTime) / 1000;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Backfill completed in ${(duration / 60).toFixed(1)} minutes`);
    console.log(`📊 Summary:`);
    console.log(`   Total orders fetched: ${totalOrders}`);
    console.log(`   New orders imported: ${newOrders}`);
    console.log(`   Skipped (existing): ${skippedOrders}`);
    console.log(`   Order items imported: ${totalItems}`);
    console.log(`   Pages processed: ${page - 1}`);
    
    if (errors.length > 0) {
      console.log(`\n⚠️  Errors (${errors.length}):`);
      errors.slice(0, 10).forEach(err => console.log(`   - ${err}`));
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more`);
      }
    }
    
  } catch (err) {
    console.error(`❌ Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the backfill
backfillOrders();
