#!/usr/bin/env node
// Convert MySQL Foodics data to PostgreSQL
const fs = require('fs');
const { Pool } = require('pg');
const mysql = require('mysql2/promise');

// MySQL connection (remote)
const mysqlConfig = {
  host: '34.72.158.144',
  user: 'ordertech',
  password: 'Ordertech.2020',
  database: 'db_datatech_koobsCafe',
  port: 3306,
  ssl: { rejectUnauthorized: false }
};

// PostgreSQL connection (local)
const pgPool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe

async function convertData() {
  let mysqlConn;
  const startTime = Date.now();
  
  try {
    console.log('🔄 Starting MySQL → PostgreSQL conversion\n');

    // Connect to MySQL
    console.log('Connecting to MySQL...');
    mysqlConn = await mysql.createConnection(mysqlConfig);
    console.log('✓ Connected to MySQL\n');

    // Test PostgreSQL
    console.log('Testing PostgreSQL...');
    const pgTest = await pgPool.query('SELECT current_database()');
    console.log(`✓ Connected to PostgreSQL: ${pgTest.rows[0].current_database}\n`);

    // Check MySQL table structure
    console.log('Inspecting MySQL tables...\n');
    
    // tblOrders
    const [ordersRows] = await mysqlConn.query('SELECT COUNT(*) as count FROM tblOrders');
    console.log(`📦 tblOrders: ${ordersRows[0].count} records`);
    
    const [ordersSample] = await mysqlConn.query('SELECT * FROM tblOrders LIMIT 1');
    if (ordersSample[0]) {
      console.log(`   Columns:`, Object.keys(ordersSample[0]).join(', '));
    }
    
    // tblOrderProducts
    const [productsRows] = await mysqlConn.query('SELECT COUNT(*) as count FROM tblOrderProducts');
    console.log(`\n📦 tblOrderProducts: ${productsRows[0].count} records`);
    
    const [productsSample] = await mysqlConn.query('SELECT * FROM tblOrderProducts LIMIT 1');
    if (productsSample[0]) {
      console.log(`   Columns:`, Object.keys(productsSample[0]).join(', '));
    }

    // tblOrderModifierOptions
    const [modifiersRows] = await mysqlConn.query('SELECT COUNT(*) as count FROM tblOrderModifierOptions');
    console.log(`\n📦 tblOrderModifierOptions: ${modifiersRows[0].count} records\n`);

    console.log('═'.repeat(50));
    console.log('Ready to convert data!');
    console.log('═'.repeat(50));
    console.log('\nNext steps:');
    console.log('1. Map tblOrders → saas.foodics_orders');
    console.log('2. Map tblOrderProducts → saas.foodics_order_items');
    console.log('3. Handle modifiers if needed\n');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Duration: ${elapsed}s`);

    await mysqlConn.end();
    await pgPool.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (mysqlConn) await mysqlConn.end();
    await pgPool.end();
    process.exit(1);
  }
}

convertData();
