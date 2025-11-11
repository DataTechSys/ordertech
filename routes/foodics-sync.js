const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// DB config from environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : (process.env.DB_HOST || '127.0.0.1'),
  port: process.env.DATABASE_URL ? undefined : (process.env.DB_PORT || 5432),
  database: process.env.DATABASE_URL ? undefined : (process.env.DB_NAME || 'ordertech'),
  user: process.env.DATABASE_URL ? undefined : (process.env.DB_USER || 'ordertech'),
  password: process.env.DATABASE_URL ? undefined : process.env.DB_PASSWORD,
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe
const BATCH_SIZE = 50;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POST /api/foodics/sync
 * Trigger Foodics order sync manually or via Cloud Scheduler
 */
router.post('/sync', async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Foodics Sync started - ${new Date().toISOString()}`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    if (!result.rows[0]?.token) {
      return res.status(500).json({ error: 'Foodics API token not found' });
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
    
    const lastRef = latestOrder.rows[0]?.reference || '0';
    const lastDate = latestOrder.rows[0]?.created_at || new Date('2025-10-01');
    
    console.log(`📍 Last order in DB: ref=${lastRef}, date=${lastDate}`);
    
    let newOrders = 0;
    let newItems = 0;
    let skippedOrders = 0;
    let errors = [];
    let allOrders = [];
    let page = 1;
    let foundExisting = false;
    const MAX_PAGES = 20; // Safety limit: fetch max 20 pages (1000 orders per day)
    
    // Foodics API filters (business_date, created_at_min) are broken, so we fetch by sort order
    // and stop when we find orders we already have
    console.log(`📥 Fetching recent orders (newest first)...`);
    
    // Fetch multiple pages until we find orders we already have
    while (page <= MAX_PAGES && !foundExisting) {
      console.log(`   Page ${page}...`);
      
      const response = await fetch(
        `https://api.foodics.com/v5/orders?per_page=${BATCH_SIZE}&page=${page}&sort=-created_at`,
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
          return res.status(502).json({ 
            error: 'Foodics API error',
            status: response.status,
            message: response.statusText
          });
        }
        break; // Stop if page > 1 fails
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
        await sleep(200); // Rate limit between page requests
      }
    }
    
    console.log(`📦 Total fetched: ${allOrders.length} orders from ${page - 1} pages\n`);
    
    // Now process all orders
    for (const order of allOrders) {
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
        await sleep(100); // Rate limit protection
        
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
        console.error(`❌ Error on order ${order.reference}:`, err.message);
        errors.push({ order: order.reference, error: err.message });
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    const result_summary = {
      success: true,
      timestamp: new Date().toISOString(),
      duration_seconds: parseFloat(elapsed),
      new_orders: newOrders,
      new_items: newItems,
      skipped_orders: skippedOrders,
      errors: errors
    };
    
    console.log('✅ Sync Complete:', result_summary);
    
    res.json(result_summary);
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/foodics/sync/status
 * Get sync status and last run info
 */
router.get('/sync/status', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        MAX(created_at) as last_order_time,
        MAX(reference) as last_reference
      FROM saas.foodics_orders
      WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    res.json({
      tenant_id: TENANT_ID,
      total_orders: result.rows[0].total_orders,
      last_order_time: result.rows[0].last_order_time,
      last_reference: result.rows[0].last_reference
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
