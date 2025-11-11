# Customer Analytics Dashboard - Deployment Guide

## Overview
This guide walks through deploying the complete customer analytics system to production on Google Cloud Platform.

**System Components:**
- PostgreSQL database with `customer_analytics` table
- Backend API routes for data access
- Sync job for Foodics + DataTech integration
- Frontend dashboard at `/customers`
- Cloud Scheduler for automated 4x daily syncs

**Expected Results:**
- Dashboard accessible at `https://foodics.ordertech.me/customers`
- Auto-syncs at 00:00, 06:00, 12:00, 18:00 AST daily
- Merged, de-duplicated customer data with RFM segmentation
- Industry-standard metrics: CLV, churn rate, retention, segments

---

## Prerequisites

1. **Database Access** - Cloud SQL proxy connected
2. **Cloud Run Service** - `ordertech-715493130630.me-central1.run.app`
3. **Foodics API Token** - Valid token with customer read permissions
4. **DataTech DB Access** - Credentials for `34.72.158.144:5432`
5. **gcloud CLI** - Authenticated and configured

---

## Step 1: Database Migration

### 1.1 Connect to Database
```bash
# Connect via Cloud SQL proxy (should already be running at 127.0.0.1:6555)
psql -h 127.0.0.1 -p 6555 -U postgres -d ordertech
```

### 1.2 Run Migration
```sql
-- Run the migration file
\i migrations/20251110_customer_analytics.sql
```

### 1.3 Verify Schema
```sql
-- Check table exists
\d customer_analytics

-- Verify indexes
\di customer_analytics*

-- Expected indexes:
-- - customer_analytics_pkey (PRIMARY KEY on id)
-- - idx_customer_analytics_merge_key (UNIQUE)
-- - idx_customer_analytics_segment
-- - idx_customer_analytics_last_order_date
-- - idx_customer_analytics_clv
-- - idx_customer_analytics_rfm_score
-- - idx_customer_analytics_phone
-- - idx_customer_analytics_email
-- - idx_customer_analytics_foodics_id
-- - idx_customer_analytics_datatech_id
-- - idx_customer_analytics_source
-- - idx_customer_analytics_last_synced
```

**Expected output:** Table with 40+ columns including identity fields, order aggregates, RFM scores, CLV, and segmentation.

---

## Step 2: Environment Variables

### 2.1 Generate Sync Token
```bash
# Generate a secure random token
SYNC_TOKEN=$(openssl rand -base64 32)
echo "Generated SYNC_INTERNAL_TOKEN: $SYNC_TOKEN"
# Save this token - you'll need it for Cloud Scheduler
```

### 2.2 Add to Cloud Run Service

**Option A: Via Console**
1. Go to Cloud Run console
2. Select `ordertech` service
3. Click "Edit & Deploy New Revision"
4. Add/verify environment variables:
   - `SYNC_INTERNAL_TOKEN` = (token from 2.1)
   - `DATABASE_URL` = (existing PostgreSQL connection string)
   - `FOODICS_API_BASE` = `https://api.foodics.com/v5`
   - `FOODICS_API_TOKEN` = (existing Foodics token)
   - `DATATECH_DB_HOST` = `34.72.158.144`
   - `DATATECH_DB_PORT` = `5432`
   - `DATATECH_DB_NAME` = `postgres`
   - `DATATECH_DB_USER` = `ordertech`
   - `DATATECH_DB_PASS` = `Ordertech.2020`
   - `TZ` = `Asia/Riyadh`
5. Deploy revision

**Option B: Via gcloud**
```bash
gcloud run services update ordertech \
  --region=me-central1 \
  --update-env-vars="SYNC_INTERNAL_TOKEN=${SYNC_TOKEN}" \
  --update-env-vars="DATATECH_DB_HOST=34.72.158.144" \
  --update-env-vars="DATATECH_DB_PORT=5432" \
  --update-env-vars="DATATECH_DB_NAME=postgres" \
  --update-env-vars="DATATECH_DB_USER=ordertech" \
  --update-env-vars="DATATECH_DB_PASS=Ordertech.2020" \
  --update-env-vars="TZ=Asia/Riyadh"
```

---

## Step 3: Deploy Code

### 3.1 Build and Deploy
```bash
# From project root
cd /Users/mosawi/DATATECH/OrderTech

# Build Docker image
gcloud builds submit --tag gcr.io/smart-order-469705/ordertech

# Deploy to Cloud Run
gcloud run deploy ordertech \
  --image gcr.io/smart-order-469705/ordertech \
  --region me-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --min-instances 1
```

### 3.2 Verify Deployment
```bash
# Check service is running
gcloud run services describe ordertech --region=me-central1

# Test health endpoint
curl https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/health

# Expected response:
# {"success":true,"healthy":true,"total_customers":"0","last_sync_time":null,"synced_last_24h":"0"}
```

---

## Step 4: Initial Data Sync

### 4.1 Run Full Backfill
```bash
# Trigger full sync (2-year historical data)
curl -X POST \
  -H "X-Sync-Token: ${SYNC_TOKEN}" \
  "https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/sync?mode=full"
```

**Expected duration:** 5-15 minutes depending on customer count

### 4.2 Monitor Sync Progress
```bash
# Watch Cloud Run logs in real-time
gcloud logging tail "resource.type=cloud_run_revision AND textPayload:Customer" --format=json

# Key log messages to look for:
# - "[Customer Analytics] Starting sync (mode: full)"
# - "[Customer Analytics] Fetched X customers from Foodics"
# - "[Customer Analytics] Fetched Y customers from DataTech"
# - "[Customer Analytics] Merged Z unique customers"
# - "[Customer Analytics] Computed metrics for Z customers"
# - "[Customer Analytics] Upserted Z customers"
# - "[Customer Analytics] Sync completed successfully"
```

### 4.3 Verify Data
```sql
-- Connect to database
psql -h 127.0.0.1 -p 6555 -U postgres -d ordertech

-- Check customer count
SELECT COUNT(*) as total_customers FROM customer_analytics;

-- Check segment distribution
SELECT segment, COUNT(*) as count 
FROM customer_analytics 
GROUP BY segment 
ORDER BY count DESC;

-- Check RFM score distribution
SELECT rfm_score, COUNT(*) as count 
FROM customer_analytics 
GROUP BY rfm_score 
ORDER BY rfm_score DESC;

-- Check data sources
SELECT 
  source,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE has_foodics) as with_foodics,
  COUNT(*) FILTER (WHERE has_datatech) as with_datatech
FROM customer_analytics
GROUP BY source;

-- Sample top customers by CLV
SELECT name, phone_raw, orders_count, total_spent, clv, segment
FROM customer_analytics
ORDER BY clv DESC
LIMIT 10;
```

---

## Step 5: Configure Cloud Scheduler

### 5.1 Create Incremental Sync Job
```bash
# 4x daily sync at 00:00, 06:00, 12:00, 18:00 AST
gcloud scheduler jobs create http customer-analytics-sync \
  --location=me-central1 \
  --schedule="0 0,6,12,18 * * *" \
  --time-zone="Asia/Riyadh" \
  --uri="https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/sync?mode=incremental" \
  --http-method=POST \
  --headers="X-Sync-Token=${SYNC_TOKEN}" \
  --attempt-deadline=600s \
  --max-retry-attempts=3 \
  --min-backoff=10s \
  --max-backoff=300s \
  --description="Customer analytics sync - runs 4x daily"
```

### 5.2 Create Weekly Full Sync Job (Optional)
```bash
# Weekly full sync on Sunday 2:00 AM AST
gcloud scheduler jobs create http customer-analytics-full-sync \
  --location=me-central1 \
  --schedule="0 2 * * 0" \
  --time-zone="Asia/Riyadh" \
  --uri="https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/sync?mode=full" \
  --http-method=POST \
  --headers="X-Sync-Token=${SYNC_TOKEN}" \
  --attempt-deadline=1800s \
  --max-retry-attempts=2 \
  --min-backoff=60s \
  --max-backoff=600s \
  --description="Customer analytics full sync - runs weekly on Sunday 2AM"
```

### 5.3 Verify Scheduler Jobs
```bash
# List scheduler jobs
gcloud scheduler jobs list --location=me-central1 | grep customer

# Test incremental sync immediately
gcloud scheduler jobs run customer-analytics-sync --location=me-central1

# Check execution history
gcloud scheduler jobs describe customer-analytics-sync --location=me-central1
```

---

## Step 6: Verify Dashboard

### 6.1 Access Dashboard
Open browser to: `https://foodics.ordertech.me/customers`

### 6.2 Expected Dashboard Features

**Stats Bar (Top):**
- Total Customers
- Active (30d) with retention rate
- Average CLV
- Total Customer Value
- Repeat Purchase Rate
- Churn Rate

**Segment Cards:**
- All Customers
- Champions (RFM 13-15)
- Loyal (RFM 10-12)
- At Risk (were frequent, haven't purchased recently)
- New (first purchase < 30 days)
- Lost (no purchase 90+ days)
- Others

**Customer Table:**
- Searchable by name/phone
- Filterable by segment
- Sortable by: Total Spent, CLV, Order Count, Last Order, RFM Score
- Paginated (50 per page)
- Shows: Customer name, phone, segment badge, RFM scores, order count, total spent, avg order, CLV, last order date, days since last order

### 6.3 Verify Navigation
- Header nav links work: Dashboard → Sales → Branches → Customers
- Search functionality works
- Segment filtering works (click segment cards)
- Sorting works (dropdown)
- Pagination works

---

## Step 7: Monitoring and Alerts

### 7.1 Check Sync Logs Regularly
```bash
# View recent sync logs
gcloud logging read \
  "resource.type=cloud_run_revision AND textPayload:\"[Customer Analytics]\"" \
  --limit=50 \
  --format=json

# Check for errors
gcloud logging read \
  "resource.type=cloud_run_revision AND (textPayload:\"[Customer Analytics]\" AND severity>=ERROR)" \
  --limit=20
```

### 7.2 Monitor Health Endpoint
```bash
# Automated health check (add to monitoring system)
curl https://ordertech-715493130630.me-central1.run.app/api/customers/analytics/health

# Should return:
# {
#   "success": true,
#   "healthy": true,
#   "total_customers": "1234",
#   "last_sync_time": "2024-11-10T12:00:00.000Z",
#   "synced_last_24h": "1234"
# }
```

### 7.3 Key Metrics to Monitor
- **Sync frequency:** Should run 4x daily
- **Sync duration:** < 60s for incremental, < 15min for full
- **Last sync time:** Should not exceed 8 hours
- **Error rate:** Should be < 1%
- **Customer count:** Should grow over time
- **Dashboard load time:** Should be < 2 seconds

---

## Step 8: Performance Tuning

### 8.1 Database Optimization
```sql
-- Analyze table statistics for query planner
ANALYZE customer_analytics;

-- Vacuum table to reclaim space and update stats
VACUUM ANALYZE customer_analytics;

-- Check index usage
SELECT 
  schemaname, tablename, indexname, 
  idx_scan as scans, 
  idx_tup_read as tuples_read, 
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'customer_analytics'
ORDER BY idx_scan DESC;
```

### 8.2 Enable Query Caching (Future Enhancement)
Consider adding Redis caching for:
- Summary statistics (5-minute TTL)
- Segment counts (5-minute TTL)
- Top customers list (10-minute TTL)

---

## Troubleshooting

### Issue: Sync fails with "NO_DB" error
**Solution:** Verify `DATABASE_URL` environment variable is set in Cloud Run

### Issue: Sync fails with "Unauthorized" error
**Solution:** Check `SYNC_INTERNAL_TOKEN` matches between Cloud Run and Scheduler

### Issue: No DataTech customers appearing
**Solution:** 
1. Verify DataTech DB credentials: `DATATECH_DB_HOST`, `DATATECH_DB_USER`, `DATATECH_DB_PASS`
2. Check network connectivity from Cloud Run to DataTech DB (34.72.158.144:5432)
3. Verify table exists in DataTech DB

### Issue: Duplicate customers appearing
**Solution:** Check `merge_key` logic in `lib/customerMerge.js` - should deduplicate by phone

### Issue: Dashboard shows "Failed to load"
**Solution:**
1. Check browser console for errors
2. Verify API routes are accessible: `curl https://foodics.ordertech.me/api/customers/analytics/health`
3. Check Cloud Run logs for API errors

### Issue: Slow dashboard loading
**Solution:**
1. Check database query performance: `EXPLAIN ANALYZE SELECT * FROM customer_analytics LIMIT 50;`
2. Verify indexes are being used
3. Consider adding pagination/caching

---

## Rollback Procedure

If issues occur and rollback is needed:

### 1. Disable Scheduler
```bash
gcloud scheduler jobs pause customer-analytics-sync --location=me-central1
gcloud scheduler jobs pause customer-analytics-full-sync --location=me-central1
```

### 2. Remove Dashboard Access
```bash
# Redeploy previous Cloud Run revision without customer analytics code
gcloud run services update ordertech \
  --region=me-central1 \
  --revision-suffix=rollback
```

### 3. Keep Database Table
The `customer_analytics` table can remain - it won't cause issues

### 4. Re-enable Later
When ready to try again:
```bash
gcloud scheduler jobs resume customer-analytics-sync --location=me-central1
```

---

## Success Criteria

✅ **Deployment is successful when:**
1. Dashboard loads at `https://foodics.ordertech.me/customers` in < 2 seconds
2. Summary stats display correct data
3. Segment cards show customer counts
4. Customer table displays with search, filter, sort, pagination
5. Sync jobs run automatically 4x daily
6. No errors in Cloud Run logs
7. Health endpoint returns `{"success":true,"healthy":true}`
8. Mobile responsive design works correctly

---

## Maintenance

### Weekly Tasks
- Review sync logs for errors
- Check dashboard performance
- Verify data quality (no duplicates, correct segments)

### Monthly Tasks
- Run `VACUUM ANALYZE customer_analytics`
- Review and optimize slow queries
- Check disk space usage
- Review customer count trends

### Quarterly Tasks
- Review and update RFM thresholds if needed
- Optimize indexes based on query patterns
- Update CLV calculation model if business changes

---

## Additional Resources

- **Migration File:** `migrations/20251110_customer_analytics.sql`
- **API Routes:** `routes/customer-analytics.js`
- **Sync Job:** `jobs/sync-customer-analytics.js`
- **Frontend:** `foodics/customers.html`
- **Scheduler Config:** `deploy/cloud-scheduler-customers.yaml`
- **Implementation Guide:** `IMPLEMENTATION_GUIDE.md`
- **Status Tracker:** `CUSTOMER_ANALYTICS_STATUS.md`

---

## Support

For issues or questions:
1. Check Cloud Run logs: `gcloud logging tail`
2. Review this deployment guide
3. Check database table structure and data
4. Verify environment variables are set correctly
5. Test API endpoints directly with curl

---

**Last Updated:** 2024-11-10
**Version:** 1.0
**Status:** Ready for Production Deployment
