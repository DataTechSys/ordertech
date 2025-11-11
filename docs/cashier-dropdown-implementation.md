# Cashier Dropdown Implementation for DriveThru Devices

**Date**: 2025-01-07  
**Feature**: Add cashier selection when creating DriveThru devices

## Overview

When adding a new DriveThru device through the Foodics dashboard, users can now select which Foodics cashier will receive orders from that device. This provides device-level routing control for order push to Foodics POS.

## What Was Implemented

### 1. Frontend Changes (`foodics/devices.html`)

#### New UI Components:
- **Cashier Dropdown Field**: Appears after selecting a branch (DriveThru devices only)
- **Label**: "Default Cashier (for Orders) *"
- **Help Text**: "Orders from this device will be sent to the selected cashier"

#### User Flow:
1. User clicks "Add Device"
2. Selects device type: "DriveThru"
3. Selects branch from dropdown
4. **NEW**: Cashier dropdown automatically loads Foodics users for selected branch
5. **NEW**: "OrderTech" cashier is auto-selected if found
6. User saves device with cashier assignment

#### JavaScript Functions Added:
- `loadCashiersForBranch()`: Fetches cashiers from Foodics API based on selected branch
  - Calls `GET /api/foodics/cashiers?branch_id={foodics_branch_id}`
  - Auto-selects "OrderTech" user if found
  - Shows user with format: "Name (@username)"
  - Handles loading states and errors

#### Validation:
- Cashier selection is **required** for DriveThru devices
- Form won't submit without cashier selected
- Cashier field only shown for DriveThru (hidden for Label Printers)

### 2. Backend Changes

#### Updated Endpoint: `POST /api/foodics/devices`
**File**: `routes/foodics-api.js`

**New Parameter**: `cashier_id` (optional)

**Behavior**:
- Accepts `cashier_id` in request body
- Stores cashier_id in device `meta` as `foodics_cashier_id_override`
- This override takes precedence over branch-level default

**Example Request**:
```json
{
  "device_name": "Drive Lane 1",
  "device_type": "drivethru",
  "branch_id": "branch-uuid",
  "cashier_id": "foodics-user-uuid"
}
```

**Device Meta Structure**:
```json
{
  "foodics_cashier_id_override": "foodics-user-uuid"
}
```

#### Updated Endpoint: `GET /api/foodics/branches`
**Change**: Now returns `meta` field for each branch

This allows the frontend to access `foodics_branch_id` needed to fetch cashiers from Foodics.

**Response Example**:
```json
{
  "success": true,
  "branches": [
    {
      "branch_id": "local-uuid",
      "branch_name": "Main Branch",
      "meta": {
        "foodics_branch_id": "abc123",
        "foodics_data": { ... }
      }
    }
  ]
}
```

## Configuration Hierarchy

When an order is pushed to Foodics, the system resolves the cashier in this order:

1. **Device Override** (`saas.devices.meta.foodics_cashier_id_override`) ← **NEW**
2. **Branch Default** (`saas.branches.meta.foodics_cashier_id`)
3. **Fallback**: Error (configuration required)

This is handled by the existing database function:
```sql
SELECT get_device_foodics_config(device_id);
```

## Example Scenarios

### Scenario 1: Single Cashier per Branch
- All DriveThru devices in a branch use the same cashier
- Set cashier at branch level (future feature)
- No device overrides needed

### Scenario 2: Multiple Drive-Thru Lanes
- Branch has 2 drive-thru lanes
- Lane 1 device → Cashier "OrderTech"
- Lane 2 device → Cashier "OrderTech2"
- Each device has its own cashier override

### Scenario 3: Shared Terminal, Multiple Devices
- Multiple DriveThru devices (kiosk, display)
- All route to same cashier: "OrderTech"
- Set cashier override on each device

## API Endpoints Used

### Existing (from previous implementation):
- `GET /api/foodics/terminals?branch_id={id}` - Get POS terminals
- `GET /api/foodics/cashiers?branch_id={id}` - Get Foodics users/cashiers
- `GET /api/foodics/branches` - Get tenant branches (now includes meta)

### Used by Device Creation:
- `GET /api/foodics/cashiers?branch_id={foodics_branch_id}` - Load dropdown options
- `POST /api/foodics/devices` - Create device with cashier_id

## Database Storage

### Device Record:
```sql
INSERT INTO saas.devices (
  tenant_id, 
  branch_id, 
  device_name, 
  device_type, 
  status, 
  role, 
  meta
) VALUES (
  'tenant-uuid',
  'branch-uuid',
  'Drive Lane 1',
  'drivethru',
  'revoked',
  'cashier',
  '{"foodics_cashier_id_override": "foodics-user-uuid"}'::jsonb
);
```

### Query Device Config:
```sql
-- Get effective cashier for a device (includes override logic)
SELECT get_device_foodics_config('device-uuid');

-- Returns:
{
  "foodics_branch_id": "abc123",
  "foodics_terminal_id": "terminal-001",
  "foodics_cashier_id": "ordertech-user-uuid"  -- from device override or branch default
}
```

## UI Screenshots (Conceptual)

### Before (Old):
```
Add New Device
---------------
Device Name: [_________________]
Device Type: [DriveThru ▼]
Branch:      [Main Branch ▼]

[Cancel] [Add Device]
```

### After (New):
```
Add New Device
---------------
Device Name:     [_________________]
Device Type:     [DriveThru ▼]
Branch:          [Main Branch ▼]
Default Cashier: [OrderTech ▼]  ← NEW
                 Orders from this device will be sent to the selected cashier

[Cancel] [Add Device]
```

## Testing Checklist

- [x] Frontend: Cashier dropdown appears when branch selected
- [x] Frontend: Cashier dropdown hidden for Label Printers
- [x] Frontend: Auto-selects "OrderTech" if found
- [x] Frontend: Validation prevents submission without cashier
- [x] Backend: Accepts cashier_id parameter
- [x] Backend: Stores cashier_id in device meta
- [x] Backend: Returns meta in branches endpoint
- [ ] Integration: Create device and verify meta is saved
- [ ] Integration: Verify order push uses device cashier override
- [ ] End-to-end: Place order and confirm it appears on correct POS

## Future Enhancements

1. **Branch-Level Default Cashier**
   - Add UI to set default cashier for entire branch
   - Device overrides still take precedence

2. **Edit Device Cashier**
   - Allow changing cashier for existing devices
   - Add to device card or edit modal

3. **Cashier Analytics**
   - Show order count per cashier
   - Display active/inactive cashiers

4. **Multi-Cashier Support**
   - Round-robin order routing
   - Load balancing across multiple cashiers

## Files Modified

1. `foodics/devices.html` - Added cashier dropdown UI and logic
2. `routes/foodics-api.js` - Updated device creation and branches endpoints

## Related Documentation

- Main implementation plan: `docs/foodics-order-push-implementation.md`
- Progress tracking: `docs/foodics-order-push-progress.md`
- Database schema: `sql/migrations/025_foodics_order_push.sql`

---

**Status**: ✅ Complete and ready for testing  
**Next Step**: Test device creation with cashier selection, then implement order push logic
