#!/usr/bin/env node
// Sync Foodics data from remote DB (datatech) to local DB
const { Pool } = require('pg');

// Remote DB (source) - datatech
const remotePool = new Pool({
  host: '34.72.158.144', // Public IP of datatech-466813:us-central1:dbdatatech
  port: 5432,
  database: 'postgres',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: { rejectUnauthorized: false }
});

// Local DB (destination) - our current database
const localPool = new Pool({
  host: '127.0.0.1',
  port: 6555, // Cloud SQL Proxy
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe

async function syncData() {
  try {
    console.log('🔄 Starting sync from remote DB...\n');

    // Test connections
    console.log('Testing connections...');
    const remoteTest = await remotePool.query('SELECT current_database()');
    console.log(`✓ Remote DB: ${remoteTest.rows[0].current_database}`);
    
    const localTest = await localPool.query('SELECT current_database()');
    console.log(`✓ Local DB: ${localTest.rows[0].current_database}\n`);

    // Get schema info from remote
    console.log('Fetching table schemas...');
    const tablesResult = await remotePool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE tablename LIKE 'tblOrder%' 
      ORDER BY tablename
    `);
    
    console.log('Found tables:');
    tablesResult.rows.forEach(row => console.log(`  - ${row.tablename}`));
    console.log();

    // Sync tblOrders
    console.log('📦 Syncing tblOrders...');
    const ordersResult = await remotePool.query('SELECT * FROM "tblOrders" ORDER BY created_at DESC LIMIT 5');
    console.log(`  Sample: Found ${ordersResult.rows.length} orders`);
    if (ordersResult.rows[0]) {
      console.log(`  Columns:`, Object.keys(ordersResult.rows[0]).join(', '));
      console.log(`  First order:`, ordersResult.rows[0].id, ordersResult.rows[0].reference || ordersResult.rows[0].order_id);
    }
    console.log();

    // Sync tblOrderProducts
    console.log('📦 Syncing tblOrderProducts...');
    const productsResult = await remotePool.query('SELECT * FROM "tblOrderProducts" LIMIT 5');
    console.log(`  Sample: Found ${productsResult.rows.length} order products`);
    if (productsResult.rows[0]) {
      console.log(`  Columns:`, Object.keys(productsResult.rows[0]).join(', '));
    }
    console.log();

    // Sync tblOrderModifierOptions
    console.log('📦 Syncing tblOrderModifierOptions...');
    const modifiersResult = await remotePool.query('SELECT * FROM "tblOrderModifierOptions" LIMIT 5');
    console.log(`  Sample: Found ${modifiersResult.rows.length} modifier options`);
    if (modifiersResult.rows[0]) {
      console.log(`  Columns:`, Object.keys(modifiersResult.rows[0]).join(', '));
    }
    console.log();

    console.log('✅ Schema inspection complete!\n');
    console.log('Next step: Map remote columns to our foodics_orders/items tables');

    await remotePool.end();
    await localPool.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    await remotePool.end();
    await localPool.end();
    process.exit(1);
  }
}

syncData();
