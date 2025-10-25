# Foodics Sales Integration

This document describes the Foodics sales data integration system that continuously imports orders, customers, payments, and related data from Foodics POS into the OrderTech database.

## Overview

The integration provides:
- **Incremental Sync**: Automated imports every 5 minutes via Cloud Scheduler
- **Historical Backfill**: Script to import past sales data
- **Comprehensive Data**: Orders, customers, payments, discounts, taxes, and line items
- **Deduplication**: Idempotent upserts prevent data duplication
- **Admin APIs**: Manual sync triggers and status monitoring

## Architecture

```
Foodics API → Transformers → Mapping Cache → Database Upserts → Analytics/Reports
```

### Key Components

1. **Foodics Client** (`server/integrations/foodics.js`)
   - API wrapper with orders, customers, and payments endpoints
   - Rate limiting and error handling
   - Flexible parameter support

2. **Transformers** (`server/integrations/sales/transformers.js`)
   - Convert Foodics API payloads to internal schema
   - Normalize statuses, service types, and currencies
   - Handle null values and type casting

3. **Mapping Cache** (`server/integrations/sales/mappingCache.js`)
   - Fast ID lookups for products, modifiers, branches, customers
   - Customer deduplication by normalized phone numbers
   - In-memory cache with database persistence

4. **Upserts Module** (`server/integrations/sales/upserts.js`)
   - Idempotent database operations
   - Transaction-based consistency
   - External mapping table for system integration

5. **Sync Orchestrator** (in `server.js`)
   - Incremental sync with cursor management
   - Overlapping windows for late-arriving data
   - Advisory locks prevent concurrent runs

## Database Schema

The integration adds these tables:

### Core Tables
- `customers` - Customer master data
- `sales_orders` - Order headers
- `sales_order_items` - Line items with products
- `sales_order_item_modifiers` - Modifier selections
- `sales_order_payments` - Payment methods and amounts
- `sales_order_discounts` - Applied discounts
- `sales_order_taxes` - Tax calculations

### Support Tables
- `external_mappings` - Links external IDs to internal IDs
- `integration_sync_runs` - Sync execution tracking
- `integration_cursors` - Incremental sync state

## Setup Instructions

### 1. Run Database Migration

```sql
-- Apply the schema migration
\i migrations/20251020_foodics_sales.sql
```

### 2. Configure Foodics Token

Set the API token in one of these ways:

**Environment Variable:**
```bash
export FOODICS_TOKEN="your_token_here"
```

**Token File:**
```bash
echo "your_token_here" > ios/foodics_token.txt
```

### 3. Set Up Cloud Scheduler

Use the provided configuration:

```bash
# Create the scheduled job
gcloud scheduler jobs create http foodics-sales-sync \
  --schedule="*/5 * * * *" \
  --uri="https://ordertech.me/cron/foodics-sales-sync" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"trigger":"cloud-scheduler","job_name":"foodics-sales-sync"}' \
  --time-zone="Asia/Kuwait" \
  --max-retry-attempts=3 \
  --max-retry-duration=300s \
  --min-backoff-duration=30s \
  --max-backoff-duration=120s \
  --project=smart-order-469705
```

### 4. Run Historical Backfill

Import existing sales data:

```bash
# Import last 30 days
node scripts/import_foodics_sales_backfill.js --from 2023-09-01 --to 2023-10-01

# Dry run to preview import
node scripts/import_foodics_sales_backfill.js --from 2023-09-01 --dry-run

# Import specific branch only
node scripts/import_foodics_sales_backfill.js --branch 12345 --from 2023-09-01
```

## Usage Examples

### Manual Sync Triggers

```bash
# Trigger sales sync for specific tenant
curl -X POST https://ordertech.me/admin/tenants/{tenant_id}/integrations/foodics/sync-sales \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json"

# Check sync status
curl https://ordertech.me/admin/tenants/{tenant_id}/integrations/foodics/sales-status \
  -H "Authorization: Bearer {admin_token}"
```

### Query Sales Data

```sql
-- Recent orders with customer info
SELECT 
    so.external_id as foodics_order_id,
    so.created_at,
    so.status,
    so.total,
    so.currency,
    c.name as customer_name,
    c.phone as customer_phone
FROM sales_orders so
LEFT JOIN customers c ON so.customer_id = c.id
WHERE so.tenant_id = 'your-tenant-id'
  AND so.created_at >= NOW() - INTERVAL '7 days'
ORDER BY so.created_at DESC;

-- Order items with products
SELECT 
    so.external_id as order_id,
    soi.quantity,
    soi.unit_price,
    soi.total,
    p.name as product_name
FROM sales_orders so
JOIN sales_order_items soi ON so.id = soi.order_id
LEFT JOIN products p ON soi.product_id = p.id
WHERE so.tenant_id = 'your-tenant-id'
  AND so.created_at >= CURRENT_DATE;

-- Customer order history
SELECT 
    c.name,
    c.phone,
    COUNT(so.id) as order_count,
    SUM(so.total) as total_spent,
    MAX(so.created_at) as last_order
FROM customers c
JOIN sales_orders so ON c.id = so.customer_id
WHERE c.tenant_id = 'your-tenant-id'
GROUP BY c.id, c.name, c.phone
ORDER BY total_spent DESC;
```

### Sync Status Monitoring

```sql
-- Recent sync runs
SELECT 
    provider,
    started_at,
    finished_at,
    ok,
    stats->>'processed' as orders_processed,
    stats->>'errors' as errors
FROM integration_sync_runs 
WHERE provider LIKE 'foodics-sales%'
ORDER BY started_at DESC 
LIMIT 10;

-- Current sync cursor position
SELECT 
    provider,
    cursor_value,
    updated_at
FROM integration_cursors 
WHERE provider = 'foodics-sales';
```

## Configuration Options

### Sync Behavior

- **Frequency**: Every 5 minutes (configurable in Cloud Scheduler)
- **Overlap Window**: 30 minutes lookback to catch late updates
- **Batch Size**: 100 orders per API call, 10 orders per database batch
- **Retry Logic**: 3 attempts with exponential backoff

### Data Filtering

The sync processes:
- ✅ Paid and closed orders
- ✅ Customer orders and walk-ins
- ✅ All payment methods
- ❌ Canceled/voided orders (configurable)
- ❌ Draft/pending orders

### Performance

- **Mapping Cache**: In-memory ID lookups reduce database queries
- **Transactions**: Consistent batch operations
- **Advisory Locks**: Prevent concurrent sync conflicts
- **Selective Updates**: Only process changed data

## Troubleshooting

### Common Issues

**Token Authentication Errors:**
```bash
# Verify token is valid
curl -H "Authorization: Bearer $FOODICS_TOKEN" https://api.foodics.com/v5/orders?limit=1
```

**Sync Not Running:**
```bash
# Check Cloud Scheduler status
gcloud scheduler jobs describe foodics-sales-sync --project=smart-order-469705

# View recent logs
gcloud logging read "resource.type=cloud_scheduler_job" --limit=10 --format=json
```

**Database Connection Issues:**
```bash
# Test database connectivity
node -e "const { Pool } = require('pg'); const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: false}); pool.query('SELECT NOW()').then(r => console.log('DB OK:', r.rows[0])).catch(e => console.error('DB Error:', e.message));"
```

**Data Inconsistencies:**
```sql
-- Find orders without items
SELECT so.external_id 
FROM sales_orders so 
LEFT JOIN sales_order_items soi ON so.id = soi.order_id 
WHERE soi.id IS NULL;

-- Check mapping completeness
SELECT COUNT(*) FROM sales_order_items WHERE product_id IS NULL;
```

### Error Recovery

**Restart Stuck Sync:**
```sql
-- Clear any hanging locks
SELECT pg_advisory_unlock_all();

-- Reset sync cursor if needed
UPDATE integration_cursors 
SET cursor_value = '2023-10-01T00:00:00Z' 
WHERE provider = 'foodics-sales' AND tenant_id = 'your-tenant-id';
```

**Backfill Missing Data:**
```bash
# Backfill specific date range
node scripts/import_foodics_sales_backfill.js --from 2023-10-01 --to 2023-10-02

# Include canceled orders if needed
node scripts/import_foodics_sales_backfill.js --from 2023-10-01 --include-canceled
```

## API Reference

### Sync Endpoints

**POST /admin/tenants/:id/integrations/foodics/sync-sales**
- Triggers manual sales sync for tenant
- Returns: `{ status: 'started', runId: 'uuid' }`

**GET /admin/tenants/:id/integrations/foodics/sales-status**
- Returns recent sync runs and current cursor position
- Includes statistics and error information

**POST /cron/foodics-sales-sync**
- Scheduled endpoint for Cloud Scheduler
- Processes all tenants with active Foodics integrations
- Returns: `{ success: true, tenants: [...] }`

### Data Models

See the database schema in `migrations/20251020_foodics_sales.sql` for complete field definitions.

## Contributing

When modifying the integration:

1. Update transformers for new Foodics API fields
2. Add new upsert methods for additional data types
3. Update the backfill script for new filtering options
4. Add tests for new transformer logic
5. Document any breaking changes

## Security Notes

- Foodics tokens have full access - store securely
- Admin endpoints require authentication
- Database queries use parameterized statements
- Sync logs may contain customer data - handle appropriately