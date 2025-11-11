# Foodics Order Push - Implementation Progress

**Last Updated**: 2025-01-07  
**Status**: Foundation Complete - 3/17 Tasks Done

## ✅ Completed Tasks (3/17)

### 1. Database Migrations ✅
**File**: `sql/migrations/025_foodics_order_push.sql`

**Completed**:
- Added `meta` JSONB column to `saas.branches` for Foodics configuration
- Added `meta` JSONB column to `saas.devices` for device-level overrides
- Added `meta` JSONB column to `orders` table for push tracking
- Created `order_items` table with Foodics mapping support
- Created `foodics_push_log` table for audit trail
- Created helper function `get_device_foodics_config()` to resolve effective config
- Created view `orders_pending_foodics_push` for retry queue
- Added GIN indexes for efficient JSONB queries

**Configuration Fields**:
- **Branch**: `foodics_branch_id`, `foodics_terminal_id`, `foodics_cashier_id`
- **Device**: `foodics_terminal_id_override`, `foodics_cashier_id_override`
- **Order**: `foodics_order_id`, `foodics_push_status`, `foodics_push_attempts`, `foodics_push_error`

### 2. Foodics Client Extension ✅
**File**: `server/integrations/foodics.js`

**New Methods Added**:
- `listTerminals(branchId)` - Get POS terminals/devices for a branch
- `listCashiers(branchId)` - Get users/cashiers for a branch
- `findOrderTechUser(branchId)` - Find the "OrderTech" user
- `listPaymentMethods()` - Get available payment methods
- `findCardPaymentMethod()` - Find the "Card" payment method
- `createOrder(orderData, idempotencyKey)` - Create order in Foodics with tracking

**Features**:
- Proper error handling with detailed logging
- Support for Idempotency-Key header
- Duration tracking for performance monitoring
- Filters by branch_id where applicable

### 3. Backend Configuration APIs ✅
**File**: `routes/foodics-api.js`

**New Endpoints**:
- `GET /api/foodics/terminals?branch_id=:id` - List terminals for dropdown
- `GET /api/foodics/cashiers?branch_id=:id` - List cashiers for dropdown
- `GET /api/foodics/branches/:branch_id/order-push-config` - Get branch config
- `POST /api/foodics/branches/:branch_id/order-push-config` - Save branch config
- `GET /api/foodics/devices/:device_id/order-push-config` - Get device overrides
- `POST /api/foodics/devices/:device_id/order-push-config` - Save device overrides

**Security**:
- All endpoints protected with `authenticateFoodicsToken`
- Tenant isolation enforced
- Branch/device ownership validation
- API tokens retrieved from `saas.tenants.meta`

## 🚧 In Progress / Next Steps

### High Priority (MVP)

#### 4. Dashboard UI: Branch Configuration
**Status**: Not Started  
**File**: `foodics/dashboard.html` or new file  
**Needs**:
- New section "Order Push to Foodics"
- Terminal dropdown (loads from `/api/foodics/terminals`)
- Cashier dropdown (loads from `/api/foodics/cashiers`, default "OrderTech")
- Save button
- Test Push button (optional for MVP)

#### 5. Order Push Logic
**Status**: Not Started  
**File**: `local-order-handler.js` or new `server/foodics-order-push.js`  
**Needs**:
1. Hook into existing `/api/local-order` endpoint
2. Load Foodics config from device/branch
3. Transform order to Foodics format
4. Map products and modifiers to Foodics IDs
5. Call `foodicsClient.createOrder()`
6. Update `orders.meta` with result
7. Don't block iOS app on Foodics failures

#### 6. Product/Modifier ID Mapping
**Status**: Not Started  
**Needs**:
- Ensure products table has Foodics IDs from sync
- Create mapping logic for order items
- Validation before push (fail if IDs missing)

### Medium Priority (MVP+ Improvements)

#### 7. Error Handling & Observability
- Structured logging
- Dashboard stats (success/failed counts)
- Error details in UI

#### 8. Retry Mechanism
- Cloud Scheduler endpoint
- Exponential backoff logic
- Idempotency handling

### Lower Priority (Post-MVP)

#### 9. Device-Level Overrides UI
- Add to devices.html
- Terminal/cashier dropdown per device

#### 10. Testing
- Unit tests
- Integration tests
- Sandbox environment testing

## 📋 Implementation Checklist

### Phase 1: Foundation (Complete) ✅
- [x] Database schema with meta columns
- [x] Foodics client methods for terminals, cashiers, order creation
- [x] Backend API endpoints for configuration

### Phase 2: Configuration UI (Next)
- [ ] Add branch configuration section to dashboard
- [ ] Terminal dropdown UI
- [ ] Cashier dropdown UI (default OrderTech)
- [ ] Save configuration functionality
- [ ] Show configuration status per branch

### Phase 3: Order Push Logic (Critical)
- [ ] Create order transformation logic
- [ ] Implement product/modifier ID mapping
- [ ] Hook into local-order endpoint
- [ ] Add push result tracking
- [ ] Handle failures gracefully

### Phase 4: Testing & Deployment
- [ ] Test with Foodics sandbox
- [ ] Verify order appears on POS terminal
- [ ] Deploy to Cloud Run
- [ ] Configure first tenant
- [ ] Monitor for 48 hours

## 🔑 Key Configuration Example

### Branch Configuration (stored in `saas.branches.meta`):
```json
{
  "foodics_branch_id": "abc-123",
  "foodics_terminal_id": "terminal-001",
  "foodics_cashier_id": "ordertech-user-id",
  "foodics_data": { /* full branch object from Foodics */ },
  "order_push_configured_at": "2025-01-07T10:00:00Z",
  "order_push_configured_by": "user-uuid"
}
```

### Device Override (stored in `saas.devices.meta`):
```json
{
  "foodics_terminal_id_override": "terminal-002",
  "foodics_cashier_id_override": "special-cashier-id"
}
```

### Order Tracking (stored in `orders.meta`):
```json
{
  "foodics_order_id": "foodics-order-uuid",
  "foodics_push_status": "success",
  "foodics_push_attempts": 1,
  "foodics_reference": "OT-550e8400-e29b-41d4-a716-446655440000",
  "payment_method_hint": "card"
}
```

## 🎯 Success Criteria

- [x] Database can store Foodics configuration
- [x] Backend APIs can fetch terminals and cashiers from Foodics
- [x] Backend APIs can save/retrieve configuration
- [ ] Dashboard UI allows branch configuration
- [ ] Orders are pushed to Foodics successfully
- [ ] Orders appear on configured POS terminal
- [ ] Failed pushes are logged and retryable
- [ ] No duplicate orders created

## 📦 Files Modified/Created

### Created:
1. `sql/migrations/025_foodics_order_push.sql` - Database schema
2. `docs/foodics-order-push-implementation.md` - Full plan
3. `docs/foodics-order-push-progress.md` - This file

### Modified:
1. `server/integrations/foodics.js` - Added order creation methods
2. `routes/foodics-api.js` - Added configuration endpoints

### To Be Modified:
1. `local-order-handler.js` - Add order push logic
2. `foodics/dashboard.html` - Add configuration UI
3. `foodics/devices.html` - Add device overrides UI (optional)

## 🚀 Deployment Steps (When Ready)

1. **Apply Database Migration**:
   ```bash
   psql $DATABASE_URL < sql/migrations/025_foodics_order_push.sql
   ```

2. **Deploy Backend**:
   ```bash
   gcloud run deploy ordertech --source . --region me-central1
   ```

3. **Configure Tenant**:
   - Login to foodics.ordertech.me
   - Go to Branch Settings
   - Select Terminal and Cashier
   - Save configuration

4. **Test Order**:
   - Place order via DriveThru iOS app
   - Verify order appears on POS terminal
   - Check logs for push status

## 📞 Support & References

- **Foodics API Docs**: https://apidocs.foodics.com/core/orders.html
- **Implementation Plan**: `docs/foodics-order-push-implementation.md`
- **TODO List**: Run `read_todos` command to see all tasks

---

**Next Immediate Action**: Create dashboard UI for branch configuration (Task #4)

**Estimated Time to MVP**: 2-3 days (with UI + order push logic + testing)
