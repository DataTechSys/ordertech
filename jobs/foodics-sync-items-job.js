#!/usr/bin/env node
// Cloud Run Job: Sync missing order items for orders without items
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe
const BATCH_SIZE = 50; // Process 50 orders per run

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncMissingItems() {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Foodics Items Sync Job started - ${new Date().toISOString()}`);
    
    // Get API token
    const result = await pool.query(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE foodics_id = '494675'`
    );
    
    if (!result.rows[0]?.token) {
      throw new Error('Foodics API token not found');
    }
    
    const token = result.rows[0].token;
    
    // Find orders without items (most recent first)
    const ordersWithoutItems = await pool.query(`
      SELECT o.id, o.reference, o.created_at
      FROM saas.foodics_orders o
      WHERE o.tenant_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM saas.foodics_order_items oi 
          WHERE oi.tenant_id = $1 AND oi.order_id = o.id
        )
        AND o.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY o.created_at DESC
      LIMIT $2
    `, [TENANT_ID, BATCH_SIZE]);
    
    const ordersToProcess = ordersWithoutItems.rows;
    
    console.log(`📋 Found ${ordersToProcess.length} orders without items`);
    
    if (ordersToProcess.length === 0) {
      console.log('✅ All recent orders have items!');
      await pool.end();
      process.exit(0);
    }
    
    let processedOrders = 0;
    let totalItems = 0;
    let errors = [];
    
    // Process each order
    for (const order of ordersToProcess) {
      try {
        console.log(`   Processing order ${order.reference}...`);
        
        // Fetch order details from Foodics API
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
          console.log('⚠️  Rate limited, stopping for now');
          break;
        }
        
        if (response.status !== 200) {
          console.error(`   ⚠️  API returned ${response.status} for order ${order.reference}`);
          errors.push({ order: order.reference, error: `API ${response.status}` });
          continue;
        }
        
        const orderDetails = await response.json();
        const items = orderDetails.data?.order_items || [];
        
        if (items.length === 0) {
          console.log(`   ⚠️  No items in API response for order ${order.reference}`);
          continue;
        }
        
        // Import order items
        let itemCount = 0;
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
          
          itemCount++;
        }
        
        totalItems += itemCount;
        processedOrders++;
        console.log(`   ✓ Imported ${itemCount} items for order ${order.reference}`);
        
        // Rate limit protection
        await sleep(150);
        
      } catch (err) {
        console.error(`   ❌ Error on order ${order.reference}:`, err.message);
        errors.push({ order: order.reference, error: err.message });
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Items Sync Complete!');
    console.log('═'.repeat(50));
    console.log(`  Orders processed:  ${processedOrders}`);
    console.log(`  Items imported:    ${totalItems}`);
    console.log(`  Errors:            ${errors.length}`);
    console.log(`  Duration:          ${elapsed}s`);
    console.log('');
    
    if (errors.length > 0) {
      console.log('Errors:');
      errors.forEach(e => console.log(`  ${e.order}: ${e.error}`));
    }
    
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Items sync failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

// Run the sync
syncMissingItems();
