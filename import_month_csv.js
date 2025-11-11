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

async function importMonth() {
  try {
    const ordersPath = process.argv[2];
    const itemsPath = process.argv[3]; // Can be a directory or single file
    
    if (!ordersPath) {
      console.log('Usage: node import_month_csv.js <orders_csv> [items_csv_or_directory]');
      process.exit(1);
    }
    
    console.log('📁 Importing Foodics CSV exports\n');
    
    // Read orders CSV
    console.log(`📦 Reading orders: ${ordersPath}`);
    const ordersCSV = fs.readFileSync(ordersPath, 'utf-8');
    const orders = parse(ordersCSV, { columns: true, skip_empty_lines: true, bom: true });
    console.log(`   Found ${orders.length} orders\n`);
    
    // Import orders first
    let ordersImported = 0;
    let ordersUpdated = 0;
    
    console.log('⏳ Importing orders...\n');
    
    for (const order of orders) {
      try {
        // Get the reference field (may have BOM)
        const reference = Object.keys(order).find(k => k.includes('reference'));
        const ref = order[reference] || order['reference'];
        
        const result = await pool.query(`
          INSERT INTO saas.foodics_orders (
            tenant_id, id, reference, number, business_date,
            total_price, subtotal_price, discount_amount,
            status, created_at, updated_at, closed_at, opened_at, meta
          ) VALUES (
            $1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          )
          ON CONFLICT (tenant_id, reference) 
          DO UPDATE SET
            total_price = EXCLUDED.total_price,
            updated_at = NOW()
          RETURNING id, (xmax = 0) as inserted
        `, [
          TENANT_ID,
          ref,
          parseInt(order.number) || 0,
          order.business_date,
          parseFloat(order.total_price) || 0,
          parseFloat(order.subtotal) || 0,
          parseFloat(order.discounts) || 0,
          4, // status = Done
          order.created_at || order.business_date,
          order.created_at || order.business_date,
          order.closed_at || order.business_date,
          order.opened_at || order.created_at || order.business_date,
          JSON.stringify(order)
        ]);
        
        if (result.rows[0].inserted) {
          ordersImported++;
        } else {
          ordersUpdated++;
        }
        
        if ((ordersImported + ordersUpdated) % 100 === 0) {
          console.log(`   ✅ Progress: ${ordersImported} new, ${ordersUpdated} updated`);
        }
      } catch (err) {
        console.error(`   ❌ Error on order ${order.number}:`, err.message);
      }
    }
    
    console.log(`\n✅ Orders: ${ordersImported} imported, ${ordersUpdated} updated\n`);
    
    // Import order items if provided
    if (itemsPath) {
      let allItems = [];
      
      // Check if it's a directory or file
      if (fs.statSync(itemsPath).isDirectory()) {
        const files = fs.readdirSync(itemsPath).filter(f => f.endsWith('.csv'));
        console.log(`📦 Reading ${files.length} order items files from directory\n`);
        for (const file of files) {
          const csv = fs.readFileSync(`${itemsPath}/${file}`, 'utf-8');
          const items = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
          allItems = allItems.concat(items);
        }
      } else {
        console.log(`📦 Reading order items: ${itemsPath}\n`);
        const csv = fs.readFileSync(itemsPath, 'utf-8');
        allItems = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
      }
      
      console.log(`   Found ${allItems.length} order items\n`);
      
      // Get order mapping by reference and check_number
      const orderMap = await pool.query(`
        SELECT reference, check_number, id 
        FROM saas.foodics_orders 
        WHERE tenant_id = $1
      `, [TENANT_ID]);
      
      const refToId = new Map();
      const checkToId = new Map();
      orderMap.rows.forEach(row => {
        if (row.reference) refToId.set(row.reference.toString(), row.id);
        if (row.check_number) checkToId.set(row.check_number.toString(), row.id);
      });
      
      console.log(`🗺️  Mapped ${refToId.size} orders by reference, ${checkToId.size} by check_number\n`);
      console.log('⏳ Importing order items...\n');
      
      let itemsImported = 0;
      let itemsSkipped = 0;
      
      for (const item of allItems) {
        const orderRef = (item.order_reference || '').trim();
        const checkNumber = (item.check_number || '').trim();
        
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
          // Ignore duplicate errors
        }
      }
      
      console.log(`\n✅ Order items: ${itemsImported} imported, ${itemsSkipped} skipped\n`);
    }
    
    // Show stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM saas.foodics_order_items oi 
          WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id
        ) THEN o.id END) as orders_with_items,
        (SELECT COUNT(*) FROM saas.foodics_order_items WHERE tenant_id = $1) as total_items
      FROM saas.foodics_orders o
      WHERE o.tenant_id = $1
    `, [TENANT_ID]);
    
    console.log('═'.repeat(60));
    console.log('📊 Database Stats:');
    console.log('═'.repeat(60));
    const s = stats.rows[0];
    console.log(`  Total orders:       ${s.total_orders}`);
    console.log(`  Orders with items:  ${s.orders_with_items}`);
    console.log(`  Total items:        ${s.total_items}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importMonth();
