#!/usr/bin/env node
// Quick sync: Today's missing order items only
const { Pool } = require('pg');
const mysql = require('mysql2/promise');

const mysqlConfig = {
  socketPath: '/cloudsql/datatech-466813:us-central1:dbdatatech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'db_datatech_koobsCafe'
};

const pgPool = new Pool({
  host: '/cloudsql/smart-order-469705:me-central1:ordertech-db',
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';

async function syncTodayItems() {
  let mysqlConn;
  const startTime = Date.now();
  
  try {
    console.log('🔄 Syncing today\'s missing order items...\n');

    // Connect
    mysqlConn = await mysql.createConnection(mysqlConfig);
    console.log('✓ Connected to both databases\n');

    // Get today's date in Kuwait timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' });
    console.log(`📅 Today: ${today}\n`);

    // Find orders from today that don't have items in PostgreSQL
    const ordersWithoutItems = await pgPool.query(`
      SELECT o.id, o.reference
      FROM saas.foodics_orders o
      WHERE o.tenant_id = $1
        AND DATE(o.business_date) = $2
        AND NOT EXISTS (
          SELECT 1 FROM saas.foodics_order_items oi 
          WHERE oi.tenant_id = $1 AND oi.order_id = o.id
        )
      ORDER BY o.created_at DESC
    `, [TENANT_ID, today]);

    console.log(`Found ${ordersWithoutItems.rows.length} orders without items\n`);

    if (ordersWithoutItems.rows.length === 0) {
      console.log('✅ All today\'s orders already have items!');
      await mysqlConn.end();
      await pgPool.end();
      process.exit(0);
    }

    let importedItems = 0;
    let errors = [];

    // For each order, fetch and import its items from MySQL
    for (const order of ordersWithoutItems.rows) {
      try {
        // Fetch items from MySQL for this order
        const [items] = await mysqlConn.query(
          'SELECT * FROM tblOrderProducts WHERE order_id = ?',
          [order.id]
        );

        console.log(`Order ${order.reference}: ${items.length} items`);

        for (const item of items) {
          try {
            await pgPool.query(`
              INSERT INTO saas.foodics_order_items (
                tenant_id, id, order_id, product_id,
                quantity, unit_price, total_price, discount_amount,
                product_name, product_sku,
                created_at, updated_at, meta
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              ON CONFLICT (tenant_id, id) DO NOTHING
            `, [
              TENANT_ID,
              item.id,
              item.order_id,
              item.product_id,
              item.quantity,
              item.unit_price,
              item.total_price,
              item.discount_amount,
              null, // product_name - not in MySQL table
              null, // product_sku - not in MySQL table
              item.added_at,
              item.closed_at,
              JSON.stringify(item)
            ]);
            
            importedItems++;
          } catch (err) {
            // Skip individual item errors
          }
        }
      } catch (err) {
        errors.push({ order: order.reference, error: err.message });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Today\'s Items Sync Complete!');
    console.log('═'.repeat(50));
    console.log(`  Items imported:  ${importedItems}`);
    console.log(`  Errors:          ${errors.length}`);
    console.log(`  Duration:        ${elapsed}s`);
    console.log('');

    await mysqlConn.end();
    await pgPool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    if (mysqlConn) await mysqlConn.end();
    await pgPool.end();
    process.exit(1);
  }
}

syncTodayItems();
