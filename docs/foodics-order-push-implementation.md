# Foodics Order Push Implementation Plan

## Overview

This document outlines the implementation plan for pushing DriveThru orders from the OrderTech system to Foodics POS in real-time. When an order is placed via the DriveThru iOS app, it will be saved locally in OrderTech and automatically pushed to the configured Foodics POS terminal.

## Architecture

```
iOS DriveThru App
    ↓
    POST /api/local-order
    ↓
OrderTech Server (Cloud Run)
    ↓ (save local)
    orders table
    ↓ (async push)
    Foodics API (POST /orders)
    ↓
Foodics POS Terminal (at branch)
```

## Configuration Model

### Branch-Level Configuration
Stored in `saas.branches.meta`:
- `foodics_branch_id`: The Foodics branch ID
- `foodics_terminal_id`: Default POS terminal/device to push orders to
- `foodics_cashier_id`: Default cashier (user "OrderTech")
- `foodics_data`: Full branch object from Foodics

### Device-Level Overrides (Optional)
Stored in `saas.devices.meta`:
- `foodics_terminal_id_override`: Override branch default terminal
- `foodics_cashier_id_override`: Override branch default cashier

### Order Tracking
Stored in `orders.meta`:
- `foodics_order_id`: The order ID returned by Foodics
- `foodics_push_status`: pending/success/failed
- `foodics_push_attempts`: Number of push attempts
- `foodics_push_error`: Last error message
- `foodics_reference`: "OT-{local_order_id}" for idempotency

## Default Values

Based on your requirements:

1. **Cashier**: "OrderTech" user in Foodics (default, can be changed per device/branch)
2. **Payment Method**: "Card" (cashier can change on POS)
3. **Order Type**: "drive_thru" (or "takeaway" if Foodics doesn't support drive_thru type)
4. **Order Status**: "pending" (no payment attached initially)

## Implementation Phases

### Phase 1: Database & Configuration Foundation
**Status**: Not Started

1. Add `meta` JSONB column to `saas.branches` and `saas.devices`
2. Add `meta` JSONB column to `orders` table
3. Create indexes for efficient JSONB queries
4. Migration script: `sql/migrations/025_foodics_order_push.sql`

### Phase 2: Foodics API Research & Client Extension
**Status**: Not Started

1. Research Foodics Orders API endpoint and payload structure
2. Confirm supported order types (drive_thru vs takeaway)
3. Extend `server/integrations/foodics.js` with:
   - `listTerminals(branchId)` - GET /devices
   - `listCashiers(branchId)` - GET /users
   - `listPaymentMethods()` - GET /payment_methods (if needed)
   - `createOrder(orderData)` - POST /orders

### Phase 3: Backend Configuration APIs
**Status**: Not Started

Create endpoints in `routes/foodics-api.js`:
- `GET /api/foodics/terminals?branch_id=:id`
- `GET /api/foodics/cashiers?branch_id=:id`
- `GET /api/foodics/branches/:branch_uuid/config`
- `POST /api/foodics/branches/:branch_uuid/config`
- `GET /api/foodics/devices/:device_uuid/config` (optional)
- `POST /api/foodics/devices/:device_uuid/config` (optional)

### Phase 4: Dashboard UI for Configuration
**Status**: Not Started

Add branch configuration UI at `foodics.ordertech.me`:
- New section: Dashboard → Branch Settings → "Order Push Configuration"
- For each branch:
  - Terminal dropdown (populated from Foodics API)
  - Cashier dropdown (default: "OrderTech")
  - Save button
  - Test Push button (sends a sample order)

### Phase 5: Order Push Logic
**Status**: Not Started

Enhance `/api/local-order` endpoint:
1. Save order locally (existing behavior)
2. Resolve configuration (device override → branch default)
3. Transform order to Foodics format
4. Push to Foodics API
5. Store result in `orders.meta`
6. Return success to iOS app (don't block on Foodics failures)

### Phase 6: Product/Modifier Mapping
**Status**: Not Started

Ensure proper ID mapping:
- Products: Local IDs → Foodics product IDs
- Modifiers: Local modifier options → Foodics option IDs
- Validation before push (fail if mapping missing)

### Phase 7: Error Handling & Retry Logic
**Status**: Not Started

1. Implement retry worker (Cloud Scheduler or queue)
2. Exponential backoff: 1m, 5m, 15m, 1h, daily
3. Idempotency using order reference "OT-{uuid}"
4. Structured logging to Cloud Run

### Phase 8: Testing & Validation
**Status**: Not Started

Test scenarios:
- Happy path (simple order, order with modifiers)
- Missing product mapping
- API downtime
- Duplicate prevention
- Device override routing

### Phase 9: Deployment & Monitoring
**Status**: Not Started

1. Deploy to Cloud Run
2. Configure Foodics tokens per tenant
3. Configure branch terminals via dashboard
4. Monitor first 48 hours
5. Dashboard stats (success/failed push counts)

### Phase 10: Documentation
**Status**: Not Started

1. Admin guide (how to configure)
2. Developer runbook (debugging, retry logic)
3. API documentation

## Key Files to Modify

```
server/integrations/foodics.js          # Add order creation methods
routes/foodics-api.js                   # Configuration endpoints
local-order-handler.js                  # Order push logic
sql/migrations/025_foodics_order_push.sql  # Database schema
foodics/dashboard.html                  # UI for branch config
foodics/devices.html                    # UI for device overrides (optional)
```

## Foodics API Payload Example (To Be Verified)

```json
{
  "branch_id": "abc123",
  "device_id": "terminal-001",
  "user_id": "ordertech-user-id",
  "type": "drive_thru",
  "status": "pending",
  "source": "ordertech",
  "reference": "OT-550e8400-e29b-41d4-a716-446655440000",
  "notes": "Drive-Thru via OrderTech",
  "items": [
    {
      "product_id": "foodics-product-123",
      "quantity": 2,
      "unit_price": 12.50,
      "modifiers": [
        {
          "option_id": "foodics-option-456",
          "price": 1.00
        }
      ]
    }
  ]
}
```

## Security Considerations

1. **Token Management**: Store Foodics API tokens in `saas.tenants.meta` (encrypted at rest)
2. **Tenant Isolation**: Validate branch/device ownership before configuration
3. **Rate Limiting**: Protect configuration endpoints
4. **Logging**: Mask tokens in all logs
5. **Client-Side**: Never expose tokens to browser

## Success Metrics

- Order push success rate > 95%
- Average push latency < 2 seconds
- Retry success rate on transient failures
- Zero duplicate orders created

## Rollout Plan

1. **Internal Testing**: Use test Foodics account
2. **Pilot Tenant**: One branch for 1 week
3. **Gradual Rollout**: 10% → 50% → 100% over 2 weeks
4. **Feature Flag**: Enable per tenant after configuration

## References

- Foodics Developer Docs: https://developers.foodics.com/guides/introduction.html
- Foodics Orders API: https://apidocs.foodics.com/core/orders.html
- OrderTech Server: ordertech-715493130630.me-central1.run.app
- Dashboard: foodics.ordertech.me

## Next Steps

1. Research Foodics Orders API endpoint (Phase 2, Task 3)
2. Create database migration (Phase 1, Task 1)
3. Extend Foodics client with terminal/cashier listing (Phase 2, Task 3)

---

**Created**: 2025-01-07  
**Author**: AI Assistant  
**Status**: Planning Phase  
**Priority**: High
