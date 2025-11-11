#!/usr/bin/env node
// Cloud Run Job: Sync Foodics data from datatech MySQL to our PostgreSQL
const { Pool } = require('pg');
const mysql = require('mysql2/promise');

// Remote MySQL DB (source) - datatech via Cloud SQL socket
const mysqlConfig = {
  socketPath: '/cloudsql/datatech-466813:us-central1:dbdatatech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'db_datatech_koobsCafe'
};

// Local DB (destination) - our database via Cloud SQL socket
const localPool = new Pool({
  host: '/cloudsql/smart-order-469705:me-central1:ordertech-db',
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020'
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe

async function syncData() {
  const startTime = Date.now();
  let mysqlConn;
  
  try {
    console.log('🔄 Foodics MySQL → PostgreSQL Sync started -', new Date().toISOString(), '\n');

    // Connect to MySQL
    console.log('Connecting to MySQL...');
    mysqlConn = await mysql.createConnection(mysqlConfig);
    console.log('✓ Connected to MySQL');
    
    // Test PostgreSQL
    const pgTest = await localPool.query('SELECT current_database()');
    console.log(`✓ Connected to PostgreSQL: ${pgTest.rows[0].current_database}\n`);

    // Check MySQL tables
    console.log('Inspecting MySQL tables...\n');
    
    const [ordersCount] = await mysqlConn.query('SELECT COUNT(*) as count FROM tblOrders');
    console.log(`📦 tblOrders: ${ordersCount[0].count} records`);
    
    const [ordersSample] = await mysqlConn.query('SELECT * FROM tblOrders LIMIT 1');
    if (ordersSample[0]) {
      console.log(`   Columns:`, Object.keys(ordersSample[0]).join(', '));
      console.log(`   Sample:`, JSON.stringify(ordersSample[0], null, 2).slice(0, 300));
    }
    
    const [productsCount] = await mysqlConn.query('SELECT COUNT(*) as count FROM tblOrderProducts');
    console.log(`\n📦 tblOrderProducts: ${productsCount[0].count} records`);
    
    const [productsSample] = await mysqlConn.query('SELECT * FROM tblOrderProducts LIMIT 1');
    if (productsSample[0]) {
      console.log(`   Columns:`, Object.keys(productsSample[0]).join(', '));
    }
    console.log();

    // Now sync the data
    console.log('Starting data import...\n');
    
    let importedOrders = 0;
    let importedItems = 0;
    let skippedOrders = 0;
    let errors = [];
    
    // Fetch all orders from MySQL
    console.log('Fetching orders from MySQL...');
    const [orders] = await mysqlConn.query('SELECT * FROM tblOrders ORDER BY created_at DESC');
    console.log(`Found ${orders.length} orders to process\n`);
    
    // Import orders in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);
      console.log(`Processing orders ${i + 1} - ${Math.min(i + BATCH_SIZE, orders.length)}...`);
      
      for (const order of batch) {
        try {
          // Check if order already exists by reference
          const existing = await localPool.query(
            `SELECT id FROM saas.foodics_orders WHERE tenant_id = $1 AND reference = $2`,
            [TENANT_ID, order.reference?.toString()]
          );
          
          if (existing.rows.length > 0) {
            skippedOrders++;
            continue;
          }
          
          // Insert order
          await localPool.query(`
            INSERT INTO saas.foodics_orders (
              tenant_id, id, reference, number, check_number,
              business_date, total_price, subtotal_price, discount_amount,
              type, source, status, guests,
              created_at, updated_at, closed_at,
              branch_id, customer_id, meta
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT (tenant_id, reference) DO NOTHING
          `, [
            TENANT_ID,
            order.id,
            order.reference?.toString(),
            order.number,
            order.check_number,
            order.business_date,
            order.total_price || 0,
            order.subtotal_price || 0,
            order.discount_amount || 0,
            order.type,
            order.source,
            order.status,
            order.guests,
            order.created_at,
            order.updated_at,
            order.closed_at,
            order.branch_id,
            order.customer_id,
            JSON.stringify(order)
          ]);
          
          importedOrders++;
          
        } catch (err) {
          errors.push({ order: order.reference, error: err.message });
        }
      }
    }
    
    console.log(`\nOrders imported: ${importedOrders}, skipped: ${skippedOrders}`);
    console.log('\nFetching order items from MySQL...');
    
    // Fetch all order items
    const [items] = await mysqlConn.query('SELECT * FROM tblOrderProducts');
    console.log(`Found ${items.length} items to process\n`);
    
    // Import items in batches
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      console.log(`Processing items ${i + 1} - ${Math.min(i + BATCH_SIZE, items.length)}...`);
      
      for (const item of batch) {
        try {
          // Get product by SKU if available
          const productResult = await localPool.query(
            `SELECT id FROM saas.foodics_products WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
            [TENANT_ID, item.product_id]
          );
          
          await localPool.query(`
            INSERT INTO saas.foodics_order_items (
              tenant_id, id, order_id, product_id,
              quantity, unit_price, total_price, discount_amount,
              created_at, updated_at, meta
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (tenant_id, id) DO NOTHING
          `, [
            TENANT_ID,
            item.id,
            item.order_id,
            productResult.rows[0]?.id || null,
            item.quantity,
            item.unit_price,
            item.total_price,
            item.discount_amount,
            item.added_at,
            item.closed_at,
            JSON.stringify(item)
          ]);
          
          importedItems++;
          
        } catch (err) {
          // Skip items with errors silently
        }
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Sync Complete!');
    console.log('═'.repeat(50));
    console.log(`  Orders imported:   ${importedOrders}`);
    console.log(`  Orders skipped:    ${skippedOrders}`);
    console.log(`  Items imported:    ${importedItems}`);
    console.log(`  Errors:            ${errors.length}`);
    console.log(`  Duration:          ${elapsed}s`);
    console.log('');
    
    if (errors.length > 0 && errors.length < 10) {
      console.log('Errors:');
      errors.forEach(e => console.log(`  ${e.order}: ${e.error}`));
    }
    
    await mysqlConn.end();
    await localPool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    console.error(error.stack);
    if (mysqlConn) await mysqlConn.end();
    await localPool.end();
    process.exit(1);
  }
}

syncData();
