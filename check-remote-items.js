#!/usr/bin/env node
const mysql = require('mysql2/promise');

async function checkRemoteItems() {
  let conn;
  
  try {
    console.log('Connecting to remote MySQL database...\n');
    
    // Connect via Cloud SQL proxy or socket
    conn = await mysql.createConnection({
      socketPath: '/cloudsql/datatech-466813:us-central1:dbdatatech',
      user: 'ordertech',
      password: 'Ordertech.2020',
      database: 'db_datatech_koobsCafe'
    });
    
    console.log('✓ Connected\n');
    
    // Check total items
    const [totalRows] = await conn.query('SELECT COUNT(*) as cnt FROM tblOrderProducts');
    console.log(`Total order items in tblOrderProducts: ${totalRows[0].cnt}\n`);
    
    // Check items by date for November
    console.log('Order items by date (November 2025):');
    console.log('═'.repeat(50));
    
    const [dateRows] = await conn.query(`
      SELECT 
        DATE(added_at) as date,
        COUNT(*) as total_items
      FROM tblOrderProducts 
      WHERE DATE(added_at) >= '2025-11-01'
      GROUP BY DATE(added_at)
      ORDER BY date DESC
    `);
    
    if (dateRows.length === 0) {
      console.log('❌ No order items found for November 2025');
    } else {
      dateRows.forEach(row => {
        console.log(`  ${row.date}: ${row.total_items.toString().padStart(6)} items`);
      });
    }
    
    console.log('\n' + '═'.repeat(50));
    
    // Check the most recent item date
    const [latestRow] = await conn.query(`
      SELECT MAX(added_at) as latest_date 
      FROM tblOrderProducts
    `);
    
    console.log(`\nMost recent item date: ${latestRow[0].latest_date || 'None'}`);
    
    await conn.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (conn) await conn.end();
    process.exit(1);
  }
}

checkRemoteItems();
