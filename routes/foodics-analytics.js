// routes/foodics-analytics.js
// Analytics endpoints that read from Cloud SQL database

const express = require('express');
const foodicsService = require('../services/foodicsService');

/**
 * Initialize analytics routes with database connection
 */
function initFoodicsAnalyticsRoutes(db) {
  const router = express.Router();
  
  // Helper to parse branches query parameter
  function parseBranchesParam(req) {
    const raw = req.query.branches;
    let branches = [];
    if (Array.isArray(raw)) {
      branches = raw.flatMap(s => (s || '').split(','));
    } else if (typeof raw === 'string') {
      branches = raw.split(',');
    }
    branches = branches.map(s => s && s.trim()).filter(Boolean);
    // Treat "All" as no filter
    const hasFilter = branches.length > 0 && !branches.some(b => /^all$/i.test(b));
    return { branches, hasFilter };
  }
  
  // Helper to parse types query parameter
  function parseTypesParam(req) {
    const raw = req.query.types;
    let types = [];
    if (Array.isArray(raw)) {
      types = raw.flatMap(s => (s || '').split(','));
    } else if (typeof raw === 'string') {
      types = raw.split(',');
    }
    types = types.map(s => s && s.trim()).filter(Boolean).map(t => parseInt(t)).filter(t => !isNaN(t));
    const hasFilter = types.length > 0;
    return { types, hasFilter };
  }
  
  // Helper to parse suppliers query parameter
  function parseSuppliersParam(req) {
    const raw = req.query.suppliers;
    let suppliers = [];
    if (Array.isArray(raw)) {
      suppliers = raw.flatMap(s => (s || '').split(','));
    } else if (typeof raw === 'string') {
      suppliers = raw.split(',');
    }
    suppliers = suppliers.map(s => s && s.trim()).filter(Boolean);
    // Treat "All" or empty as no filter
    const hasFilter = suppliers.length > 0 && !suppliers.some(s => /^all$/i.test(s));
    return { suppliers, hasFilter };
  }
  
  // Helper to get API token for a tenant
  async function getApiToken(foodics_id) {
    const result = await db(
      `SELECT meta->>'foodics_api_token' as api_token 
       FROM saas.tenants 
       WHERE foodics_id = $1`,
      [foodics_id]
    );
    
    // db() function returns rows array directly, not { rows: [] }
    if (!result || result.length === 0 || !result[0].api_token) {
      throw new Error('Foodics API token not configured');
    }
    
    return result[0].api_token;
  }
  
  /**
   * GET /api/foodics/analytics/sales-summary
   * Get sales summary with date range and filters from database
   * Query params: from, to, branch_id, status
   */
  router.get('/sales-summary', async (req, res) => {
    try {
      const { from, to, branch_id, status, foodics_id } = req.query;
      const { branches, hasFilter: hasBranchFilter } = parseBranchesParam(req);
      const { types, hasFilter: hasTypeFilter } = parseTypesParam(req);
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      if (!from || !to) {
        return res.status(400).json({ error: 'Date range (from, to) required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [foodics_id]
      );
      
      if (!tenantResult || tenantResult.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantResult[0].tenant_id;
      
      // Build query with branch and type filters
      const params = [tenant_id, from, to];
      let branchClause = '';
      let statusClause = '';
      let typeClause = '';
      
      if (hasBranchFilter) {
        params.push(branches);
        branchClause = `AND TRIM(split_part(meta->>'branch_name',' | ',2)) = ANY($${params.length}::text[])`;
      }
      
      if (hasTypeFilter) {
        params.push(types);
        typeClause = `AND type = ANY($${params.length}::integer[])`;
      }
      
      if (status) {
        params.push(parseInt(status));
        statusClause = `AND status = $${params.length}`;
      }
      
      // Fetch orders from database
      const orders = await db(`
        SELECT 
          id,
          business_date,
          created_at,
          total_price,
          subtotal_price,
          discount_amount,
          status,
          type
        FROM saas.foodics_orders
        WHERE tenant_id = $1
          AND business_date >= $2
          AND business_date <= $3
          ${branchClause}
          ${typeClause}
          ${statusClause}
        ORDER BY business_date DESC
      `, params);
      
      console.log(`[Analytics] Found ${orders.length} orders from database for ${from} to ${to}${hasBranchFilter ? ` (filtered by branches: ${branches.join(', ')})` : ''}${hasTypeFilter ? ` (filtered by types: ${types.join(', ')})` : ''}`);
      
      // Calculate summary
      const summary = foodicsService.calculateSalesSummary(orders);
      
      res.json({
        success: true,
        filters: { from, to, branch_id, status, branches: hasBranchFilter ? branches : null, types: hasTypeFilter ? types : null },
        summary
      });
      
    } catch (error) {
      console.error('Sales summary error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch sales summary', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/foodics/analytics/product-sales
   * Get product sales with aggregated metrics from database
   * Query params: from, to, branch_id, category_id, limit
   */
  router.get('/product-sales', async (req, res) => {
    try {
      const { from, to, branch_id, category_id, foodics_id, limit } = req.query;
      const { branches, hasFilter: hasBranchFilter } = parseBranchesParam(req);
      const { types, hasFilter: hasTypeFilter } = parseTypesParam(req);
      const { suppliers, hasFilter: hasSupplierFilter } = parseSuppliersParam(req);
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      if (!from || !to) {
        return res.status(400).json({ error: 'Date range (from, to) required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [foodics_id]
      );
      
      if (!tenantResult || tenantResult.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantResult[0].tenant_id;
      
      // Build query with branch, category, type, and supplier filters
      const params = [tenant_id, from, to];
      let categoryClause = '';
      let branchClause = '';
      let typeClause = '';
      let supplierClause = '';
      
      if (category_id) {
        params.push(category_id);
        categoryClause = `AND p.category_id = $${params.length}`;
      }
      
      if (hasBranchFilter) {
        params.push(branches);
        branchClause = `AND TRIM(split_part(o.meta->>'branch_name',' | ',2)) = ANY($${params.length}::text[])`;
      }
      
      if (hasTypeFilter) {
        params.push(types);
        typeClause = `AND o.type = ANY($${params.length}::integer[])`;
      }
      
      if (hasSupplierFilter) {
        params.push(suppliers);
        supplierClause = `AND p.supplier_name = ANY($${params.length}::text[])`;
      }
      
      // Query product sales - use SKU as primary identifier
      const productSalesResult = await db(`
        SELECT 
          COALESCE(oi.product_sku, 'unknown') as sku,
          COALESCE(p.name, oi.product_name, 'Unknown') as name,
          p.image,
          COALESCE(p.price, oi.unit_price) as price,
          p.cost,
          p.category_id,
          COALESCE(SUM(oi.quantity), 0)::integer as quantity_sold,
          COALESCE(SUM(oi.total_price), 0)::numeric as total_revenue,
          COALESCE(SUM(oi.quantity * COALESCE(p.cost, 0)), 0)::numeric as total_cost,
          COUNT(DISTINCT oi.order_id)::integer as orders_count,
          COALESCE(SUM(ic.production_waste_cost), 0)::numeric as production_waste_cost,
          COALESCE(SUM(ic.waste_from_order_cost), 0)::numeric as waste_from_order_cost,
          COALESCE(SUM(ic.production_waste_cost + ic.waste_from_order_cost), 0)::numeric as total_waste_cost
        FROM saas.foodics_order_items oi
        JOIN saas.foodics_orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
        LEFT JOIN saas.foodics_products p ON p.sku = oi.product_sku AND p.tenant_id = oi.tenant_id
        LEFT JOIN saas.foodics_inventory_control ic ON ic.sku = oi.product_sku AND ic.tenant_id = oi.tenant_id
        WHERE oi.tenant_id = $1
          AND o.business_date >= $2 
          AND o.business_date <= $3 
          AND o.status = 4
          AND oi.unit_price > 0
          ${categoryClause}
          ${branchClause}
          ${typeClause}
          ${supplierClause}
        GROUP BY oi.product_sku, p.name, oi.product_name, p.image, p.price, oi.unit_price, p.cost, p.category_id
        HAVING COALESCE(SUM(oi.quantity), 0) > 0
        ORDER BY quantity_sold DESC
      `, params);
      
      // Calculate previous period dates
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
      const prevTo = new Date(fromDate);
      prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setDate(prevFrom.getDate() - daysDiff + 1);
      
      const prev_from = prevFrom.toISOString().split('T')[0];
      const prev_to = prevTo.toISOString().split('T')[0];
      
      // Get branch breakdown for each product (current period)
      const productSkus = productSalesResult.map(p => p.sku);
      let branchBreakdowns = {};
      let branchBreakdownsPrev = {};
      
      if (productSkus.length > 0) {
        // Current period
        const branchParams = [tenant_id, from, to, productSkus];
        const branchData = await db(`
          SELECT 
            oi.product_sku as sku,
            TRIM(split_part(o.meta->>'branch_name',' | ',2)) as branch_name,
            SUM(oi.quantity)::integer as quantity
          FROM saas.foodics_order_items oi
          JOIN saas.foodics_orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND oi.product_sku = ANY($4::text[])
            AND o.meta->>'branch_name' IS NOT NULL
          GROUP BY oi.product_sku, branch_name
        `, branchParams);
        
        // Previous period
        const branchParamsPrev = [tenant_id, prev_from, prev_to, productSkus];
        const branchDataPrev = await db(`
          SELECT 
            oi.product_sku as sku,
            TRIM(split_part(o.meta->>'branch_name',' | ',2)) as branch_name,
            SUM(oi.quantity)::integer as quantity
          FROM saas.foodics_order_items oi
          JOIN saas.foodics_orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND oi.product_sku = ANY($4::text[])
            AND o.meta->>'branch_name' IS NOT NULL
          GROUP BY oi.product_sku, branch_name
        `, branchParamsPrev);
        
        // Organize current period by SKU
        branchData.forEach(row => {
          if (!branchBreakdowns[row.sku]) {
            branchBreakdowns[row.sku] = {};
          }
          if (row.branch_name) {
            branchBreakdowns[row.sku][row.branch_name] = row.quantity;
          }
        });
        
        // Organize previous period by SKU
        branchDataPrev.forEach(row => {
          if (!branchBreakdownsPrev[row.sku]) {
            branchBreakdownsPrev[row.sku] = {};
          }
          if (row.branch_name) {
            branchBreakdownsPrev[row.sku][row.branch_name] = row.quantity;
          }
        });
      }
      
      console.log(`[Analytics] Found ${productSalesResult.length} products with sales data${hasBranchFilter ? ` (filtered by branches: ${branches.join(', ')})` : ''}${hasTypeFilter ? ` (filtered by types: ${types.join(', ')})` : ''}${hasSupplierFilter ? ` (filtered by suppliers: ${suppliers.join(', ')})` : ''}`);
      
      // Format product sales with branch breakdown and waste data
      let productSales = productSalesResult.map(p => ({
        id: p.sku,
        name: p.name,
        sku: p.sku,
        image: p.image,
        price: parseFloat(p.price || 0),
        cost: parseFloat(p.cost || 0),
        category_id: p.category_id,
        quantity_sold: parseInt(p.quantity_sold || 0),
        total_revenue: parseFloat(p.total_revenue || 0),
        total_cost: parseFloat(p.total_cost || 0),
        orders_count: parseInt(p.orders_count || 0),
        production_waste_cost: parseFloat(p.production_waste_cost || 0),
        waste_from_order_cost: parseFloat(p.waste_from_order_cost || 0),
        total_waste_cost: parseFloat(p.total_waste_cost || 0),
        branch_breakdown: branchBreakdowns[p.sku] || null,
        branch_breakdown_prev: branchBreakdownsPrev[p.sku] || null
      }));
      
      // Apply limit if specified
      if (limit) {
        productSales = productSales.slice(0, parseInt(limit));
      }
      
      // Calculate total cost across all products
      const totalCost = productSales.reduce((sum, p) => sum + p.total_cost, 0);
      
      res.json({
        success: true,
        filters: { 
          from, 
          to, 
          prev_from, 
          prev_to, 
          branch_id, 
          category_id, 
          limit, 
          branches: hasBranchFilter ? branches : null,
          types: hasTypeFilter ? types : null,
          suppliers: hasSupplierFilter ? suppliers : null
        },
        products: productSales,
        total_products: productSales.length,
        total_cost: totalCost
      });
      
    } catch (error) {
      console.error('Product sales error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch product sales', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/foodics/analytics/customer-stats
   * Get customer statistics
   * Query params: from, to, branch_id
   */
  router.get('/customer-stats', async (req, res) => {
    try {
      const { from, to, branch_id, foodics_id } = req.query;
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      if (!from || !to) {
        return res.status(400).json({ error: 'Date range (from, to) required' });
      }
      
      // Get API token
      const apiToken = await getApiToken(foodics_id);
      const client = foodicsService.createClient(apiToken);
      
      // Fetch orders
      const allOrders = await client.getOrders({ branch_id });
      
      // Filter orders by date range (client-side)
      const orders = allOrders.filter(order => {
        const orderDate = order.business_date || order.created_at?.split('T')[0];
        return orderDate && orderDate >= from && orderDate <= to;
      });
      
      // Calculate customer stats
      const stats = foodicsService.calculateCustomerStats(orders);
      
      res.json({
        success: true,
        filters: { from, to, branch_id },
        stats
      });
      
    } catch (error) {
      console.error('Customer stats error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch customer stats', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/foodics/analytics/branches
   * Get list of branches from database (derived from orders)
   * Query params: foodics_id
   */
  router.get('/branches', async (req, res) => {
    try {
      const { foodics_id } = req.query;
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [foodics_id]
      );
      
      if (!tenantResult || tenantResult.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantResult[0].tenant_id;
      
      // Fetch distinct branches from orders
      const branchesResult = await db(`
        SELECT DISTINCT TRIM(split_part(meta->>'branch_name',' | ',2)) AS name
        FROM saas.foodics_orders
        WHERE tenant_id = $1
          AND meta->>'branch_name' IS NOT NULL
        ORDER BY name
      `, [tenant_id]);
      
      const branches = branchesResult.map(r => r.name).filter(Boolean);
      
      res.json({
        success: true,
        branches
      });
      
    } catch (error) {
      console.error('Branches error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch branches', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/foodics/analytics/categories
   * Get list of categories for dropdown filters
   * Query params: foodics_id
   */
  router.get('/categories', async (req, res) => {
    try {
      const { foodics_id } = req.query;
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      // Get API token
      const apiToken = await getApiToken(foodics_id);
      const client = foodicsService.createClient(apiToken);
      
      // Fetch categories
      const categories = await client.getCategories();
      
      res.json({
        success: true,
        categories: categories.map(c => ({
          id: c.id,
          name: c.name,
          parent_id: c.parent_id || null
        }))
      });
      
    } catch (error) {
      console.error('Categories error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch categories', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/foodics/analytics/suppliers
   * Get list of suppliers for dropdown filters (from product tags)
   * Query params: foodics_id
   */
  router.get('/suppliers', async (req, res) => {
    try {
      const { foodics_id } = req.query;
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [foodics_id]
      );
      
      if (!tenantResult || tenantResult.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantResult[0].tenant_id;
      
      // Get unique supplier names from products with Out-Source tag (case-insensitive)
      const suppliersResult = await db(`
        SELECT DISTINCT supplier_name
        FROM saas.foodics_products
        WHERE tenant_id = $1
          AND supplier_name IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM unnest(tags) AS tag
            WHERE LOWER(REPLACE(REPLACE(tag, '-', ''), ' ', '')) = 'outsource'
          )
        ORDER BY supplier_name
      `, [tenant_id]);
      
      res.json({
        success: true,
        suppliers: suppliersResult.map(s => ({
          name: s.supplier_name
        }))
      });
      
    } catch (error) {
      console.error('Suppliers error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch suppliers', 
        details: error.message 
      });
    }
  });
  
  /**
   * GET /api/foodics/analytics/branches-performance
   * Get comprehensive branch performance metrics
   * Query params: from, to, foodics_id
   */
  router.get('/branches-performance', async (req, res) => {
    try {
      const { from, to, foodics_id } = req.query;
      
      if (!foodics_id) {
        return res.status(400).json({ error: 'foodics_id required' });
      }
      
      if (!from || !to) {
        return res.status(400).json({ error: 'Date range (from, to) required' });
      }
      
      // Get tenant_id from foodics_id
      const tenantResult = await db(
        `SELECT tenant_id FROM saas.tenants WHERE foodics_id = $1`,
        [foodics_id]
      );
      
      if (!tenantResult || tenantResult.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      const tenant_id = tenantResult[0].tenant_id;
      
      // Calculate previous period dates
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const periodDays = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
      const prevFrom = new Date(fromDate);
      prevFrom.setDate(prevFrom.getDate() - periodDays);
      const prevTo = new Date(fromDate);
      prevTo.setDate(prevTo.getDate() - 1);
      
      const prevFromStr = prevFrom.toISOString().split('T')[0];
      const prevToStr = prevTo.toISOString().split('T')[0];
      
      // Fetch current period data by branch
      const currentBranches = await db(`
        SELECT 
          TRIM(split_part(o.meta->>'branch_name',' | ',2)) AS branch_name,
          COUNT(DISTINCT o.id) AS orders,
          COALESCE(SUM(o.total_price), 0)::numeric AS revenue
        FROM saas.foodics_orders o
        WHERE o.tenant_id = $1
          AND o.business_date >= $2
          AND o.business_date <= $3
          AND o.status = 4
          AND o.meta->>'branch_name' IS NOT NULL
        GROUP BY TRIM(split_part(o.meta->>'branch_name',' | ',2))
        ORDER BY revenue DESC
      `, [tenant_id, from, to]);
      
      // Fetch previous period data by branch
      const previousBranches = await db(`
        SELECT 
          TRIM(split_part(o.meta->>'branch_name',' | ',2)) AS branch_name,
          COUNT(DISTINCT o.id) AS orders,
          COALESCE(SUM(o.total_price), 0)::numeric AS revenue
        FROM saas.foodics_orders o
        WHERE o.tenant_id = $1
          AND o.business_date >= $2
          AND o.business_date <= $3
          AND o.status = 4
          AND o.meta->>'branch_name' IS NOT NULL
        GROUP BY TRIM(split_part(o.meta->>'branch_name',' | ',2))
      `, [tenant_id, prevFromStr, prevToStr]);
      
      // Create lookup map for previous data
      const prevMap = {};
      previousBranches.forEach(b => {
        prevMap[b.branch_name] = {
          orders: parseInt(b.orders),
          revenue: parseFloat(b.revenue)
        };
      });
      
      // Calculate total revenue for percentages
      const totalRevenue = currentBranches.reduce((sum, b) => sum + parseFloat(b.revenue), 0);
      const totalPrevRevenue = previousBranches.reduce((sum, b) => sum + parseFloat(b.revenue), 0);
      
      // Fetch top products for each branch
      const branches = await Promise.all(currentBranches.map(async (branch) => {
        const branchName = branch.branch_name;
        const prevData = prevMap[branchName] || { orders: 0, revenue: 0 };
        
        // Top products for this branch
        const topProducts = await db(`
          SELECT 
            p.name,
            COALESCE(SUM(oi.quantity), 0) AS quantity,
            COALESCE(SUM(oi.total_price), 0)::numeric AS revenue
          FROM saas.foodics_order_items oi
          JOIN saas.foodics_orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
          JOIN saas.foodics_products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND TRIM(split_part(o.meta->>'branch_name',' | ',2)) = $4
          GROUP BY p.id, p.name
          ORDER BY revenue DESC
          LIMIT 5
        `, [tenant_id, from, to, branchName]);
        
        // Sales by order type (current period)
        const orderTypesCurrent = await db(`
          SELECT 
            o.type,
            COALESCE(SUM(o.total_price), 0)::numeric AS revenue
          FROM saas.foodics_orders o
          WHERE o.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND o.type IS NOT NULL
            AND TRIM(split_part(o.meta->>'branch_name',' | ',2)) = $4
          GROUP BY o.type
        `, [tenant_id, from, to, branchName]);
        
        // Sales by order type (previous period)
        const orderTypesPrevious = await db(`
          SELECT 
            o.type,
            COALESCE(SUM(o.total_price), 0)::numeric AS revenue
          FROM saas.foodics_orders o
          WHERE o.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND o.type IS NOT NULL
            AND TRIM(split_part(o.meta->>'branch_name',' | ',2)) = $4
          GROUP BY o.type
        `, [tenant_id, prevFromStr, prevToStr, branchName]);
        
        // Create order types map
        const orderTypesMap = {};
        const prevTypesMap = {};
        
        orderTypesCurrent.forEach(t => {
          orderTypesMap[t.type] = parseFloat(t.revenue);
        });
        
        orderTypesPrevious.forEach(t => {
          prevTypesMap[t.type] = parseFloat(t.revenue);
        });
        
        // Merge current and previous for all types 1-4
        const orderTypes = {};
        for (let type = 1; type <= 4; type++) {
          orderTypes[type] = {
            current: orderTypesMap[type] || 0,
            previous: prevTypesMap[type] || 0
          };
        }
        
        // Peak time analysis (current period)
        const peakTimeCurrent = await db(`
          SELECT 
            EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') AS hour,
            COUNT(*) AS order_count
          FROM saas.foodics_orders o
          WHERE o.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND TRIM(split_part(o.meta->>'branch_name',' | ',2)) = $4
          GROUP BY hour
          ORDER BY order_count DESC
          LIMIT 1
        `, [tenant_id, from, to, branchName]);
        
        // Peak time analysis (previous period)
        const peakTimePrevious = await db(`
          SELECT 
            EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') AS hour,
            COUNT(*) AS order_count
          FROM saas.foodics_orders o
          WHERE o.tenant_id = $1
            AND o.business_date >= $2
            AND o.business_date <= $3
            AND o.status = 4
            AND TRIM(split_part(o.meta->>'branch_name',' | ',2)) = $4
          GROUP BY hour
          ORDER BY order_count DESC
          LIMIT 1
        `, [tenant_id, prevFromStr, prevToStr, branchName]);
        
        const formatHour = (hour) => {
          if (!hour && hour !== 0) return 'N/A';
          const h = parseInt(hour);
          if (h === 0) return '12 AM';
          if (h < 12) return `${h} AM`;
          if (h === 12) return '12 PM';
          return `${h - 12} PM`;
        };
        
        const currentPeakHour = peakTimeCurrent.length > 0 ? peakTimeCurrent[0].hour : null;
        const prevPeakHour = peakTimePrevious.length > 0 ? peakTimePrevious[0].hour : null;
        
        return {
          name: branchName,
          orders: parseInt(branch.orders),
          orders_prev: prevData.orders,
          revenue: parseFloat(branch.revenue),
          revenue_prev: prevData.revenue,
          percentage: totalRevenue > 0 ? (parseFloat(branch.revenue) / totalRevenue * 100) : 0,
          percentage_prev: totalPrevRevenue > 0 ? (prevData.revenue / totalPrevRevenue * 100) : 0,
          top_products: topProducts.map(p => ({
            name: p.name,
            quantity: parseInt(p.quantity),
            revenue: parseFloat(p.revenue)
          })),
          order_types: orderTypes,
          peak_time: {
            current: formatHour(currentPeakHour),
            previous: formatHour(prevPeakHour)
          }
        };
      }));
      
      // Calculate summary stats
      const totalOrders = branches.reduce((sum, b) => sum + b.orders, 0);
      const avgBranchRevenue = branches.length > 0 ? totalRevenue / branches.length : 0;
      
      res.json({
        success: true,
        filters: { from, to },
        summary: {
          total_revenue: totalRevenue,
          total_orders: totalOrders,
          branches_count: branches.length,
          avg_branch_revenue: avgBranchRevenue
        },
        branches
      });
      
    } catch (error) {
      console.error('Branches performance error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch branches performance', 
        details: error.message 
      });
    }
  });
  
  return router;
}

module.exports = initFoodicsAnalyticsRoutes;
