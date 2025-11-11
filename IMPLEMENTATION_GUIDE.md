# Customer Analytics Implementation Guide

## ✅ Completed (4/20)
1. ✓ Database migration (`migrations/20251110_customer_analytics.sql`)
2. ✓ Customer merge utilities (`lib/customerMerge.js`)
3. ✓ Metrics engine (`lib/metrics.js`)
4. ✓ DataTech service (`services/datatechService.js`)

## 🚧 Remaining Components

The files below need to be created. Due to their size, I'll provide detailed implementation notes and you can generate them, or I can create them one by one in follow-up messages.

### 5. Update services/foodicsService.js

**Add these functions** to the existing file:

```javascript
/**
 * Fetch all customers from Foodics API with pagination
 * @returns {Promise<Array>}
 */
async function getCustomers() {
  const allCustomers = [];
  let hasMore = true;
  let page = 1;
  const MAX_PAGES = 50;
  
  while (hasMore && page <= MAX_PAGES) {
    try {
      const response = await axios.get(`${FOODICS_API_BASE}/customers`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json'
        },
        params: {
          per_page: 100,
          page
        }
      });
      
      const data = response.data.data || [];
      allCustomers.push(...data);
      
      const meta = response.data.meta;
      if (meta && meta.current_page < meta.last_page) {
        page++;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`[Foodics] Error fetching customers page ${page}:`, error.message);
      break;
    }
  }
  
  return allCustomers;
}
```

### 6. Create jobs/sync-customer-analytics.js

**Key sections:**

```javascript
const { normalizePhone, parseFoodicsUniqueIdFromName, buildMergeKey, mergeCustomerRecords } = require('../lib/customerMerge');
const { computeAllMetrics } = require('../lib/metrics');
const datatechService = require('../services/datatechService');
const foodicsService = require('../services/foodicsService');

async function syncCustomerAnalytics(db, mode = 'incremental') {
  const startTime = Date.now();
  console.log(`[Sync] Starting customer analytics sync (mode: ${mode})`);
  
  // 1. Determine time window
  const since = mode === 'full' ? 
    new Date(Date.now() - 730 * 24 * 60 * 60 * 1000) : // 2 years
    new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days for incremental
  
  // 2. Fetch from both sources in parallel
  const [foodicsCustomers, datatechCustomers, datatechOrders] = await Promise.all([
    foodicsService.getCustomers().catch(() => []),
    datatechService.fetchCustomersSince(since).catch(() => []),
    datatechService.fetchOrdersAggByCustomerSince(since).catch(() => [])
  ]);
  
  // 3. Fetch Foodics orders from local DB
  const foodicsOrders = await db(`
    SELECT 
      regexp_replace(COALESCE(meta->>'customer_phone', ''), '[^0-9]', '', 'g') AS phone,
      COUNT(*) AS orders_count,
      SUM(total_price) AS total_spent,
      MIN(business_date) AS first_order_date,
      MAX(business_date) AS last_order_date
    FROM foodics_orders
    WHERE business_date >= $1
    GROUP BY 1
    HAVING COUNT(*) > 0
  `, [since]);
  
  // 4. Normalize and merge
  const mergedCustomers = await mergeAllSources({
    foodicsCustomers,
    datatechCustomers,
    foodicsOrders,
    datatechOrders
  });
  
  // 5. Compute metrics
  const enrichedCustomers = computeAllMetrics(mergedCustomers);
  
  // 6. Upsert to database
  let upserted = 0;
  for (const customer of enrichedCustomers) {
    await db(`
      INSERT INTO customer_analytics (...columns...)
      VALUES (...values...)
      ON CONFLICT (merge_key) DO UPDATE SET
        ...all fields...
        updated_at = NOW(),
        last_synced_at = NOW()
    `, [customer values]);
    upserted++;
  }
  
  const duration = Date.now() - startTime;
  console.log(`[Sync] Complete: ${upserted} customers in ${duration}ms`);
  
  return { upserted, duration };
}
```

### 7. Create routes/customer-analytics.js

**Template structure:**

```javascript
function initCustomerAnalyticsRoutes(db) {
  const router = express.Router();
  
  // GET /api/customers/analytics/summary
  router.get('/summary', async (req, res) => {
    const summary = await db(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE days_since_last_order <= 30) as active_30d,
        AVG(clv) as average_clv,
        SUM(clv) as total_customer_value
      FROM customer_analytics
    `);
    res.json(summary[0]);
  });
  
  // GET /api/customers/analytics/list (with pagination)
  router.get('/list', async (req, res) => {
    const { page = 1, limit = 50, search, segment, sort = 'total_spent', direction = 'DESC' } = req.query;
    // ... implement pagination and filters
  });
  
  // GET /api/customers/analytics/segments
  router.get('/segments', async (req, res) => {
    const segments = await db(`
      SELECT segment, COUNT(*) as count
      FROM customer_analytics
      GROUP BY segment
      ORDER BY count DESC
    `);
    res.json({ segments });
  });
  
  // POST /api/customers/analytics/sync
  router.post('/sync', async (req, res) => {
    // Protect with token
    const token = req.headers['x-sync-token'] || req.query.token;
    if (token !== process.env.SYNC_INTERNAL_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const syncJob = require('../jobs/sync-customer-analytics');
    const result = await syncJob(db, req.query.mode);
    res.json(result);
  });
  
  return router;
}
```

### 8. Update server.js

**Add these lines** after existing Foodics routes:

```javascript
// Customer Analytics routes
try {
  const initCustomerAnalyticsRoutes = require('./routes/customer-analytics');
  const customerAnalyticsRouter = initCustomerAnalyticsRoutes(db);
  app.use('/api/customers/analytics', customerAnalyticsRouter);
  console.log('[Server] Customer Analytics routes initialized');
} catch (error) {
  console.error('[Server] Failed to initialize Customer Analytics routes:', error);
}

// Customer dashboard page
app.get('/customers', (req, res) => {
  res.sendFile(path.join(__dirname, 'foodics', 'customers.html'));
});
app.get('/foodics/customers', (req, res) => {
  res.sendFile(path.join(__dirname, 'foodics', 'customers.html'));
});
```

### 9. Create foodics/customers.html

**Key structure** (match sales.html style):

```html
<!DOCTYPE html>
<html>
<head>
  <title>Customers Dashboard - Foodics</title>
  <!-- Same styles as sales.html -->
</head>
<body>
  <div class="header">
    <div class="header-nav">
      <a href="/sales">Products</a>
      <a href="/branches">Branches</a>
      <a href="/customers" class="active">Customers</a>
    </div>
  </div>
  
  <div class="container">
    <!-- Overview Cards -->
    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-label">Total Customers</div>
        <div class="stat-value" id="totalCustomers">0</div>
      </div>
      <!-- More cards... -->
    </div>
    
    <!-- Segments Chart -->
    <canvas id="segmentsChart"></canvas>
    
    <!-- Customer Table -->
    <table id="customersTable">
      <!-- Populated via JavaScript -->
    </table>
  </div>
  
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    async function loadData() {
      const summary = await fetch('/api/customers/analytics/summary').then(r => r.json());
      document.getElementById('totalCustomers').textContent = summary.total_customers;
      // ... more updates
    }
    
    loadData();
  </script>
</body>
</html>
```

### 10. Create deploy/cloud-scheduler-customers.yaml

```yaml
name: projects/smart-order-469705/locations/me-central1/jobs/customer-analytics-sync
schedule: "0 0,6,12,18 * * *"
timeZone: "Asia/Riyadh"
httpTarget:
  uri: https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/sync?mode=incremental
  httpMethod: POST
  headers:
    Content-Type: application/json
    X-Sync-Token: "${SYNC_INTERNAL_TOKEN}"
  body: "e30="
```

## 📦 Quick Deployment Steps

```bash
# 1. Run migration
psql -h 127.0.0.1 -p 6555 -U ordertech -d ordertech -f migrations/20251110_customer_analytics.sql

# 2. Set environment variables (add to Cloud Run)
gcloud run services update ordertech --region=me-central1 \
  --set-env-vars="DATATECH_DB_HOST=34.72.158.144,DATATECH_DB_PORT=5432,SYNC_INTERNAL_TOKEN=<generate-token>"

# 3. Deploy code
./deploy-cloud-run.sh

# 4. Configure scheduler
gcloud scheduler jobs create http customer-analytics-sync \
  --location=me-central1 \
  --schedule="0 */6 * * *" \
  --uri="https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/sync" \
  --http-method=POST \
  --headers="X-Sync-Token=<token>"

# 5. Manual first sync
curl -X POST "https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/sync?mode=full" \
  -H "X-Sync-Token: <token>"

# 6. Verify
open https://foodics.ordertech.me/customers
```

## 📝 Next Steps

Would you like me to:
A) Generate the full sync job code (jobs/sync-customer-analytics.js)
B) Generate the full API routes code (routes/customer-analytics.js)
C) Generate the complete dashboard HTML (foodics/customers.html)
D) Continue implementing all remaining files one by one

Let me know which approach works best!
