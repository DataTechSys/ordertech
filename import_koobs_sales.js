#!/usr/bin/env node

// Quick import script for Koobs Cafe sales data
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load Foodics client
const { makeClient } = require('./server/integrations/foodics.js');

// Configuration
const TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896'; // Koobs Cafe
const DAYS_BACK = parseInt(process.argv[2]) || 7; // Default 7 days

// Database connection
const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  database: 'ordertech',
  user: 'ordertech',
  password: 'Ordertech.2020',
  ssl: false
});

async function db(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function main() {
  console.log('🚀 Koobs Cafe Sales Import');
  console.log(`📅 Importing last ${DAYS_BACK} days\n`);

  try {
    // Get Foodics token from tenant
    const [tenant] = await db(
      `SELECT meta->>'foodics_api_token' as token FROM saas.tenants WHERE tenant_id = $1`,
      [TENANT_ID]
    );

    if (!tenant || !tenant.token) {
      console.error('❌ No Foodics token found for Koobs Cafe');
      process.exit(1);
    }

    console.log('✅ Foodics token found');

    // Initialize Foodics client
    const foodicsClient = makeClient(tenant.token);

    // Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - DAYS_BACK);

    const fromStr = fromDate.toISOString();
    const toStr = toDate.toISOString();

    console.log(`📆 From: ${fromStr}`);
    console.log(`📆 To: ${toStr}\n`);

    // Fetch orders
    console.log('📦 Fetching orders from Foodics API...');
    
    // Calculate business_date range (YYYY-MM-DD format)
    const fromBusinessDate = fromDate.toISOString().split('T')[0];
    const toBusinessDate = toDate.toISOString().split('T')[0];
    
    const params = {
      'filter[business_date_after]': fromBusinessDate,
      'filter[business_date_before]': toBusinessDate,
      'filter[status]': 'closed'
    };

    const ordersResult = await foodicsClient.listOrders(params);
    let orders = ordersResult.items || [];

    console.log(`✅ Fetched ${orders.length} orders in ${ordersResult.pages} pages\n`);

    if (orders.length === 0) {
      console.log('ℹ️  No orders found in this date range');
      console.log('   Trying without status filter...');
      
      // Try without status filter
      delete params['filter[status]'];
      const allOrdersResult = await foodicsClient.listOrders(params);
      const allOrders = allOrdersResult.items || [];
      
      console.log(`   Found ${allOrders.length} orders (all statuses)`);
      
      if (allOrders.length === 0) {
        await pool.end();
        return;
      }
      
      // Use all orders
      orders = allOrders;
    }

    // Simple stats
    let totalRevenue = 0;
    let itemCount = 0;

    for (const order of orders) {
      if (order.total) {
        totalRevenue += parseFloat(order.total) || 0;
      }
      if (order.items && Array.isArray(order.items)) {
        itemCount += order.items.length;
      }
    }

    console.log('📊 Summary:');
    console.log(`   Orders: ${orders.length}`);
    console.log(`   Items: ${itemCount}`);
    console.log(`   Total Revenue: ${totalRevenue.toFixed(3)} KWD\n`);

    // Now let's insert into database
    console.log('💾 Saving to database...');

    let savedOrders = 0;
    let skippedOrders = 0;

    for (const order of orders) {
      try {
        // Check if order already exists
        const [existing] = await db(
          `SELECT order_id FROM sales_orders WHERE tenant_id = $1 AND external_id = $2`,
          [TENANT_ID, order.id]
        );

        if (existing) {
          skippedOrders++;
          continue;
        }

        // Insert order
        await db(
          `INSERT INTO sales_orders (
            tenant_id, external_id, external_ref, currency, status,
            order_no, receipt_no, subtotal, discount_total, tax_total,
            total, paid_total, placed_at, paid_at, closed_at,
            pos_created_at, pos_updated_at, meta
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            TENANT_ID,
            order.id,
            order.reference || null,
            order.currency || 'KWD',
            order.status || 'closed',
            order.number || null,
            order.receipt_number || null,
            order.subtotal || 0,
            order.discount || 0,
            order.tax || 0,
            order.total || 0,
            order.paid_amount || order.total || 0,
            order.created_at || new Date(),
            order.paid_at || order.created_at || new Date(),
            order.closed_at || order.created_at || new Date(),
            order.created_at || new Date(),
            order.updated_at || new Date(),
            JSON.stringify({ raw_order: order })
          ]
        );

        savedOrders++;

        if (savedOrders % 100 === 0) {
          console.log(`   Saved ${savedOrders} orders...`);
        }
      } catch (err) {
        console.error(`   Error saving order ${order.id}:`, err.message);
      }
    }

    console.log(`\n✅ Import complete!`);
    console.log(`   Saved: ${savedOrders} orders`);
    console.log(`   Skipped: ${skippedOrders} (already exist)\n`);

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } catch (finalError) {
    console.error('❌ Import failed:', finalError.message);
    console.error(finalError.stack);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch (e) {
      // Ignore pool already ended errors
    }
  }
}

main();
