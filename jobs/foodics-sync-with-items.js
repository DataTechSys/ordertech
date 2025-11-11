#!/usr/bin/env node
// Cloud Run Job: Sync Foodics orders WITH items using include=products
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe
const BATCH_SIZE = 50;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncOrdersWithItems() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Foodics Sync (with items) started - ${new Date().toISOString()}`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    if (!result.rows[0]?.token) {
      throw new Error('Foodics API token not found');
    }
    
    const token = result.rows[0].token;
    
    // Get the latest order we have
    const latestOrder = await pool.query(`
      SELECT reference, business_date, created_at
      FROM saas.foodics_orders
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [TENANT_ID]);
    
    const lastDate = latestOrder.rows[0]?.created_at || new Date('2025-10-01');
    
    console.log(`📍 Last order in DB: date=${lastDate}`);
    
    let newOrders = 0;
    let newItems = 0;
    let updatedOrders = 0;
    let skippedOrders = 0;
    let errors = [];
    let allOrders = [];
    let page = 1;
    let foundExisting = false;
    const MAX_PAGES = 20; // Safety limit
    
    console.log(`📥 Fetching recent orders with items (newest first)...`);
    
    // Fetch multiple pages until we find orders we already have
    while (page <= MAX_PAGES && !foundExisting) {
      console.log(`   Page ${page}...`);
      
      const response = await fetch(
        `https://api.foodics.com/v5/orders?per_page=${BATCH_SIZE}&page=${page}&sort=-created_at&include=products.product,branch`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.status !== 200) {
        console.error(`⚠️  API returned ${response.status}: ${response.statusText}`);
        if (page === 1) {
          throw new Error(`Foodics API error: ${response.status} ${response.statusText}`);
        }
        break;
      }
      
      const data = await response.json();
      const orders = data.data || [];
      
      if (orders.length === 0) {
        console.log(`📭 No more orders on page ${page}`);
        break;
      }
      
      console.log(`   Found ${orders.length} orders`);
      
      // Check if any orders in this page already exist
      let existingInPage = 0;
      for (const order of orders) {
        const exists = await pool.query(
          `SELECT id FROM saas.foodics_orders WHERE tenant_id = $1 AND reference = $2`,
          [TENANT_ID, order.reference?.toString()]
        );
        if (exists.rows.length > 0) {
          existingInPage++;
        }
      }
      
      console.log(`   ${existingInPage} already in DB`);
      
      allOrders.push(...orders);
      
      // If more than 80% of this page exists, we've caught up
      if (existingInPage >= orders.length * 0.8) {
        foundExisting = true;
        console.log(`✓ Caught up with existing orders`);
      }
      
      page++;
      
      if (page <= MAX_PAGES && !foundExisting) {
        await sleep(200); // Rate limit between pages
      }
    }
    
    console.log(`📦 Total fetched: ${allOrders.length} orders from ${page - 1} pages\n`);
    
    // Now process all orders
    for (const order of allOrders) {
      try {
        // Check if order already exists
        const existsResult = await pool.query(
          `SELECT id FROM saas.foodics_orders WHERE tenant_id = $1 AND reference = $2`,
          [TENANT_ID, order.reference?.toString()]
        );
        
        const orderExists = existsResult.rows.length > 0;
        
        // Update existing orders with branch data if missing
        if (orderExists && order.branch) {
          await pool.query(`
            UPDATE saas.foodics_orders
            SET meta = jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(meta, '{}'::jsonb),
                  '{branch_name}',
                  $1::jsonb
                ),
                '{branch_id}',
                $2::jsonb
              ),
              '{branch_reference}',
              $3::jsonb
            )
            WHERE tenant_id = $4 AND id = $5
              AND (meta->>'branch_name' IS NULL OR meta->>'branch_name' = '')
          `, [
            JSON.stringify(order.branch.name),
            JSON.stringify(order.branch.id),
            JSON.stringify(order.branch.reference),
            TENANT_ID,
            order.id
          ]);
        }
        
        if (!orderExists) {
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
            JSON.stringify({ 
              ...order.meta,
              branch_name: order.branch?.name || null,
              branch_id: order.branch?.id || null,
              branch_reference: order.branch?.reference || null
            })
          ]);
          
          if (orderResult.rows.length > 0) {
            newOrders++;
          } else {
            skippedOrders++;
            continue;
          }
        }
        
        // Process order items (products array from API)
        const products = order.products || [];
        
        if (products.length > 0) {
          for (const item of products) {
            try {
              // Extract product info from nested product object (API: include=products.product)
              const product = item.product;
              
              let productId = product?.id || null;
              let productName = product?.name || null;
              let productSku = product?.sku || null;
              
              if (!productId) {
                console.log(`   ⚠️  Item ${item.id} has no product`);
                continue;
              }
              
              await pool.query(`
                INSERT INTO saas.foodics_order_items (
                  tenant_id, id, order_id, product_id,
                  quantity, unit_price, total_price, discount_amount,
                  product_name, product_sku, notes, meta,
                  created_at, updated_at
                ) VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
                )
                ON CONFLICT (tenant_id, id) DO NOTHING
              `, [
                TENANT_ID,
                item.id,
                order.id,
                productId,
                item.quantity,
                item.unit_price,
                item.total_price,
                item.discount_amount,
                productName,
                productSku,
                item.kitchen_notes,
                JSON.stringify(item),
                item.added_at,
                item.closed_at
              ]);
              
              newItems++;
            } catch (itemErr) {
              console.error(`     Error on item ${item.id}:`, itemErr.message);
            }
          }
          
          if (orderExists) {
            updatedOrders++;
          }
        }
        
      } catch (err) {
        console.error(`❌ Error on order ${order.reference}:`, err.message);
        errors.push({ order: order.reference, error: err.message });
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Sync Complete!');
    console.log('═'.repeat(50));
    console.log(`  New orders:       ${newOrders}`);
    console.log(`  Updated orders:   ${updatedOrders} (added items)`);
    console.log(`  New items:        ${newItems}`);
    console.log(`  Skipped:          ${skippedOrders} (already in DB)`);
    console.log(`  Errors:           ${errors.length}`);
    console.log(`  Duration:         ${elapsed}s`);
    console.log('');
    
    if (errors.length > 0 && errors.length <= 10) {
      console.log('Errors:');
      errors.forEach(e => console.log(`  ${e.order}: ${e.error}`));
    }
    
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

// Run the sync
syncOrdersWithItems();
