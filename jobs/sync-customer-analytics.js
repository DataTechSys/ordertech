#!/usr/bin/env node
// jobs/sync-customer-analytics.js
// Sync customer analytics from Foodics and DataTech

const { normalizePhone, parseFoodicsUniqueIdFromName, buildMergeKey, mergeCustomerRecords, safeDate } = require('../lib/customerMerge');
const { computeAllMetrics } = require('../lib/metrics');
const { calculateOrderMetrics } = require('../lib/orderMetrics');
const datatechService = require('../services/datatechService');
const foodicsService = require('../services/foodicsService');

/**
 * Sync customer analytics - main job function
 * @param {Function} db - Database query function
 * @param {string} mode - 'full' or 'incremental'
 * @returns {Promise<object>} - Job result
 */
async function syncCustomerAnalytics(db, mode = 'incremental') {
  const startTime = Date.now();
  console.log(`\n========================================`);
  console.log(`[Sync] Customer Analytics Sync Started`);
  console.log(`[Sync] Mode: ${mode}`);
  console.log(`[Sync] Time: ${new Date().toISOString()}`);
  console.log(`========================================\n`);
  
  try {
    // 1. Determine time window
    const since = mode === 'full' ? 
      new Date(Date.now() - 730 * 24 * 60 * 60 * 1000) : // 2 years for full backfill
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days for incremental (safety window)
    
    console.log(`[Sync] Fetching data since: ${since.toISOString()}`);
    
    // 2. Get Foodics API token from database
    console.log(`[Sync] Retrieving Foodics API token...`);
    const tenantResult = await db(`
      SELECT meta->>'foodics_api_token' as api_token 
      FROM saas.tenants 
      WHERE foodics_id = '494675'
      LIMIT 1
    `);
    
    if (!tenantResult || tenantResult.length === 0 || !tenantResult[0].api_token) {
      throw new Error('Foodics API token not configured');
    }
    
    const apiToken = tenantResult[0].api_token;
    const foodicsClient = foodicsService.createClient(apiToken);
    
    // 3. Fetch data from all sources in parallel
    console.log(`[Sync] Fetching from multiple sources...`);
    
    const [
      foodicsCustomersRaw,
      datatechCustomersRaw,
      datatechOrdersRaw,
      datatechProductsRaw
    ] = await Promise.all([
      foodicsClient.getCustomers().catch(err => {
        console.error('[Sync] Error fetching Foodics customers:', err.message);
        return [];
      }),
      datatechService.fetchCustomersSince(since).catch(err => {
        console.error('[Sync] Error fetching DataTech customers:', err.message);
        return [];
      }),
      datatechService.fetchOrdersAggByCustomerSince(since).catch(err => {
        console.error('[Sync] Error fetching DataTech orders:', err.message);
        return [];
      }),
      datatechService.fetchTopProductsByCustomerSince(since).catch(err => {
        console.error('[Sync] Error fetching DataTech products:', err.message);
        return [];
      })
    ]);
    
    console.log(`[Sync] Data fetched:`);
    console.log(`  - Foodics customers: ${foodicsCustomersRaw.length}`);
    console.log(`  - DataTech customers: ${datatechCustomersRaw.length}`);
    console.log(`  - DataTech order aggregates: ${datatechOrdersRaw.length}`);
    console.log(`  - DataTech top products: ${datatechProductsRaw.length}`);
    
    // 4. Fetch Foodics orders from local database
    console.log(`[Sync] Aggregating Foodics orders from local database...`);
    const foodicsOrdersRaw = await db(`
      SELECT 
        regexp_replace(COALESCE(meta->>'customer_phone', ''), '[^0-9]', '', 'g') AS phone,
        MAX(NULLIF(TRIM(meta->>'customer_name'), '')) FILTER (WHERE meta->>'customer_name' NOT IN ('-', '--', '---')) AS customer_name,
        COUNT(*) AS orders_count,
        SUM(total_price) AS total_spent,
        MIN(business_date) AS first_order_date,
        MAX(business_date) AS last_order_date,
        TRIM(SPLIT_PART(MODE() WITHIN GROUP (ORDER BY meta->>'branch_name'), '|', 2)) AS preferred_branch
      FROM foodics_orders
      WHERE business_date >= $1
        AND meta->>'customer_phone' IS NOT NULL
        AND meta->>'branch_name' IS NOT NULL
      GROUP BY 1
      HAVING COUNT(*) > 0
    `, [since]);
    
    console.log(`[Sync] Foodics order aggregates: ${foodicsOrdersRaw.length}`);
    
    // 5. Normalize and build lookup maps
    console.log(`[Sync] Normalizing customer data...`);
    
    // Normalize Foodics customers
    const foodicsCustomersMap = new Map();
    foodicsCustomersRaw.forEach(c => {
      const normalized = foodicsService.normalizeFoodicsCustomer(c);
      if (normalized.phone_normalized) {
        foodicsCustomersMap.set(normalized.phone_normalized, normalized);
      }
      if (normalized.foodics_unique_id) {
        foodicsCustomersMap.set(`fuid:${normalized.foodics_unique_id}`, normalized);
      }
    });
    
    // Normalize DataTech customers
    const datatechCustomersMap = new Map();
    datatechCustomersRaw.forEach(c => {
      const phoneNormalized = normalizePhone(c.phone);
      if (phoneNormalized) {
        datatechCustomersMap.set(phoneNormalized, {
          datatech_customer_id: c.id,
          name: c.name,
          phone_raw: c.phone,
          phone_normalized: phoneNormalized,
          email: c.email
        });
      }
    });
    
    // Build order aggregates maps
    const foodicsOrdersMap = new Map();
    foodicsOrdersRaw.forEach(o => {
      const phoneNormalized = normalizePhone(o.phone);
      if (phoneNormalized) {
        foodicsOrdersMap.set(phoneNormalized, o);
      }
    });
    
    const datatechOrdersMap = new Map();
    datatechOrdersRaw.forEach(o => {
      const phoneNormalized = normalizePhone(o.phone);
      if (phoneNormalized) {
        datatechOrdersMap.set(phoneNormalized, o);
      }
    });
    
    const datatechProductsMap = new Map();
    datatechProductsRaw.forEach(p => {
      const phoneNormalized = normalizePhone(p.phone);
      if (phoneNormalized) {
        datatechProductsMap.set(phoneNormalized, p.top_products || []);
      }
    });
    
    // 6. Merge customers from both sources
    console.log(`[Sync] Merging customer records...`);
    const mergedCustomers = [];
    const processedPhones = new Set();
    
    // Process all unique phone numbers from both sources
    const allPhones = new Set([
      ...foodicsCustomersMap.keys(),
      ...datatechCustomersMap.keys(),
      ...foodicsOrdersMap.keys(),
      ...datatechOrdersMap.keys()
    ]);
    
    for (const key of allPhones) {
      if (key.startsWith('fuid:')) continue; // Skip unique ID keys for now
      
      const phoneNormalized = key;
      if (processedPhones.has(phoneNormalized)) continue;
      processedPhones.add(phoneNormalized);
      
      const foodicsCustomer = foodicsCustomersMap.get(phoneNormalized);
      const datatechCustomer = datatechCustomersMap.get(phoneNormalized);
      const foodicsOrders = foodicsOrdersMap.get(phoneNormalized);
      const datatechOrders = datatechOrdersMap.get(phoneNormalized);
      const datatechProducts = datatechProductsMap.get(phoneNormalized);
      
      // Merge customer identity
      const merged = mergeCustomerRecords(foodicsCustomer, datatechCustomer);
      
      // Add customer name from orders if not already set
      if (!merged.name && foodicsOrders?.customer_name) {
        merged.name = foodicsOrders.customer_name;
      }
      
      // Skip delivery company aggregators (not real customers)
      const deliveryCompanies = ['TALABAT', 'JAHEZ', 'JAHZ', 'VTHRU', 'DELIVEROO', 'CARRIAGE', 'HUNGER STATION'];
      if (merged.name && deliveryCompanies.some(dc => merged.name.toUpperCase().includes(dc))) {
        continue; // Skip this customer
      }
      
      // Merge order aggregates
      const foodicsOrderCount = parseInt(foodicsOrders?.orders_count || 0);
      const datatechOrderCount = parseInt(datatechOrders?.orders_count || 0);
      const foodicsSpent = parseFloat(foodicsOrders?.total_spent || 0);
      const datatechSpent = parseFloat(datatechOrders?.total_spent || 0);
      
      merged.orders_count = foodicsOrderCount + datatechOrderCount;
      merged.total_spent = foodicsSpent + datatechSpent;
      
      // Merge dates (earliest first, latest last)
      const allFirstDates = [
        foodicsOrders?.first_order_date,
        datatechOrders?.first_order_date
      ].filter(Boolean).map(d => safeDate(d));
      
      const allLastDates = [
        foodicsOrders?.last_order_date,
        datatechOrders?.last_order_date
      ].filter(Boolean).map(d => safeDate(d));
      
      if (allFirstDates.length > 0) {
        merged.first_order_date = new Date(Math.min(...allFirstDates.map(d => d.getTime())));
      }
      
      if (allLastDates.length > 0) {
        merged.last_order_date = new Date(Math.max(...allLastDates.map(d => d.getTime())));
      }
      
      // Add preferred products
      merged.preferred_products = datatechProducts ? datatechProducts.slice(0, 3) : [];
      
      // Add preferred branch from Foodics orders
      merged.preferred_branch_id = foodicsOrders?.preferred_branch || null;
      
      // Build merge key (pass name as fallback for ID extraction)
      merged.merge_key = buildMergeKey({
        foodics_unique_id: merged.foodics_unique_id,
        phone_normalized: merged.phone_normalized,
        datatech_customer_id: merged.datatech_customer_id
      }, merged.name);
      
      // Only include customers with orders
      if (merged.orders_count > 0) {
        mergedCustomers.push(merged);
      }
    }
    
    console.log(`[Sync] Merged customers: ${mergedCustomers.length}`);
    
    // 7. Compute metrics (RFM, CLV, segmentation)
    console.log(`[Sync] Computing metrics (RFM, CLV, segmentation)...`);
    const enrichedCustomers = computeAllMetrics(mergedCustomers);
    
    console.log(`[Sync] Enriched customers with metrics: ${enrichedCustomers.length}`);
    
    // 7.5. Calculate detailed order metrics for each customer
    console.log(`[Sync] Calculating detailed order metrics (order history, channel preferences, etc.)...`);
    for (let i = 0; i < enrichedCustomers.length; i++) {
      const customer = enrichedCustomers[i];
      try {
        const orderMetrics = await calculateOrderMetrics(db, customer);
        // Add the order metrics to the customer object
        customer.order_history = orderMetrics.order_history;
        customer.channel_preferences = orderMetrics.channel_preferences;
        customer.time_patterns = orderMetrics.time_patterns;
        customer.top_products_detail = orderMetrics.top_products_detail;
        customer.monthly_spending = orderMetrics.monthly_spending;
        
        if ((i + 1) % 100 === 0) {
          console.log(`[Sync] Order metrics progress: ${i + 1}/${enrichedCustomers.length}`);
        }
      } catch (error) {
        console.error(`[Sync] Error calculating order metrics for ${customer.merge_key}:`, error.message);
        // Set empty defaults on error
        customer.order_history = [];
        customer.channel_preferences = {};
        customer.time_patterns = {};
        customer.top_products_detail = [];
        customer.monthly_spending = {};
      }
    }
    
    console.log(`[Sync] Order metrics calculated for all customers`);
    
    // 8. Upsert to database
    console.log(`[Sync] Upserting to database...`);
    let upserted = 0;
    let errors = 0;
    
    for (const customer of enrichedCustomers) {
      try {
        await db(`
          INSERT INTO customer_analytics (
            merge_key, source, has_foodics, has_datatech,
            foodics_id, foodics_unique_id, datatech_customer_id,
            name, phone_raw, phone_normalized, email,
            first_order_date, last_order_date, days_since_last_order,
            orders_count, total_spent, average_order_value,
            purchase_frequency_per_month, customer_lifespan_months, repeat_buyer,
            r_score, f_score, m_score, rfm_score, segment,
            clv, churn_risk_score,
            preferred_products, preferred_branch_id, acquisition_month,
            order_history, channel_preferences, time_patterns, top_products_detail, monthly_spending,
            updated_at, last_synced_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14,
            $15, $16, $17,
            $18, $19, $20,
            $21, $22, $23, $24, $25,
            $26, $27,
            $28, $29, $30,
            $31, $32, $33, $34, $35,
            NOW(), NOW()
          )
          ON CONFLICT (merge_key) DO UPDATE SET
            source = EXCLUDED.source,
            has_foodics = EXCLUDED.has_foodics,
            has_datatech = EXCLUDED.has_datatech,
            foodics_id = COALESCE(EXCLUDED.foodics_id, customer_analytics.foodics_id),
            foodics_unique_id = COALESCE(EXCLUDED.foodics_unique_id, customer_analytics.foodics_unique_id),
            datatech_customer_id = COALESCE(EXCLUDED.datatech_customer_id, customer_analytics.datatech_customer_id),
            name = COALESCE(EXCLUDED.name, customer_analytics.name),
            phone_raw = COALESCE(EXCLUDED.phone_raw, customer_analytics.phone_raw),
            phone_normalized = COALESCE(EXCLUDED.phone_normalized, customer_analytics.phone_normalized),
            email = COALESCE(EXCLUDED.email, customer_analytics.email),
            first_order_date = EXCLUDED.first_order_date,
            last_order_date = EXCLUDED.last_order_date,
            days_since_last_order = EXCLUDED.days_since_last_order,
            orders_count = EXCLUDED.orders_count,
            total_spent = EXCLUDED.total_spent,
            average_order_value = EXCLUDED.average_order_value,
            purchase_frequency_per_month = EXCLUDED.purchase_frequency_per_month,
            customer_lifespan_months = EXCLUDED.customer_lifespan_months,
            repeat_buyer = EXCLUDED.repeat_buyer,
            r_score = EXCLUDED.r_score,
            f_score = EXCLUDED.f_score,
            m_score = EXCLUDED.m_score,
            rfm_score = EXCLUDED.rfm_score,
            segment = EXCLUDED.segment,
            clv = EXCLUDED.clv,
            churn_risk_score = EXCLUDED.churn_risk_score,
            preferred_products = EXCLUDED.preferred_products,
            preferred_branch_id = EXCLUDED.preferred_branch_id,
            acquisition_month = EXCLUDED.acquisition_month,
            order_history = EXCLUDED.order_history,
            channel_preferences = EXCLUDED.channel_preferences,
            time_patterns = EXCLUDED.time_patterns,
            top_products_detail = EXCLUDED.top_products_detail,
            monthly_spending = EXCLUDED.monthly_spending,
            updated_at = NOW(),
            last_synced_at = NOW()
        `, [
          customer.merge_key,
          customer.source,
          customer.has_foodics,
          customer.has_datatech,
          customer.foodics_id,
          customer.foodics_unique_id,
          customer.datatech_customer_id,
          customer.name,
          customer.phone_raw,
          customer.phone_normalized,
          customer.email,
          customer.first_order_date,
          customer.last_order_date,
          customer.days_since_last_order,
          customer.orders_count,
          customer.total_spent,
          customer.average_order_value,
          customer.purchase_frequency_per_month,
          customer.customer_lifespan_months,
          customer.repeat_buyer,
          customer.r_score,
          customer.f_score,
          customer.m_score,
          customer.rfm_score,
          customer.segment,
          customer.clv,
          customer.churn_risk_score,
          customer.preferred_products,
          customer.preferred_branch_id,
          customer.first_order_date ? new Date(customer.first_order_date.getFullYear(), customer.first_order_date.getMonth(), 1) : null,
          JSON.stringify(customer.order_history || []),
          JSON.stringify(customer.channel_preferences || {}),
          JSON.stringify(customer.time_patterns || {}),
          JSON.stringify(customer.top_products_detail || []),
          JSON.stringify(customer.monthly_spending || {})
        ]);
        
        upserted++;
        
        if (upserted % 100 === 0) {
          console.log(`[Sync] Progress: ${upserted}/${enrichedCustomers.length}`);
        }
      } catch (error) {
        console.error(`[Sync] Error upserting customer ${customer.merge_key}:`, error.message);
        errors++;
      }
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`\n========================================`);
    console.log(`[Sync] Customer Analytics Sync Complete`);
    console.log(`========================================`);
    console.log(`Mode: ${mode}`);
    console.log(`Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`Customers processed: ${enrichedCustomers.length}`);
    console.log(`Successfully upserted: ${upserted}`);
    console.log(`Errors: ${errors}`);
    console.log(`========================================\n`);
    
    return {
      success: true,
      mode,
      duration,
      customers_processed: enrichedCustomers.length,
      upserted,
      errors,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n[Sync] SYNC FAILED after ${duration}ms`);
    console.error(`[Sync] Error:`, error.message);
    console.error(`[Sync] Stack:`, error.stack);
    
    return {
      success: false,
      mode,
      duration,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Allow running as standalone script
if (require.main === module) {
  (async () => {
    // Simple standalone database connection for testing
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '6555'),
      database: process.env.DB_NAME || 'ordertech',
      user: process.env.DB_USER || 'ordertech',
      password: process.env.DB_PASS || 'Ordertech.2020'
    });
    
    const db = async (sql, params) => {
      const result = await pool.query(sql, params);
      return result.rows;
    };
    
    const mode = process.argv[2] || 'incremental';
    const result = await syncCustomerAnalytics(db, mode);
    
    await pool.end();
    process.exit(result.success ? 0 : 1);
  })();
}

module.exports = syncCustomerAnalytics;
