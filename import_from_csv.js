#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe

async function importCSV() {
  try {
    console.log('📁 Importing Foodics CSV exports\n');
    
    // Read orders CSV
    const ordersPath = '/Users/mosawi/Downloads/1-a04e79d8-8355-49a5-8f65-6ef5688bd2f8.csv';
    const ordersCSV = fs.readFileSync(ordersPath, 'utf-8');
    const orders = parse(ordersCSV, { columns: true, skip_empty_lines: true });
    
    console.log(`📦 Found ${orders.length} orders\n`);
    
    // Read order items CSVs
    const itemsPaths = [
      '/Users/mosawi/Downloads/a04e7a56-c3c6-4b42-98da-0bbbdfe314e0/1-a04e7a56-c401-4d43-8013-7179fe3b09ce.csv',
      '/Users/mosawi/Downloads/a04e7a56-c3c6-4b42-98da-0bbbdfe314e0/2-a04e7a5c-83f7-4ac7-b897-9f46c75a4c2e.csv',
      '/Users/mosawi/Downloads/a04e7a56-c3c6-4b42-98da-0bbbdfe314e0/3-a04e7a5f-2773-4932-b5df-3bb50203b63e.csv'
    ];
    
    let allItems = [];
    for (const path of itemsPaths) {
      const csv = fs.readFileSync(path, 'utf-8');
      const items = parse(csv, { columns: true, skip_empty_lines: true });
      allItems = allItems.concat(items);
    }
    
    console.log(`📦 Found ${allItems.length} order items\n`);
    
    // First, we need to get existing orders from database to map reference -> id
    const existingOrders = await pool.query(`
      SELECT reference, id FROM saas.foodics_orders WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    const refToId = new Map();
    const checkToId = new Map();
    existingOrders.rows.forEach(row => {
      refToId.set(row.reference?.toString(), row.id);
    });
    
    // Also get mapping by check_number
    const ordersByCheck = await pool.query(`
      SELECT check_number, id FROM saas.foodics_orders WHERE tenant_id = $1
    `, [TENANT_ID]);
    
    ordersByCheck.rows.forEach(row => {
      if (row.check_number) {
        checkToId.set(row.check_number.toString(), row.id);
      }
    });
    
    console.log(`🗺️  Mapped ${refToId.size} orders by reference, ${checkToId.size} by check_number\n`);
    
    // Import order items using reference mapping
    let itemsImported = 0;
    let itemsSkipped = 0;
    
    console.log('⏳ Importing order items...\n');
    
    for (const item of allItems) {
      const orderRef = (item.order_reference || '').trim();
      const checkNumber = (item.check_number || '').trim();
      
      // Try to find order by reference first, then check_number
      let orderId = orderRef ? refToId.get(orderRef) : null;
      if (!orderId && checkNumber) {
        orderId = checkToId.get(checkNumber);
      }
      
      if (!orderId) {
        itemsSkipped++;
        continue;
      }
      
      // Find product by SKU
      const productResult = await pool.query(`
        SELECT id FROM saas.foodics_products 
        WHERE tenant_id = $1 AND sku = $2
        LIMIT 1
      `, [TENANT_ID, item.sku]);
      
      const productId = productResult.rows[0]?.id || null;
      
      try {
        await pool.query(`
          INSERT INTO saas.foodics_order_items (
            tenant_id, id, order_id, product_id,
            quantity, unit_price, price, total_price, discount_amount, tax_amount,
            product_name, product_sku, notes, meta,
            created_at, updated_at
          ) VALUES (
            $1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
          )
          ON CONFLICT (tenant_id, id) DO NOTHING
        `, [
          TENANT_ID,
          orderId,
          productId,
          parseInt(item.quantity) || 1,
          parseFloat(item.unit_price) || 0,
          parseFloat(item.unit_price) || 0,
          parseFloat(item.total_price) || 0,
          parseFloat(item.discount_amount) || 0,
          parseFloat(item.total_taxes) || 0,
          item.name,
          item.sku,
          '',
          JSON.stringify(item)
        ]);
        
        itemsImported++;
        
        if (itemsImported % 1000 === 0) {
          console.log(`   ✅ Imported ${itemsImported} items...`);
        }
      } catch (err) {
        console.error(`   ❌ Error on item ${item.sku}:`, err.message);
      }
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log('📊 Import Complete!');
    console.log('═'.repeat(60));
    console.log(`  Order items imported: ${itemsImported}`);
    console.log(`  Order items skipped:  ${itemsSkipped}`);
    
    // Check progress
    const stats = await pool.query(`
      SELECT 
        COUNT(DISTINCT oi.order_id) as orders_with_items,
        COUNT(*) as total_items
      FROM saas.foodics_order_items oi
      WHERE oi.tenant_id = $1
    `, [TENANT_ID]);
    
    console.log(`\n📈 Database Stats:`);
    console.log(`  Orders with items: ${stats.rows[0].orders_with_items}`);
    console.log(`  Total items:       ${stats.rows[0].total_items}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importCSV();
