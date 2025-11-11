# Foodics Real-Time Sales Dashboard

## Overview

A real-time sales analytics dashboard that reads data directly from the Foodics API v5 without importing/storing in the database. This provides instant, up-to-date sales metrics and product performance data.

## Architecture

```
Frontend (sales.html)
    ↓
Backend API (Express routes)
    ↓
Foodics Service Layer
    ↓
Foodics API v5 (live data)
```

## Components Created

### 1. **Services Layer** (`services/foodicsService.js`)

Provides client functions for Foodics API:
- `createClient(apiToken)` - Create authenticated API client
- `getOrders(filters)` - Fetch orders with pagination
- `getProducts(filters)` - Fetch products with categories and images
- `getCategories()` - Fetch product categories
- `getBranches()` - Fetch store branches
- `getCustomers()` - Fetch customer data

Analytics calculation functions:
- `calculateSalesSummary(orders)` - Total revenue, avg order value, order counts
- `calculateProductSales(orders, products)` - Product-level sales metrics
- `calculateCustomerStats(orders)` - Customer spending patterns

### 2. **API Routes** (`routes/foodics-analytics.js`)

RESTful endpoints for analytics:

#### `GET /api/foodics/analytics/sales-summary`
Returns overall sales metrics for date range.

**Query params:**
- `foodics_id` (required) - Tenant Foodics ID
- `from` (required) - Start date (YYYY-MM-DD)
- `to` (required) - End date (YYYY-MM-DD)
- `branch_id` (optional) - Filter by branch
- `status` (optional) - Order status (1-4)

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_orders": 51,
    "total_revenue": 120.940,
    "total_discount": 5.200,
    "total_tax": 0.000,
    "avg_order_value": 2.370,
    "orders_by_status": { "4": 51 },
    "orders_by_type": { "1": 30, "2": 21 },
    "orders_by_day": {
      "2025-11-07": { "count": 51, "revenue": 120.940 }
    }
  }
}
```

#### `GET /api/foodics/analytics/product-sales`
Returns product-level sales with images and metrics.

**Query params:**
- `foodics_id` (required)
- `from`, `to` (required)
- `branch_id` (optional)
- `category_id` (optional)
- `limit` (optional) - Max products to return

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "id": "uuid",
      "name": "Cappuccino",
      "sku": "CAP001",
      "image": "https://...",
      "category_name": "Hot Drinks",
      "price": 2.500,
      "quantity_sold": 45,
      "total_revenue": 112.500,
      "orders_count": 30
    }
  ]
}
```

#### `GET /api/foodics/analytics/customer-stats`
Returns customer analytics.

#### `GET /api/foodics/analytics/branches`
Returns list of branches for filters.

#### `GET /api/foodics/analytics/categories`
Returns list of categories for filters.

### 3. **Frontend Dashboard** (`foodics/sales.html`)

Interactive sales dashboard with:

**Features:**
- 📅 Date range picker (defaults to last 7 days)
- 🏪 Branch filter dropdown
- 📦 Category filter dropdown
- 🔢 Configurable grid layout (1-6 columns)
- 🎯 Product limit control
- 🔄 Manual refresh button

**Display:**
- 4 summary cards: Total Revenue, Avg Order Value, Total Orders, Total Discount
- Product grid with:
  - Product images (with fallback to placeholder)
  - Product name and category
  - Revenue, Quantity Sold, Orders Count, Unit Price

**URL:** `https://foodics.ordertech.me/sales`

## Benefits vs. Database Import

✅ **Real-time data** - Always current, no sync delays  
✅ **No storage costs** - No duplicate data in Cloud SQL  
✅ **Simpler architecture** - No import scripts or cron jobs  
✅ **Lower maintenance** - No data staleness issues  
✅ **Faster development** - Skip entire backend import layer  

⚠️ **Trade-offs:**
- Slower initial load (fetches from Foodics each time)
- Dependent on Foodics API availability
- Limited to Foodics API rate limits
- No historical analysis beyond Foodics retention

## Usage

### For End Users

1. Navigate to `https://foodics.ordertech.me/sales`
2. Select date range (defaults to last 7 days)
3. Optionally filter by branch or category
4. Adjust grid layout and product limit
5. Click "Apply Filters" or "Refresh"

### For Developers

**Start server:**
```bash
node server.js
```

**Test API endpoint:**
```bash
curl "http://localhost:8080/api/foodics/analytics/sales-summary?foodics_id=494675&from=2025-11-01&to=2025-11-07"
```

**Access dashboard:**
```
http://localhost:8080/foodics/sales
```

## Configuration

API token is retrieved from database:
```sql
SELECT meta->>'foodics_api_token' 
FROM saas.tenants 
WHERE foodics_id = '494675'
```

Frontend gets Foodics ID from:
```javascript
localStorage.getItem('foodics_id') || '494675'
```

## Foodics API v5 Details

**Base URL:** `https://api.foodics.com/v5`

**Authentication:** Bearer token in Authorization header

**Key Endpoints Used:**
- `/orders` - Order data with items
- `/products` - Product catalog
- `/categories` - Product categories
- `/branches` - Store locations

**Pagination:** 100 items per page, automatic handling

**Includes:** `products,order_items,category,image`

## Future Enhancements

1. **Caching Layer** - Redis cache for 5-15 minute TTL
2. **Date Range Presets** - "Today", "Yesterday", "This Week", etc.
3. **Export to Excel** - Download sales reports
4. **Charts & Graphs** - Trend visualization
5. **Top Products Widget** - Quick insights
6. **Print-friendly View** - For reporting
7. **Multi-tenant Switching** - For platform admins
8. **Instagram Integration** - Product photos from IG posts (Phase 20)

## Files Created

```
services/foodicsService.js          # Foodics API client and analytics
routes/foodics-analytics.js         # Analytics REST API endpoints
foodics/sales.html                  # Sales dashboard frontend
docs/foodics-sales-dashboard.md     # This documentation
```

## Related Documentation

- `/docs/foodics-order-push-implementation.md` - Order push to Foodics
- `/foodics/README.md` - Foodics platform overview
- `https://developers.foodics.com/` - Foodics API docs
