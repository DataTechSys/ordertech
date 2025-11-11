// lib/orderMetrics.js
// Extract detailed order history and behavioral patterns from orders

/**
 * Calculate detailed order metrics for a customer
 * @param {Function} db - Database query function
 * @param {object} customer - Customer with phone info
 * @returns {Promise<object>} - Order metrics: {order_history, channel_preferences, time_patterns, top_products_detail, monthly_spending}
 */
async function calculateOrderMetrics(db, customer) {
  const conditions = [];
  const params = [];
  
  // Build phone number conditions
  if (customer.phone_normalized) {
    params.push(customer.phone_normalized);
    conditions.push(`regexp_replace(COALESCE(meta->>'customer_phone', ''), '[^0-9]', '', 'g') = regexp_replace($${params.length}, '[^0-9]', '', 'g')`);
  }
  if (customer.phone_raw && customer.phone_raw !== customer.phone_normalized) {
    params.push(customer.phone_raw);
    conditions.push(`regexp_replace(COALESCE(meta->>'customer_phone', ''), '[^0-9]', '', 'g') = regexp_replace($${params.length}, '[^0-9]', '', 'g')`);
  }
  
  // Build customer name condition (for customers without phone)
  if (customer.name && !customer.phone_normalized) {
    params.push(customer.name);
    conditions.push(`COALESCE(meta->>'customer_name', '') = $${params.length}`);
  }
  
  if (conditions.length === 0) {
    return getEmptyMetrics();
  }
  
  // Fetch orders
  const orders = await db(`
    SELECT 
      business_date,
      closed_at,
      total_price,
      type,
      meta->>'branch_name' as branch_name,
      meta->'products' as products
    FROM foodics_orders
    WHERE (${conditions.join(' OR ')})
      AND status = 4
      AND total_price > 0
    ORDER BY closed_at DESC
    LIMIT 100
  `, params);
  
  if (orders.length === 0) {
    return getEmptyMetrics();
  }
  
  // 1. Order History (last 10 orders)
  const order_history = orders.slice(0, 10).map(order => ({
    date: order.business_date || order.closed_at,
    branch: order.branch_name ? order.branch_name.split('|')[1]?.trim() : null,
    type: getOrderTypeName(order.type),
    amount: parseFloat(order.total_price),
    products_count: Array.isArray(order.products) ? order.products.length : 0
  }));
  
  // 2. Channel Preferences (order type distribution)
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
  
  // 3. Time Patterns (day and hour distribution)
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
  
  // 4. Top Products (with details)
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
  
  // 5. Monthly Spending (last 12 months)
  const monthlyMap = {};
  orders.forEach(order => {
    if (order.closed_at && order.total_price) {
      const month = new Date(order.closed_at).toISOString().substring(0, 7); // YYYY-MM
      monthlyMap[month] = (monthlyMap[month] || 0) + parseFloat(order.total_price);
    }
  });
  
  // Round monthly spending
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

/**
 * Get empty metrics structure
 */
function getEmptyMetrics() {
  return {
    order_history: [],
    channel_preferences: {},
    time_patterns: { favorite_day: null, favorite_hour: null, day_distribution: {}, hour_distribution: {} },
    top_products_detail: [],
    monthly_spending: {}
  };
}

/**
 * Map order type ID to name
 */
function getOrderTypeName(typeId) {
  const typeMap = {
    1: 'Dine-in',
    2: 'Pickup',
    3: 'Delivery',
    4: 'Drive-thru'
  };
  return typeMap[typeId] || 'Other';
}

module.exports = {
  calculateOrderMetrics
};
