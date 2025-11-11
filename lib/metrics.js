// lib/metrics.js
// Customer metrics: RFM scoring, CLV calculation, and segmentation
// Updated: 2024-11-11 - Fixed CLV calculation to use conservative multipliers

const { safeNumber, monthsBetween, daysBetween } = require('./customerMerge');

/**
 * Calculate Customer Lifetime Value (CLV)
 * CLV = AOV × Purchase Frequency × Customer Lifespan
 * @param {object} customer - Customer with orders_count, total_spent, first_order_date, last_order_date
 * @returns {number} - CLV value
 */
function calculateCLV(customer) {
  const orders_count = safeNumber(customer.orders_count, 0);
  const total_spent = safeNumber(customer.total_spent, 0);
  const first_order_date = customer.first_order_date;
  const last_order_date = customer.last_order_date;
  
  if (orders_count === 0 || total_spent === 0) return 0;
  
  // Average Order Value
  const aov = total_spent / orders_count;
  
  // Customer lifespan in months
  const lifespan_months = monthsBetween(first_order_date, new Date());
  if (lifespan_months <= 0) return aov; // New customer, CLV = first order value
  
  // Purchase frequency per month
  const frequency_per_month = orders_count / Math.max(1, lifespan_months);
  
  // CLV = Total Spent * Multiplier based on engagement
  // More conservative: use actual spending + projected value based on frequency
  // High frequency customers (>2 orders/month) = 3x multiplier
  // Medium frequency (0.5-2 orders/month) = 2x multiplier  
  // Low frequency (<0.5 orders/month) = 1.5x multiplier
  let multiplier = 1.5;
  if (frequency_per_month >= 2) {
    multiplier = 3;
  } else if (frequency_per_month >= 0.5) {
    multiplier = 2;
  }
  
  const clv = total_spent * multiplier;
  
  return Math.max(0, clv);
}

/**
 * Calculate days since last order
 * @param {Date} last_order_date 
 * @returns {number}
 */
function calculateDaysSinceLastOrder(last_order_date) {
  if (!last_order_date) return 9999; // Large number for customers with no orders
  return daysBetween(last_order_date, new Date());
}

/**
 * Calculate quantile cutoffs for RFM scoring
 * @param {Array} values - Array of numbers
 * @param {number} numBuckets - Number of quantiles (default 5 for 1-5 scale)
 * @returns {Array} - Array of cutoff values
 */
function calculateQuantiles(values, numBuckets = 5) {
  if (!values || values.length === 0) return [];
  
  const sorted = [...values].sort((a, b) => a - b);
  const quantiles = [];
  
  for (let i = 1; i < numBuckets; i++) {
    const index = Math.floor((i / numBuckets) * sorted.length);
    quantiles.push(sorted[index]);
  }
  
  return quantiles;
}

/**
 * Assign score based on value and quantiles
 * @param {number} value 
 * @param {Array} quantiles 
 * @param {boolean} inverse - If true, lower values get higher scores (for recency)
 * @returns {number} - Score 1-5
 */
function assignScore(value, quantiles, inverse = false) {
  if (quantiles.length === 0) {
    // Fallback: simple rules
    if (inverse) {
      if (value <= 7) return 5;
      if (value <= 30) return 4;
      if (value <= 60) return 3;
      if (value <= 90) return 2;
      return 1;
    } else {
      return value > 0 ? 3 : 1; // Simple middle score for non-zero
    }
  }
  
  let score = 1;
  for (let i = 0; i < quantiles.length; i++) {
    if (inverse) {
      if (value <= quantiles[i]) {
        score = 5 - i;
        break;
      }
    } else {
      if (value > quantiles[i]) {
        score = i + 2;
      }
    }
  }
  
  if (!inverse && value > quantiles[quantiles.length - 1]) {
    score = 5;
  }
  if (inverse && value > quantiles[quantiles.length - 1]) {
    score = 1;
  }
  
  return score;
}

/**
 * Compute RFM scores for all customers
 * @param {Array} customers - Array of customer objects
 * @returns {Array} - Customers with r_score, f_score, m_score, rfm_score added
 */
function computeRFMScores(customers) {
  if (!customers || customers.length === 0) return customers;
  
  // Extract values for quantile calculation
  const recencyValues = customers.map(c => calculateDaysSinceLastOrder(c.last_order_date));
  const frequencyValues = customers.map(c => safeNumber(c.orders_count, 0));
  const monetaryValues = customers.map(c => safeNumber(c.total_spent, 0));
  
  // Calculate quantiles
  const recencyQuantiles = calculateQuantiles(recencyValues, 5);
  const frequencyQuantiles = calculateQuantiles(frequencyValues, 5);
  const monetaryQuantiles = calculateQuantiles(monetaryValues, 5);
  
  // Assign scores
  return customers.map(customer => {
    const days_since_last_order = calculateDaysSinceLastOrder(customer.last_order_date);
    const orders_count = safeNumber(customer.orders_count, 0);
    const total_spent = safeNumber(customer.total_spent, 0);
    
    const r_score = assignScore(days_since_last_order, recencyQuantiles, true); // Inverse: recent = high score
    const f_score = assignScore(orders_count, frequencyQuantiles, false);
    const m_score = assignScore(total_spent, monetaryQuantiles, false);
    const rfm_score = r_score + f_score + m_score;
    
    return {
      ...customer,
      days_since_last_order,
      r_score,
      f_score,
      m_score,
      rfm_score
    };
  });
}

/**
 * Assign customer segment based on RFM scores and behavior
 * @param {object} customer - Customer with rfm_score, r_score, f_score, orders_count, days_since_last_order
 * @returns {string} - Segment name
 */
function assignSegment(customer) {
  const rfm_score = safeNumber(customer.rfm_score, 0);
  const r_score = safeNumber(customer.r_score, 0);
  const f_score = safeNumber(customer.f_score, 0);
  const orders_count = safeNumber(customer.orders_count, 0);
  const days_since_last_order = safeNumber(customer.days_since_last_order, 9999);
  
  // New Customers: 1 order and recent activity
  if (orders_count === 1 && days_since_last_order <= 30) {
    return 'New';
  }
  
  // Lost Customers: haven't ordered in 90+ days
  if (days_since_last_order >= 90) {
    return 'Lost';
  }
  
  // Champions: High RFM score (13-15)
  if (rfm_score >= 13) {
    return 'Champions';
  }
  
  // Loyal: Good RFM score (10-12)
  if (rfm_score >= 10) {
    return 'Loyal';
  }
  
  // At Risk: Low recency but high frequency (bought often before, but not recently)
  if (r_score <= 2 && f_score >= 3) {
    return 'At Risk';
  }
  
  // Others: everyone else
  return 'Others';
}

/**
 * Compute all customer metrics including CLV, RFM, and segmentation
 * @param {Array} customers - Array of customer objects with order aggregates
 * @returns {Array} - Customers with all metrics computed
 */
function computeAllMetrics(customers) {
  if (!customers || customers.length === 0) return [];
  
  // Step 1: Calculate CLV for each customer
  let enriched = customers.map(customer => ({
    ...customer,
    clv: calculateCLV(customer),
    customer_lifespan_months: monthsBetween(customer.first_order_date, new Date()),
    purchase_frequency_per_month: safeNumber(customer.orders_count, 0) / 
      Math.max(1, monthsBetween(customer.first_order_date, new Date())),
    average_order_value: customer.orders_count > 0 ? 
      safeNumber(customer.total_spent, 0) / customer.orders_count : 0,
    repeat_buyer: safeNumber(customer.orders_count, 0) >= 2
  }));
  
  // Step 2: Compute RFM scores
  enriched = computeRFMScores(enriched);
  
  // Step 3: Assign segments
  enriched = enriched.map(customer => ({
    ...customer,
    segment: assignSegment(customer),
    churn_risk_score: calculateChurnRisk(customer)
  }));
  
  return enriched;
}

/**
 * Calculate churn risk score (0-100)
 * Based on days since last order and purchase frequency
 * @param {object} customer 
 * @returns {number} - Risk score 0-100
 */
function calculateChurnRisk(customer) {
  const days_since_last_order = safeNumber(customer.days_since_last_order, 9999);
  const orders_count = safeNumber(customer.orders_count, 0);
  
  if (orders_count === 0) return 100; // No orders = 100% risk
  if (days_since_last_order <= 7) return 0; // Ordered within week = 0% risk
  
  // Base risk on recency
  let risk = Math.min(100, (days_since_last_order / 90) * 100);
  
  // Adjust based on frequency (loyal customers get lower risk)
  if (orders_count >= 10) risk *= 0.7;
  else if (orders_count >= 5) risk *= 0.85;
  
  return Math.round(Math.min(100, Math.max(0, risk)));
}

/**
 * Calculate dataset-level KPIs
 * @param {Array} customers - Array of customers with metrics
 * @returns {object} - KPI object
 */
function calculateKPIs(customers) {
  if (!customers || customers.length === 0) {
    return {
      total_customers: 0,
      active_customers_30d: 0,
      repeat_customers: 0,
      lost_customers: 0,
      repeat_purchase_rate: 0,
      churn_rate: 0,
      average_clv: 0,
      total_customer_value: 0
    };
  }
  
  const total_customers = customers.length;
  const active_customers_30d = customers.filter(c => 
    safeNumber(c.days_since_last_order, 9999) <= 30
  ).length;
  const repeat_customers = customers.filter(c => 
    safeNumber(c.orders_count, 0) >= 2
  ).length;
  const lost_customers = customers.filter(c => 
    safeNumber(c.days_since_last_order, 9999) >= 90
  ).length;
  
  const customers_with_orders = customers.filter(c => safeNumber(c.orders_count, 0) > 0).length;
  const repeat_purchase_rate = customers_with_orders > 0 ? 
    (repeat_customers / customers_with_orders) * 100 : 0;
  const churn_rate = customers_with_orders > 0 ? 
    (lost_customers / customers_with_orders) * 100 : 0;
  
  const total_clv = customers.reduce((sum, c) => sum + safeNumber(c.clv, 0), 0);
  const average_clv = total_customers > 0 ? total_clv / total_customers : 0;
  
  return {
    total_customers,
    active_customers_30d,
    repeat_customers,
    lost_customers,
    repeat_purchase_rate: Math.round(repeat_purchase_rate * 10) / 10,
    churn_rate: Math.round(churn_rate * 10) / 10,
    average_clv: Math.round(average_clv * 100) / 100,
    total_customer_value: Math.round(total_clv * 100) / 100
  };
}

module.exports = {
  calculateCLV,
  calculateDaysSinceLastOrder,
  computeRFMScores,
  assignSegment,
  computeAllMetrics,
  calculateChurnRisk,
  calculateKPIs
};
