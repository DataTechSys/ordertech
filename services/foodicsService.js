// services/foodicsService.js
// Service for fetching and aggregating Foodics data directly from API

const axios = require('axios');

const FOODICS_API_BASE = 'https://api.foodics.com/v5';

/**
 * Create a Foodics API client with authentication
 */
function createClient(apiToken) {
  return {
    /**
     * Fetch orders from Foodics API with filters
     * @param {Object} filters - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', branch_id: 'uuid', status: 1-4 }
     */
    async getOrders(filters = {}) {
      const params = {
        per_page: 100,
        page: 1
      };
      
      // Foodics API doesn't support date ranges in filter[business_date]
      // We'll fetch all orders and filter client-side by date range
      // For better performance, we limit to last 1000 orders (10 pages)
      
      if (filters.branch_id) {
        params['filter[branch_id]'] = filters.branch_id;
      }
      
      if (filters.status) {
        params['filter[status]'] = filters.status;
      }
      
      const allOrders = [];
      let hasMore = true;
      const MAX_PAGES = 10; // Limit to 10 pages (~1000 orders) to avoid rate limits
      
      while (hasMore && params.page <= MAX_PAGES) {
        const response = await axios.get(`${FOODICS_API_BASE}/orders`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json'
          },
          params
        });
        
        const data = response.data.data || [];
        allOrders.push(...data);
        
        // Check if there are more pages
        const meta = response.data.meta;
        if (meta && meta.current_page < meta.last_page) {
          params.page++;
        } else {
          hasMore = false;
        }
      }
      
      return allOrders;
    },
    
    /**
     * Fetch products from Foodics API
     */
    async getProducts(filters = {}) {
      const params = {
        per_page: 100,
        page: 1
      };
      
      if (filters.category_id) {
        params['filter[category_id]'] = filters.category_id;
      }
      
      const allProducts = [];
      let hasMore = true;
      
      while (hasMore) {
        const response = await axios.get(`${FOODICS_API_BASE}/products`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json'
          },
          params
        });
        
        const data = response.data.data || [];
        allProducts.push(...data);
        
        const meta = response.data.meta;
        if (meta && meta.current_page < meta.last_page) {
          params.page++;
        } else {
          hasMore = false;
        }
      }
      
      return allProducts;
    },
    
    /**
     * Fetch categories from Foodics API
     */
    async getCategories() {
      const response = await axios.get(`${FOODICS_API_BASE}/categories`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json'
        },
        params: {
          per_page: 100
        }
      });
      
      return response.data.data || [];
    },
    
    /**
     * Fetch branches from Foodics API
     */
    async getBranches() {
      const response = await axios.get(`${FOODICS_API_BASE}/branches`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json'
        },
        params: {
          per_page: 100
        }
      });
      
      return response.data.data || [];
    },
    
    /**
     * Fetch a single order with details (including order_items)
     */
    async getOrder(orderId) {
      const response = await axios.get(`${FOODICS_API_BASE}/orders/${orderId}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json'
        }
      });
      
      return response.data.data || {};
    },
    
    /**
     * Fetch customers from Foodics API
     */
    async getCustomers(filters = {}) {
      const params = {
        per_page: 100,
        page: 1
      };
      
      const allCustomers = [];
      let hasMore = true;
      
      while (hasMore && params.page <= 10) { // Limit to 10 pages (1000 customers) for performance
        const response = await axios.get(`${FOODICS_API_BASE}/customers`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json'
          },
          params
        });
        
        const data = response.data.data || [];
        allCustomers.push(...data);
        
        const meta = response.data.meta;
        if (meta && meta.current_page < meta.last_page) {
          params.page++;
        } else {
          hasMore = false;
        }
      }
      
      return allCustomers;
    },
    
    /**
     * Fetch inventory transactions from Foodics API (includes waste data)
     * Type 10 = Waste from Order, Type 12 = Waste from production
     * @param {Object} filters - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', type: [10, 12], branch_id: 'uuid' }
     */
    async getInventoryTransactions(filters = {}) {
      const params = {
        per_page: 100,
        page: 1
      };
      
      // Filter by transaction type (waste types: 10, 12)
      if (filters.type) {
        if (Array.isArray(filters.type)) {
          // Foodics API accepts comma-separated types
          params['filter[type]'] = filters.type.join(',');
        } else {
          params['filter[type]'] = filters.type;
        }
      }
      
      if (filters.branch_id) {
        params['filter[branch_id]'] = filters.branch_id;
      }
      
      // Date range filter
      if (filters.from) {
        params['filter[created_at][gte]'] = filters.from;
      }
      if (filters.to) {
        params['filter[created_at][lte]'] = filters.to + 'T23:59:59';
      }
      
      const allTransactions = [];
      let hasMore = true;
      const MAX_PAGES = 50; // Limit to avoid rate limits
      
      while (hasMore && params.page <= MAX_PAGES) {
        const response = await axios.get(`${FOODICS_API_BASE}/inventory_transactions`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json'
          },
          params
        });
        
        const data = response.data.data || [];
        allTransactions.push(...data);
        
        console.log(`[Foodics] Fetched page ${params.page}: ${data.length} transactions`);
        
        const meta = response.data.meta;
        if (meta && meta.current_page < meta.last_page) {
          params.page++;
        } else {
          hasMore = false;
        }
      }
      
      return allTransactions;
    }
  };
}

/**
 * Calculate sales summary from orders
 */
function calculateSalesSummary(orders) {
  const summary = {
    total_orders: orders.length,
    total_revenue: 0,
    total_discount: 0,
    total_tax: 0,
    avg_order_value: 0,
    orders_by_status: {},
    orders_by_type: {},
    orders_by_day: {}
  };
  
  orders.forEach(order => {
    // Net Sales = Subtotal - Discount (matching Foodics report)
    const subtotal = parseFloat(order.subtotal_price || 0);
    const discount = parseFloat(order.discount_amount || 0);
    const net_sales = subtotal - discount;
    
    summary.total_revenue += net_sales;
    summary.total_discount += discount;
    
    // Calculate tax (if available in meta)
    const total = parseFloat(order.total_price || 0);
    summary.total_tax += Math.max(0, total - net_sales);
    
    // By status
    const status = order.status || 0;
    summary.orders_by_status[status] = (summary.orders_by_status[status] || 0) + 1;
    
    // By type
    const type = order.type || 0;
    summary.orders_by_type[type] = (summary.orders_by_type[type] || 0) + 1;
    
    // By day
    const day = order.business_date || order.created_at?.split('T')[0] || 'unknown';
    if (!summary.orders_by_day[day]) {
      summary.orders_by_day[day] = { count: 0, revenue: 0 };
    }
    summary.orders_by_day[day].count++;
    summary.orders_by_day[day].revenue += net_sales;
  });
  
  // Calculate average
  summary.avg_order_value = summary.total_orders > 0 
    ? summary.total_revenue / summary.total_orders 
    : 0;
  
  return summary;
}

/**
 * Calculate product sales from orders
 */
function calculateProductSales(orders, products) {
  const productMap = new Map();
  
  // Create product lookup map
  products.forEach(product => {
    productMap.set(product.id, {
      id: product.id,
      name: product.name,
      sku: product.sku,
      image: product.image?.url || product.image || null,
      category_id: product.category_id,
      category_name: product.category?.name || null,
      barcode: product.barcode,
      price: parseFloat(product.price || 0),
      quantity_sold: 0,
      total_revenue: 0,
      orders_count: 0
    });
  });
  
  // Aggregate sales from orders
  orders.forEach(order => {
    const orderItems = order.order_items || [];
    
    orderItems.forEach(item => {
      const productId = item.product_id;
      
      if (productMap.has(productId)) {
        const product = productMap.get(productId);
        product.quantity_sold += parseInt(item.quantity || 0);
        product.total_revenue += parseFloat(item.total_price || 0);
        product.orders_count++;
      } else {
        // Product not in map, create minimal entry
        productMap.set(productId, {
          id: productId,
          name: item.product_name || 'Unknown Product',
          sku: item.sku || null,
          image: null,
          category_id: null,
          category_name: null,
          barcode: null,
          price: parseFloat(item.unit_price || 0),
          quantity_sold: parseInt(item.quantity || 0),
          total_revenue: parseFloat(item.total_price || 0),
          orders_count: 1
        });
      }
    });
  });
  
  // Convert map to sorted array
  const productSales = Array.from(productMap.values())
    .filter(p => p.quantity_sold > 0)
    .sort((a, b) => b.total_revenue - a.total_revenue);
  
  return productSales;
}

/**
 * Calculate customer statistics from orders
 */
function calculateCustomerStats(orders) {
  const customerMap = new Map();
  
  orders.forEach(order => {
    const customerId = order.customer_id;
    
    if (customerId) {
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          customer_id: customerId,
          orders_count: 0,
          total_spent: 0,
          avg_order_value: 0,
          first_order_date: order.business_date || order.created_at,
          last_order_date: order.business_date || order.created_at
        });
      }
      
      const customer = customerMap.get(customerId);
      customer.orders_count++;
      customer.total_spent += parseFloat(order.total_price || 0);
      
      // Update dates
      const orderDate = order.business_date || order.created_at;
      if (orderDate < customer.first_order_date) {
        customer.first_order_date = orderDate;
      }
      if (orderDate > customer.last_order_date) {
        customer.last_order_date = orderDate;
      }
    }
  });
  
  // Calculate averages and convert to array
  const customerStats = Array.from(customerMap.values()).map(c => ({
    ...c,
    avg_order_value: c.orders_count > 0 ? c.total_spent / c.orders_count : 0
  }));
  
  // Sort by total spent
  customerStats.sort((a, b) => b.total_spent - a.total_spent);
  
  return {
    total_customers: customerStats.length,
    customers: customerStats.slice(0, 100), // Top 100
    total_spent_all: customerStats.reduce((sum, c) => sum + c.total_spent, 0),
    avg_orders_per_customer: customerStats.length > 0 
      ? customerStats.reduce((sum, c) => sum + c.orders_count, 0) / customerStats.length 
      : 0
  };
}

/**
 * Normalize Foodics customer data
 * @param {object} customer - Raw Foodics customer object
 * @returns {object} - Normalized customer
 */
function normalizeFoodicsCustomer(customer) {
  const { normalizePhone, parseFoodicsUniqueIdFromName } = require('../lib/customerMerge');
  
  return {
    foodics_id: customer.id || null,
    foodics_unique_id: parseFoodicsUniqueIdFromName(customer.name),
    name: customer.name || null,
    phone_raw: customer.phone || null,
    phone_normalized: normalizePhone(customer.phone),
    email: customer.email || null
  };
}

module.exports = {
  createClient,
  calculateSalesSummary,
  calculateProductSales,
  calculateCustomerStats,
  normalizeFoodicsCustomer
};
