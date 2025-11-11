#!/usr/bin/env node
// scripts/populate-order-metrics.js
// Bulk populate order metrics for all customers

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '6555'),
  database: process.env.DB_NAME || 'ordertech',
  user: process.env.DB_USER || 'ordertech',
  password: process.env.DB_PASS || 'Ordertech.2020'
});

async function populateOrderMetrics() {
  console.log('Starting order metrics population...');
  const startTime = Date.now();
  
  try {
    // Get all customers with phone numbers
    const customers = await pool.query(`
      SELECT id, merge_key, name, phone_normalized, phone_raw
      FROM customer_analytics
      WHERE phone_normalized IS NOT NULL
      ORDER BY id
    `);
    
    console.log(`Found ${customers.rows.length} customers with phone numbers`);
    
    let processed = 0;
    let updated = 0;
    
    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < customers.rows.length; i += batchSize) {
      const batch = customers.rows.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (customer) => {
        try {
          // Fetch orders for this customer
          const orders = await pool.query(`
            SELECT 
              business_date,
              closed_at,
              total_price,
              type,
              meta->>'branch_name' as branch_name,
              meta->'products' as products
            FROM foodics_orders
            WHERE regexp_replace(COALESCE(meta->>'customer_phone', ''), '[^0-9]', '', 'g') = $1
              AND status = 4
              AND total_price > 0
            ORDER BY closed_at DESC
            LIMIT 100
          `, [customer.phone_normalized]);
          
          if (orders.rows.length === 0) {
            processed++;
            return;
          }
          
          // Calculate metrics
          const metrics = calculateMetrics(orders.rows);
          
          // Update customer
          await pool.query(`
            UPDATE customer_analytics
            SET 
              order_history = $1::jsonb,
              channel_preferences = $2::jsonb,
              time_patterns = $3::jsonb,
              top_products_detail = $4::jsonb,
              monthly_spending = $5::jsonb,
              updated_at = NOW()
            WHERE id = $6
          `, [
            JSON.stringify(metrics.order_history),
            JSON.stringify(metrics.channel_preferences),
            JSON.stringify(metrics.time_patterns),
            JSON.stringify(metrics.top_products_detail),
            JSON.stringify(metrics.monthly_spending),
            customer.id
          ]);
          
          updated++;
          processed++;
        } catch (error) {
          console.error(`Error processing customer ${customer.merge_key}:`, error.message);
          processed++;
        }
      }));
      
      console.log(`Progress: ${processed}/${customers.rows.length} (${updated} updated)`);
    }
    
    const duration = Date.now() - startTime;
    console.log(`\nComplete!`);
    console.log(`Total: ${customers.rows.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

function calculateMetrics(orders) {
  // 1. Order History (last 10)
  const order_history = orders.slice(0, 10).map(order => ({
    date: order.business_date || order.closed_at,
    branch: order.branch_name ? order.branch_name.split('|')[1]?.trim() : null,
    type: getOrderTypeName(order.type),
    amount: parseFloat(order.total_price),
    products_count: Array.isArray(order.products) ? order.products.length : 0
  }));
  
  // 2. Channel Preferences
  const typeCount = {};
  orders.forEach(order => {
    const typeName = getOrderTypeName(order.type);
    typeCount[typeName] = (typeCount[typeName] || 0) + 1;
  });
  
  const totalOrders = orders.length;
  const channel_preferences = {};
  Object.keys(typeCount).forEach(type => {
    channel_preferences[type.toLowerCase().replace('-', '_')] = Math.round((typeCount[type] / totalOrders) * 100);
  });
  
  // 3. Time Patterns
  const dayCount = {};
  const hourCount = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  orders.forEach(order => {
    if (order.closed_at) {
      const date = new Date(order.closed_at);
      const day = dayNames[date.getDay()];
      const hour = date.getHours();
      
      dayCount[day] = (dayCount[day] || 0) + 1;
      hourCount[hour] = (hourCount[hour] || 0) + 1;
    }
  });
  
  const favorite_day = Object.keys(dayCount).length > 0
    ? Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0][0]
    : null;
    
  const favorite_hour = Object.keys(hourCount).length > 0
    ? parseInt(Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0][0])
    : null;
  
  const time_patterns = {
    favorite_day,
    favorite_hour,
    day_distribution: dayCount,
    hour_distribution: hourCount
  };
  
  // 4. Top Products
  const productMap = {};
  orders.forEach(order => {
    if (Array.isArray(order.products)) {
      order.products.forEach(product => {
        const name = product.name || 'Unknown';
        const category = product.category_name || 'Uncategorized';
        const quantity = product.quantity || 1;
        const price = parseFloat(product.price || 0) * quantity;
        
        if (!productMap[name]) {
          productMap[name] = {
            name,
            category,
            quantity: 0,
            total_spent: 0
          };
        }
        
        productMap[name].quantity += quantity;
        productMap[name].total_spent += price;
      });
    }
  });
  
  const top_products_detail = Object.values(productMap)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5)
    .map(p => ({
      ...p,
      total_spent: Math.round(p.total_spent * 100) / 100
    }));
  
  // 5. Monthly Spending
  const monthlyMap = {};
  orders.forEach(order => {
    if (order.closed_at && order.total_price) {
      const month = new Date(order.closed_at).toISOString().substring(0, 7);
      monthlyMap[month] = (monthlyMap[month] || 0) + parseFloat(order.total_price);
    }
  });
  
  const monthly_spending = {};
  Object.keys(monthlyMap).forEach(month => {
    monthly_spending[month] = Math.round(monthlyMap[month] * 100) / 100;
  });
  
  return {
    order_history,
    channel_preferences,
    time_patterns,
    top_products_detail,
    monthly_spending
  };
}

function getOrderTypeName(typeId) {
  const typeMap = {
    1: 'Dine-in',
    2: 'Pickup',
    3: 'Delivery',
    4: 'Drive-thru'
  };
  return typeMap[typeId] || 'Other';
}

populateOrderMetrics();
