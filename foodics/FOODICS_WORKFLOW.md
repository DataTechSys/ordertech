# Foodics Platform Integration Workflow

## Overview
The Foodics platform at `foodics.ordertech.me` provides a complete integration layer between Foodics POS and DataTech services (DriveThru POS, Digital Signage, Loyalty System).

## User Registration & Onboarding Flow

### Step 1: Initial Registration
**URL:** https://foodics.ordertech.me/register.html

**What tenant provides:**
- Business email address
- Business name (optional)

**What happens:**
1. System creates a pending account
2. Sends verification email with password setup link
3. Account status: `pending_verification`

### Step 2: Email Verification
**Tenant receives email with:**
- Verification link
- Instructions to set password

**What happens when clicked:**
1. Email is verified
2. Tenant sets their password
3. Account status: `active`

### Step 3: Initial Login
**URL:** https://foodics.ordertech.me/login.html

**Credentials:**
- Email
- Password (set in step 2)

**After successful login:**
- Redirected to dashboard
- Sees "Configure Foodics" prompt

### Step 4: Foodics Configuration
**Location:** Dashboard → Foodics Settings

**Tenant provides:**
1. **Foodics Account ID** - Their business ID from Foodics
2. **Foodics API Token** - Generated from Foodics Developer Portal

**What happens:**
1. System validates token with Foodics API
2. Initiates data sync:
   - Business info
   - Branches
   - Products
   - Categories
   - Modifiers
   - Prices
3. Stores encrypted token in database
4. Account status: `configured`

### Step 5: Data Synchronization
**Automatic sync:**
- Real-time via webhooks (if configured)
- Scheduled sync every 15 minutes
- Manual sync available in dashboard

**Synced data:**
- Menu items (products, categories, modifiers)
- Pricing updates
- Inventory levels
- Branch information
- Order status

## iOS App Integration

### How iOS Apps Connect

**DriveThru POS App:**
1. App connects to `foodics.ordertech.me` database
2. Retrieves tenant's Foodics token (encrypted)
3. Uses token to:
   - Fetch menu data
   - Send orders to Foodics
   - Update inventory
   - Sync order status

**Authentication flow:**
```
iOS App → foodics.ordertech.me DB
       → Get tenant config + encrypted token
       → Decrypt token locally
       → Use token with Foodics API
```

**Example API endpoints app uses:**
- `GET /api/foodics/menu` - Get synced menu
- `POST /api/foodics/orders` - Submit orders
- `GET /api/foodics/branches` - Get branch list
- `GET /api/foodics/sync-status` - Check sync health

## Architecture

```
┌─────────────────┐
│   Tenant        │
│  (Restaurant)   │
└────────┬────────┘
         │
         │ 1. Register
         │ 2. Verify Email
         │ 3. Set Password
         │ 4. Add Foodics Token
         ▼
┌─────────────────────────┐
│ foodics.ordertech.me    │
│  (DataTech Platform)    │
│                         │
│  - User Management      │
│  - Token Storage        │
│  - Data Sync Engine     │
│  - Webhook Handler      │
└───────┬─────────────────┘
        │
        │ 5. Sync Data
        ▼
┌─────────────────┐
│  Foodics API    │
│                 │
│  - Products     │
│  - Orders       │
│  - Inventory    │
└─────────────────┘
        ▲
        │ 6. Send Orders
        │    Get Menu
        │
┌───────┴─────────┐
│  iOS Apps       │
│                 │
│  - DriveThru    │
│  - Display      │
│  - Kiosk        │
└─────────────────┘
```

## Database Schema

### foodics_tenants
```sql
- id (uuid, primary key)
- email (unique)
- business_name
- foodics_account_id
- foodics_token_encrypted
- status (pending_verification, active, configured)
- created_at
- verified_at
- last_sync_at
```

### foodics_products (synced)
```sql
- id (uuid)
- tenant_id (fk)
- foodics_product_id
- name
- name_localized (JSON)
- price
- category_id
- is_active
- synced_at
```

### foodics_orders (submitted)
```sql
- id (uuid)
- tenant_id (fk)
- foodics_order_id
- items (JSON)
- total
- status
- created_at
- submitted_at
```

## Security

### Token Storage
- Foodics API tokens are encrypted at rest
- Encryption key stored in Cloud Secret Manager
- Tokens decrypted only when needed for API calls

### API Access
- JWT-based authentication for tenant access
- Role-based permissions
- Rate limiting on all endpoints

### iOS App Security
- Tokens cached securely in iOS Keychain
- TLS/SSL for all communications
- Token refresh on expiry

## Pricing Integration

The pricing page at `foodics.ordertech.me/prices.html` shows:
- **DriveThru POS System**: $49/device/month (Basic)
- **Digital Signage**: Tiered pricing by screen count
- **Bundle Discounts**: 15% off for multiple products

Tenant subscribes → Gains access to iOS apps + dashboard

## Support & Documentation

**For Tenants:**
- Getting Started Guide: `/foodics/docs/getting-started`
- Foodics API Setup: https://developers.foodics.com
- Support Email: support@ordertech.me

**For Developers:**
- API Documentation: `/api/docs`
- Webhook Configuration: `/foodics/docs/webhooks`
- iOS SDK: GitHub repository

## Next Steps After Configuration

1. **Install iOS Apps** on devices
2. **Configure Hardware** (tablets, displays, printers)
3. **Test Orders** in sandbox mode
4. **Train Staff** on the system
5. **Go Live** when ready

---

**Last Updated:** 2025-10-30
**Version:** 1.0
