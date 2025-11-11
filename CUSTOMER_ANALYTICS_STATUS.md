# Customer Analytics Dashboard - Implementation Status

## 🎯 Goal
Create `/customers` dashboard at foodics.ordertech.me/customers with merged Foodics + DataTech customer data, RFM segmentation, CLV calculation, and professional analytics.

## ✅ Completed Components

### 1. Database Schema ✓
- **File**: `migrations/20251110_customer_analytics.sql`
- **Status**: Created
- **Tables**: 
  - `customer_analytics` (main table with 30+ fields)
  - `customer_activity_monthly` (pre-aggregated for performance)
- **Indexes**: 11 indexes for fast queries
- **Ready to Deploy**: Yes

### 2. Customer Merge Utilities ✓
- **File**: `lib/customerMerge.js`
- **Functions**:
  - `normalizePhone()` - E.164 format for KW/SA
  - `parseFoodicsUniqueIdFromName()` - Extract IDs from names
  - `buildMergeKey()` - Deduplication key logic
  - `mergeCustomerRecords()` - Foodics priority merge
  - Date/number helpers

### 3. Metrics Engine ✓
- **File**: `lib/metrics.js`
- **Capabilities**:
  - CLV calculation (AOV × Frequency × Lifespan)
  - RFM scoring with quantiles (1-5 scale)
  - Segmentation: Champions, Loyal, At Risk, New, Lost, Others
  - Churn risk scoring (0-100)
  - Dataset-level KPIs

### 4. DataTech Service ✓
- **File**: `services/datatechService.js`
- **Status**: Created
- **Purpose**: Connect to remote DB `datatech-466813:us-central1:dbdatatech`
- **Functions**:
  - `fetchCustomersSince(since)` - Get customers from DataTech DB
  - `fetchOrdersAggByCustomerSince(since)` - Get order aggregates
  - `fetchTopProductsByCustomerSince(since)` - Get preferred products
- **Features**: Retry logic, error handling, connection pooling

### 5. Foodics Service Updates ✓
- **File**: `services/foodicsService.js` (extended)
- **Status**: Updated
- **Added**:
  - `normalizeFoodicsCustomer()` - Parse unique IDs and normalize phones
  - Uses existing `getCustomers()` method for pagination

### 6. Sync Job ✓
- **File**: `jobs/sync-customer-analytics.js`
- **Status**: Created (404 lines)
- **Schedule**: 4x daily (00:00, 06:00, 12:00, 18:00 AST)
- **Flow**: Fetch → Normalize → Merge → Compute Metrics → Upsert
- **Modes**: 'full' (2-year backfill) and 'incremental' (3-day window)
- **Features**: Detailed logging, error handling, can run standalone or as module

### 7. API Routes ✓
- **File**: `routes/customer-analytics.js`
- **Status**: Created (463 lines)
- **Endpoints**:
  - GET `/api/customers/analytics/summary` - Overall stats
  - GET `/api/customers/analytics/list` - Paginated, filterable customer list
  - GET `/api/customers/analytics/segments` - Segment breakdown
  - GET `/api/customers/analytics/top-customers` - Top by CLV/spent
  - GET `/api/customers/analytics/trends` - Chart data
  - POST `/api/customers/analytics/sync` - Protected sync trigger
  - GET `/api/customers/analytics/health` - Health check

### 8. Frontend Dashboard ✓
- **File**: `foodics/customers.html`
- **Status**: Created (798 lines)
- **Features**:
  - Stats bar: 6 KPIs (Total, Active, CLV, Value, Repeat Rate, Churn)
  - Segment cards: Interactive filtering
  - Customer table: Searchable, sortable, paginated
  - RFM scores display
  - Mobile responsive
  - Matches sales.html/branches.html styling

### 9. Server Integration ✓
- **File**: `server.js`
- **Status**: Updated
- **Changes**:
  - Registered `/api/customers/analytics` routes
  - Added `/customers` and `/foodics/customers` page routes
  - Integrated with existing route system

### 10. Cloud Scheduler ✓
- **File**: `deploy/cloud-scheduler-customers.yaml`
- **Status**: Created
- **Configuration**: Complete gcloud commands for setup
- **Schedule**: 4x daily incremental + weekly full sync

## 📋 Deployment Checklist

**CODE COMPLETE - READY FOR DEPLOYMENT** ✓

- [ ] Run migration: `psql -h 127.0.0.1 -p 6555 -U postgres -d ordertech -f migrations/20251110_customer_analytics.sql`
- [x] All code files completed (services, jobs, routes, UI)
- [x] Updated `server.js` with new routes
- [ ] Generate SYNC_INTERNAL_TOKEN and add to Cloud Run env vars
- [ ] Deploy to Cloud Run (no downtime)
- [ ] Configure Cloud Scheduler jobs
- [ ] Manual full sync trigger for initial backfill
- [ ] Verify dashboard at foodics.ordertech.me/customers
- [ ] Monitor first few sync executions

**See DEPLOYMENT_GUIDE.md for detailed step-by-step instructions**

## 🔑 Environment Variables Needed

```bash
# Already configured (should be in Cloud Run)
DATABASE_URL=postgresql://...
FOODICS_API_BASE=https://api.foodics.com/v5
FOODICS_API_TOKEN=...

# New variables to add
DATATECH_DB_HOST=34.72.158.144
DATATECH_DB_PORT=5432
DATATECH_DB_NAME=postgres
DATATECH_DB_USER=ordertech
DATATECH_DB_PASS=Ordertech.2020
SYNC_INTERNAL_TOKEN=<generate-secure-token>
```

## 📊 Success Metrics

- Dashboard loads < 2s
- No duplicate customers (unique merge_key)
- RFM segmentation accurate
- Sync completes < 5 minutes
- 4x daily automated sync running

## 📦 Deliverables Summary

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Migration | migrations/20251110_customer_analytics.sql | 111 | ✓ |
| Merge Utils | lib/customerMerge.js | 226 | ✓ |
| Metrics Engine | lib/metrics.js | 308 | ✓ |
| DataTech Service | services/datatechService.js | 263 | ✓ |
| Foodics Service | services/foodicsService.js | Updated | ✓ |
| Sync Job | jobs/sync-customer-analytics.js | 404 | ✓ |
| API Routes | routes/customer-analytics.js | 463 | ✓ |
| Frontend | foodics/customers.html | 798 | ✓ |
| Server Integration | server.js | Updated | ✓ |
| Scheduler Config | deploy/cloud-scheduler-customers.yaml | 79 | ✓ |
| Deployment Guide | DEPLOYMENT_GUIDE.md | 497 | ✓ |
| **TOTAL** | **11 files** | **~3,149 lines** | **100%** |

---

## 🚀 Next Steps

**ALL CODE COMPLETE! Ready for production deployment.**

Follow the comprehensive deployment guide: **DEPLOYMENT_GUIDE.md**

Key deployment steps:
1. Run database migration
2. Set environment variables (especially SYNC_INTERNAL_TOKEN)
3. Deploy code to Cloud Run
4. Run initial full sync
5. Configure Cloud Scheduler
6. Verify dashboard functionality

Estimated deployment time: 30-45 minutes
