// services/datatechService.js
// Service for connecting to remote DataTech database and fetching customer data

const { Pool } = require('pg');

// Remote DataTech database connection pool
let remotePool = null;

/**
 * Initialize connection to DataTech remote database
 * @returns {Pool} - PostgreSQL pool
 */
function getRemotePool() {
  if (remotePool) return remotePool;
  
  const config = {
    host: process.env.DATATECH_DB_HOST || '34.72.158.144',
    port: parseInt(process.env.DATATECH_DB_PORT || '5432'),
    database: process.env.DATATECH_DB_NAME || 'postgres',
    user: process.env.DATATECH_DB_USER || 'ordertech',
    password: process.env.DATATECH_DB_PASS || 'Ordertech.2020',
    ssl: { rejectUnauthorized: false },
    max: 5, // Limit connections to remote DB
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
  
  remotePool = new Pool(config);
  
  remotePool.on('error', (err) => {
    console.error('[DataTech] Pool error:', err);
  });
  
  console.log('[DataTech] Remote pool initialized:', config.host);
  
  return remotePool;
}

/**
 * Execute query on remote DataTech database with retry logic
 * @param {string} sql 
 * @param {Array} params 
 * @param {number} retries 
 * @returns {Promise<Array>}
 */
async function queryRemote(sql, params = [], retries = 2) {
  const pool = getRemotePool();
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await pool.query(sql, params);
      return result.rows;
    } catch (error) {
      console.error(`[DataTech] Query error (attempt ${attempt + 1}/${retries + 1}):`, error.message);
      
      if (attempt === retries) {
        throw new Error(`DataTech query failed after ${retries + 1} attempts: ${error.message}`);
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

/**
 * Fetch customers from DataTech database since a given date
 * @param {Date|string} since - Fetch customers updated/created since this date
 * @returns {Promise<Array>} - Array of customer objects
 */
async function fetchCustomersSince(since) {
  const sinceDate = since || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // Default: 1 year ago
  
  try {
    console.log('[DataTech] Fetching customers since:', sinceDate);
    
    // Check if tblCustomers table exists
    const tableCheck = await queryRemote(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'tblCustomers'
      )
    `);
    
    if (!tableCheck[0]?.exists) {
      console.warn('[DataTech] tblCustomers table not found, returning empty array');
      return [];
    }
    
    // Fetch customers - adapt column names based on actual schema
    const customers = await queryRemote(`
      SELECT 
        id,
        name,
        phone,
        email,
        created_at,
        updated_at
      FROM "tblCustomers"
      WHERE (updated_at >= $1 OR created_at >= $1)
      ORDER BY updated_at DESC
    `, [sinceDate]);
    
    console.log(`[DataTech] Fetched ${customers.length} customers`);
    return customers;
    
  } catch (error) {
    console.error('[DataTech] fetchCustomersSince error:', error.message);
    
    // Return empty array on error to allow sync to continue with other sources
    return [];
  }
}

/**
 * Fetch order aggregates by customer from DataTech database
 * @param {Date|string} since - Fetch orders since this date
 * @returns {Promise<Array>} - Array of aggregated order data per customer
 */
async function fetchOrdersAggByCustomerSince(since) {
  const sinceDate = since || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  
  try {
    console.log('[DataTech] Fetching order aggregates since:', sinceDate);
    
    // Check if tables exist
    const tableCheck = await queryRemote(`
      SELECT 
        (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tblOrders')) as orders_exists,
        (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tblCustomers')) as customers_exists
    `);
    
    if (!tableCheck[0]?.orders_exists) {
      console.warn('[DataTech] tblOrders table not found, returning empty array');
      return [];
    }
    
    // Aggregate orders by customer - adapt based on actual schema
    // Assumes: tblOrders has columns: id, customer_id, customer_phone, total_price, order_date/created_at
    const aggregates = await queryRemote(`
      SELECT 
        c.id AS datatech_customer_id,
        COALESCE(c.phone, o.customer_phone) AS phone,
        COUNT(*) AS orders_count,
        SUM(COALESCE(o.total_price, o.total, o.amount, 0)) AS total_spent,
        MIN(COALESCE(o.order_date, o.created_at)) AS first_order_date,
        MAX(COALESCE(o.order_date, o.created_at)) AS last_order_date
      FROM "tblOrders" o
      LEFT JOIN "tblCustomers" c ON c.id = o.customer_id
      WHERE COALESCE(o.order_date, o.created_at) >= $1
      GROUP BY c.id, COALESCE(c.phone, o.customer_phone)
      HAVING COUNT(*) > 0
      ORDER BY total_spent DESC
    `, [sinceDate]);
    
    console.log(`[DataTech] Fetched ${aggregates.length} order aggregates`);
    return aggregates;
    
  } catch (error) {
    console.error('[DataTech] fetchOrdersAggByCustomerSince error:', error.message);
    return [];
  }
}

/**
 * Fetch top 3 products per customer from DataTech database
 * @param {Date|string} since - Fetch orders since this date
 * @returns {Promise<Array>} - Array of {phone, top_products} objects
 */
async function fetchTopProductsByCustomerSince(since) {
  const sinceDate = since || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  
  try {
    console.log('[DataTech] Fetching top products since:', sinceDate);
    
    // Check if required tables exist
    const tableCheck = await queryRemote(`
      SELECT 
        (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tblOrderProducts')) as order_products_exists,
        (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tblProducts')) as products_exists
    `);
    
    if (!tableCheck[0]?.order_products_exists) {
      console.warn('[DataTech] tblOrderProducts table not found, returning empty array');
      return [];
    }
    
    // Fetch top 3 products per customer
    // Assumes: tblOrderProducts has columns: order_id, product_id, quantity
    // Assumes: tblProducts has columns: id, name
    const topProducts = await queryRemote(`
      WITH customer_products AS (
        SELECT 
          COALESCE(c.phone, o.customer_phone) AS phone,
          p.name AS product_name,
          SUM(COALESCE(op.quantity, op.qty, 1)) AS total_quantity
        FROM "tblOrders" o
        LEFT JOIN "tblCustomers" c ON c.id = o.customer_id
        JOIN "tblOrderProducts" op ON op.order_id = o.id
        LEFT JOIN "tblProducts" p ON p.id = op.product_id
        WHERE COALESCE(o.order_date, o.created_at) >= $1
        GROUP BY COALESCE(c.phone, o.customer_phone), p.name
      ),
      ranked_products AS (
        SELECT 
          phone,
          product_name,
          total_quantity,
          ROW_NUMBER() OVER (PARTITION BY phone ORDER BY total_quantity DESC) AS rank
        FROM customer_products
      )
      SELECT 
        phone,
        ARRAY_AGG(product_name ORDER BY rank) AS top_products
      FROM ranked_products
      WHERE rank <= 3
      GROUP BY phone
    `, [sinceDate]);
    
    console.log(`[DataTech] Fetched top products for ${topProducts.length} customers`);
    return topProducts;
    
  } catch (error) {
    console.error('[DataTech] fetchTopProductsByCustomerSince error:', error.message);
    return [];
  }
}

/**
 * Test connection to DataTech database
 * @returns {Promise<boolean>}
 */
async function testConnection() {
  try {
    const result = await queryRemote('SELECT current_database() as db, NOW() as time');
    console.log('[DataTech] Connection test successful:', result[0]);
    return true;
  } catch (error) {
    console.error('[DataTech] Connection test failed:', error.message);
    return false;
  }
}

/**
 * Close the remote pool connection
 */
async function closePool() {
  if (remotePool) {
    await remotePool.end();
    remotePool = null;
    console.log('[DataTech] Pool closed');
  }
}

module.exports = {
  fetchCustomersSince,
  fetchOrdersAggByCustomerSince,
  fetchTopProductsByCustomerSince,
  testConnection,
  closePool,
  queryRemote // Export for advanced usage
};
