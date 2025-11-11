// routes/customer-analytics.js
// Customer analytics API endpoints

const express = require('express');

/**
 * Initialize customer analytics routes
 * @param {Function} db - Database query function
 * @returns {Router} - Express router
 */
function initCustomerAnalyticsRoutes(db) {
  const router = express.Router();
  
  /**
   * GET /api/customers/analytics/summary
   * Returns overall customer analytics summary
   */
  router.get('/summary', async (req, res) => {
    try {
      const { segment } = req.query;
      
      let whereClause = '';
      const params = [];
      
      if (segment && segment !== 'all') {
        params.push(segment);
        whereClause = `WHERE segment = $${params.length}`;
      }
      
      const summary = await db(`
        SELECT 
          COUNT(*) as total_customers,
          COUNT(*) FILTER (WHERE days_since_last_order <= 30) as active_customers_30d,
          COUNT(*) FILTER (WHERE DATE_TRUNC('month', first_order_date) = DATE_TRUNC('month', CURRENT_DATE)) as new_customers_this_month,
          COUNT(*) FILTER (WHERE repeat_buyer = true) as repeat_customers,
          AVG(clv)::numeric(14,2) as average_clv,
          SUM(clv)::numeric(14,2) as total_customer_value,
          AVG(total_spent)::numeric(14,2) as average_total_spent,
          ROUND(
            (COUNT(*) FILTER (WHERE repeat_buyer = true)::numeric / NULLIF(COUNT(*), 0) * 100),
            1
          ) as repeat_purchase_rate,
          ROUND(
            (COUNT(*) FILTER (WHERE days_since_last_order >= 90)::numeric / NULLIF(COUNT(*), 0) * 100),
            1
          ) as churn_rate
        FROM customer_analytics
        ${whereClause}
      `, params);
      
      // Calculate retention rate (active customers / total customers)
      const result = summary[0];
      result.retention_rate = result.total_customers > 0 ? 
        ((result.active_customers_30d / result.total_customers) * 100).toFixed(1) : 0;
      
      res.json({
        success: true,
        summary: result
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Summary error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch summary', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/customers/analytics/detail/:id
   * Returns detailed customer profile with order history and behavior analysis
   */
  router.get('/detail/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get customer profile
      const customer = await db(`
        SELECT *
        FROM customer_analytics
        WHERE id = $1
      `, [id]);
      
      if (customer.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      
      const profile = customer[0];
      
      // Get order history from foodics_orders
      const phoneConditions = [];
      const phoneParams = [];
      
      if (profile.phone_normalized) {
        phoneParams.push(profile.phone_normalized);
        phoneConditions.push(`meta->>'customer_phone' = $${phoneParams.length}`);
      }
      if (profile.phone_raw) {
        phoneParams.push(profile.phone_raw);
        phoneConditions.push(`meta->>'customer_phone' = $${phoneParams.length}`);
      }
      
      let orders = [];
      if (phoneConditions.length > 0) {
        orders = await db(`
          SELECT 
            id,
            business_date,
            closed_at,
            total_price,
            type,
            status,
            meta->>'branch_name' as branch_name,
            meta->>'customer_name' as customer_name,
            meta->'products' as products
          FROM foodics_orders
          WHERE (${phoneConditions.join(' OR ')})
            AND status = 4
          ORDER BY closed_at DESC
          LIMIT 100
        `, phoneParams);
      }
      
      // Analyze order patterns
      const orderAnalysis = {
        total_orders: orders.length,
        date_range: orders.length > 0 ? {
          first: orders[orders.length - 1]?.closed_at,
          last: orders[0]?.closed_at
        } : null,
        
        // Order types distribution
        by_type: orders.reduce((acc, order) => {
          const typeMap = { 1: 'Dine-in', 2: 'Pickup', 3: 'Delivery', 4: 'Drive-thru' };
          const typeName = typeMap[order.type] || 'Other';
          acc[typeName] = (acc[typeName] || 0) + 1;
          return acc;
        }, {}),
        
        // Branch distribution
        by_branch: orders.reduce((acc, order) => {
          const branch = order.branch_name || 'Unknown';
          acc[branch] = (acc[branch] || 0) + 1;
          return acc;
        }, {}),
        
        // Time patterns (hour of day)
        by_hour: orders.reduce((acc, order) => {
          if (order.closed_at) {
            const hour = new Date(order.closed_at).getHours();
            acc[hour] = (acc[hour] || 0) + 1;
          }
          return acc;
        }, {}),
        
        // Day of week patterns
        by_day_of_week: orders.reduce((acc, order) => {
          if (order.closed_at) {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const day = days[new Date(order.closed_at).getDay()];
            acc[day] = (acc[day] || 0) + 1;
          }
          return acc;
        }, {}),
        
        // Monthly spending trend
        monthly_spending: orders.reduce((acc, order) => {
          if (order.closed_at && order.total_price) {
            const month = new Date(order.closed_at).toISOString().substring(0, 7); // YYYY-MM
            acc[month] = (acc[month] || 0) + parseFloat(order.total_price);
          }
          return acc;
        }, {})
      };
      
      // Extract and analyze products
      const productFrequency = {};
      const categoryFrequency = {};
      
      orders.forEach(order => {
        if (order.products && Array.isArray(order.products)) {
          order.products.forEach(product => {
            const name = product.name || 'Unknown';
            const category = product.category_name || 'Uncategorized';
            const quantity = product.quantity || 1;
            
            productFrequency[name] = (productFrequency[name] || 0) + quantity;
            categoryFrequency[category] = (categoryFrequency[category] || 0) + quantity;
          });
        }
      });
      
      // Sort products by frequency
      const topProducts = Object.entries(productFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name, count]) => ({ name, count }));
      
      const topCategories = Object.entries(categoryFrequency)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
      
      // Peak ordering time
      const hourEntries = Object.entries(orderAnalysis.by_hour);
      const peakHour = hourEntries.length > 0 
        ? hourEntries.reduce((a, b) => a[1] > b[1] ? a : b)[0]
        : null;
      
      res.json({
        success: true,
        customer: {
          profile,
          orders: orders.slice(0, 20), // Recent 20 orders
          analysis: {
            ...orderAnalysis,
            top_products: topProducts,
            top_categories: topCategories,
            peak_hour: peakHour ? `${peakHour}:00` : null
          }
        }
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Detail error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch customer details', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/customers/analytics/list
   * Returns paginated, filterable list of customers
   */
  router.get('/list', async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        search = '',
        segment,
        minClv,
        maxClv,
        minOrders,
        maxOrders,
        lastOrderFrom,
        lastOrderTo,
        sort = 'total_spent',
        direction = 'DESC'
      } = req.query;
      
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const whereConditions = [];
      const params = [];
      
      // Search by name or phone
      if (search) {
        params.push(`%${search}%`, `%${search}%`);
        whereConditions.push(`(name ILIKE $${params.length - 1} OR phone_raw ILIKE $${params.length})`);
      }
      
      // Segment filter
      if (segment && segment !== 'all') {
        params.push(segment);
        whereConditions.push(`segment = $${params.length}`);
      }
      
      // CLV range
      if (minClv) {
        params.push(parseFloat(minClv));
        whereConditions.push(`clv >= $${params.length}`);
      }
      if (maxClv) {
        params.push(parseFloat(maxClv));
        whereConditions.push(`clv <= $${params.length}`);
      }
      
      // Orders count range
      if (minOrders) {
        params.push(parseInt(minOrders));
        whereConditions.push(`orders_count >= $${params.length}`);
      }
      if (maxOrders) {
        params.push(parseInt(maxOrders));
        whereConditions.push(`orders_count <= $${params.length}`);
      }
      
      // Last order date range
      if (lastOrderFrom) {
        params.push(lastOrderFrom);
        whereConditions.push(`last_order_date >= $${params.length}`);
      }
      if (lastOrderTo) {
        params.push(lastOrderTo);
        whereConditions.push(`last_order_date <= $${params.length}`);
      }
      
      const whereClause = whereConditions.length > 0 ? 
        `WHERE ${whereConditions.join(' AND ')}` : '';
      
      // Validate sort column
      const allowedSortColumns = [
        'name', 'orders_count', 'total_spent', 'average_order_value',
        'last_order_date', 'days_since_last_order', 'clv', 'rfm_score'
      ];
      const sortColumn = allowedSortColumns.includes(sort) ? sort : 'total_spent';
      const sortDirection = direction.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      // Get total count
      const countResult = await db(`
        SELECT COUNT(*) as total
        FROM customer_analytics
        ${whereClause}
      `, params);
      
      const total = parseInt(countResult[0].total);
      
      // Get customers
      params.push(parseInt(limit), offset);
      const customers = await db(`
        SELECT 
          id,
          merge_key,
          name,
          phone_raw,
          phone_normalized,
          email,
          orders_count,
          total_spent,
          average_order_value,
          last_order_date,
          days_since_last_order,
          clv,
          segment,
          rfm_score,
          r_score,
          f_score,
          m_score,
          churn_risk_score,
          preferred_products,
          preferred_branch_id,
          source,
          has_foodics,
          has_datatech,
          first_order_date
        FROM customer_analytics
        ${whereClause}
        ORDER BY ${sortColumn} ${sortDirection}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);
      
      res.json({
        success: true,
        customers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          total_pages: Math.ceil(total / parseInt(limit))
        }
      });
      
    } catch (error) {
      console.error('[Customer Analytics] List error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch customers', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/customers/analytics/segments
   * Returns customer count by segment
   */
  router.get('/segments', async (req, res) => {
    try {
      const segments = await db(`
        SELECT 
          segment,
          COUNT(*) as count,
          AVG(clv)::numeric(14,2) as avg_clv,
          SUM(total_spent)::numeric(14,2) as total_spent
        FROM customer_analytics
        WHERE segment IS NOT NULL
        GROUP BY segment
        ORDER BY count DESC
      `);
      
      // Segment definitions
      const definitions = {
        'Champions': 'High RFM score (13-15) - Your best customers',
        'Loyal': 'Good RFM score (10-12) - Consistently buy from you',
        'At Risk': 'Were frequent buyers but haven\'t purchased recently',
        'New': 'Made their first purchase within last 30 days',
        'Lost': 'Haven\'t purchased in 90+ days',
        'Others': 'Need attention to improve engagement'
      };
      
      res.json({
        success: true,
        segments: segments.map(s => ({
          ...s,
          definition: definitions[s.segment] || ''
        }))
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Segments error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch segments', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/customers/analytics/top-customers
   * Returns top customers by total spent or CLV
   */
  router.get('/top-customers', async (req, res) => {
    try {
      const { limit = 10, sortBy = 'total_spent' } = req.query;
      
      const sortColumn = sortBy === 'clv' ? 'clv' : 'total_spent';
      
      const topCustomers = await db(`
        SELECT 
          name,
          phone_raw,
          orders_count,
          total_spent,
          average_order_value,
          clv,
          segment,
          last_order_date,
          days_since_last_order
        FROM customer_analytics
        ORDER BY ${sortColumn} DESC
        LIMIT $1
      `, [parseInt(limit)]);
      
      res.json({
        success: true,
        top_customers: topCustomers,
        sort_by: sortColumn
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Top customers error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch top customers', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/customers/analytics/trends
   * Returns trend data for charts
   */
  router.get('/trends', async (req, res) => {
    try {
      const { metric = 'acquisition' } = req.query;
      
      let data = [];
      
      switch (metric) {
        case 'acquisition':
          // New customers by month
          data = await db(`
            SELECT 
              DATE_TRUNC('month', first_order_date) as month,
              COUNT(*) as customers
            FROM customer_analytics
            WHERE first_order_date IS NOT NULL
              AND first_order_date >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', first_order_date)
            ORDER BY month
          `);
          break;
          
        case 'clv_distribution':
          // CLV distribution histogram
          data = await db(`
            SELECT 
              CASE 
                WHEN clv <= 100 THEN '0-100'
                WHEN clv <= 500 THEN '101-500'
                WHEN clv <= 1000 THEN '501-1000'
                WHEN clv <= 2000 THEN '1001-2000'
                ELSE '2000+'
              END as clv_range,
              COUNT(*) as count
            FROM customer_analytics
            WHERE clv > 0
            GROUP BY clv_range
            ORDER BY 
              CASE clv_range
                WHEN '0-100' THEN 1
                WHEN '101-500' THEN 2
                WHEN '501-1000' THEN 3
                WHEN '1001-2000' THEN 4
                ELSE 5
              END
          `);
          break;
          
        case 'purchase_frequency':
          // Purchase frequency distribution
          data = await db(`
            SELECT 
              CASE 
                WHEN orders_count = 1 THEN '1'
                WHEN orders_count BETWEEN 2 AND 5 THEN '2-5'
                WHEN orders_count BETWEEN 6 AND 10 THEN '6-10'
                WHEN orders_count BETWEEN 11 AND 20 THEN '11-20'
                ELSE '20+'
              END as order_range,
              COUNT(*) as count
            FROM customer_analytics
            GROUP BY order_range
            ORDER BY 
              CASE order_range
                WHEN '1' THEN 1
                WHEN '2-5' THEN 2
                WHEN '6-10' THEN 3
                WHEN '11-20' THEN 4
                ELSE 5
              END
          `);
          break;
          
        default:
          return res.status(400).json({ 
            error: 'Invalid metric',
            allowed: ['acquisition', 'clv_distribution', 'purchase_frequency']
          });
      }
      
      res.json({
        success: true,
        metric,
        data
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Trends error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch trends', 
        details: error.message 
      });
    }
  });
  
  /**
   * POST /api/customers/analytics/sync
   * Trigger customer analytics sync job (protected)
   */
  router.post('/sync', async (req, res) => {
    try {
      // Check authorization
      const token = req.headers['x-sync-token'] || req.query.token;
      const expectedToken = process.env.SYNC_INTERNAL_TOKEN;
      
      if (!expectedToken || token !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const mode = req.query.mode || 'incremental';
      
      // Import and run sync job
      const syncCustomerAnalytics = require('../jobs/sync-customer-analytics');
      
      console.log(`[API] Triggering customer analytics sync (mode: ${mode})`);
      
      const result = await syncCustomerAnalytics(db, mode);
      
      res.json({
        success: result.success,
        ...result
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Sync trigger error:', error);
      res.status(500).json({ 
        error: 'Failed to trigger sync', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/customers/analytics/health
   * Health check and last sync status
   */
  router.get('/health', async (req, res) => {
    try {
      const stats = await db(`
        SELECT 
          COUNT(*) as total_customers,
          MAX(last_synced_at) as last_sync_time,
          COUNT(*) FILTER (WHERE last_synced_at > NOW() - INTERVAL '24 hours') as synced_last_24h
        FROM customer_analytics
      `);
      
      res.json({
        success: true,
        healthy: true,
        ...stats[0]
      });
      
    } catch (error) {
      console.error('[Customer Analytics] Health check error:', error);
      res.status(500).json({ 
        error: 'Health check failed', 
        details: error.message 
      });
    }
  });
  
  return router;
}

module.exports = initCustomerAnalyticsRoutes;
