# Foodics Branches - Direct API Fetch Implementation

**Date**: 2025-01-07  
**Change**: Fetch branches from Foodics API instead of local database

## Problem

Previously, branches were loaded from the local `saas.branches` table, which required manual syncing and could become out of sync with Foodics.

## Solution

Modified the system to fetch branches directly from Foodics API in real-time when needed.

## Changes Made

### 1. Backend: Updated `GET /api/foodics/branches` Endpoint

**File**: `routes/foodics-api.js`

**Before**: Queried `saas.branches` table
```javascript
SELECT branch_id, branch_name, meta 
FROM saas.branches 
WHERE tenant_id = $1 AND deleted_at IS NULL 
ORDER BY branch_name
```

**After**: Fetches from Foodics API
```javascript
const foodicsClient = makeClient(api_token);
const result = await foodicsClient.listBranches();
```

**Response Format**:
```json
{
  "success": true,
  "branches": [
    {
      "branch_id": "foodics-branch-uuid",
      "branch_name": "Main Branch",
      "reference": "B01",
      "meta": {
        "foodics_branch_id": "foodics-branch-uuid",
        "foodics_data": { /* full branch object */ }
      }
    }
  ]
}
```

### 2. Device Storage: Changed to Use Foodics IDs

**File**: `routes/foodics-api.js` - `POST /api/foodics/devices`

**Changed Behavior**:
- No longer stores FK to `saas.branches` table
- Stores Foodics branch ID directly in device `meta`
- Sets `branch_id` column to `NULL`

**Device Meta Structure**:
```json
{
  "foodics_branch_id": "foodics-branch-uuid",
  "foodics_branch_name": "Main Branch",
  "foodics_cashier_id_override": "cashier-uuid"
}
```

**SQL Change**:
```sql
-- Before:
INSERT INTO saas.devices (tenant_id, branch_id, device_name, ...)
VALUES ($1, $2, $3, ...);  -- branch_id was local UUID

-- After:
INSERT INTO saas.devices (tenant_id, branch_id, device_name, meta, ...)
VALUES ($1, NULL, $2, $3, ...);  -- branch_id is NULL, Foodics ID in meta
```

### 3. Frontend: Send Branch Name

**File**: `foodics/devices.html`

**Change**: Include `branch_name` in device creation request

```javascript
const body = {
  device_name: name,
  device_type: type,
  branch_id: branch_id,        // Foodics ID
  branch_name: branch_name,    // Foodics branch name
  cashier_id: cashier_id
};
```

### 4. Device Display: Show Branch from Meta

**File**: `routes/foodics-api.js` - `GET /api/foodics/devices`

**Change**: Display branch name from meta if not in FK join

```javascript
const devicesWithBranch = devicesRows.map(d => ({
  ...d,
  branch_name: d.branch_name || d.meta?.foodics_branch_name || 'N/A'
}));
```

## Benefits

### ✅ Always Up-to-Date
- Branch list reflects current Foodics state
- No manual sync required
- Automatic updates when branches change in Foodics

### ✅ Simpler Architecture
- No need to maintain local branch copies
- No sync conflicts between systems
- Reduced database complexity

### ✅ Single Source of Truth
- Foodics is the authoritative source
- No data duplication
- Consistent branch information

## Migration Notes

### Existing Devices
- Devices created before this change still have `branch_id` FK
- These will show branch name from the join
- New devices store branch info in meta only

### Backward Compatibility
- Old devices with `branch_id` FK still work
- New devices use meta storage
- Both approaches coexist

## Data Flow

```
User Opens Dashboard
    ↓
GET /api/foodics/branches
    ↓
Fetch from Foodics API
    ↓
Return real-time branch list
    ↓
User Selects Branch → Loads Cashiers
    ↓
User Creates Device
    ↓
Store Foodics IDs in device.meta
```

## API Calls

### When Opening Device Modal:
1. `GET /api/foodics/branches` → Fetches from Foodics
2. User selects branch
3. `GET /api/foodics/cashiers?branch_id=...` → Fetches from Foodics

### When Creating Device:
1. `POST /api/foodics/devices` with Foodics IDs
2. Stores in `saas.devices` with meta containing Foodics references

## Configuration Stored in Device Meta

```json
{
  "foodics_branch_id": "abc-123",
  "foodics_branch_name": "Main Branch",
  "foodics_cashier_id_override": "cashier-xyz"
}
```

This is everything needed to push orders to Foodics!

## Error Handling

### No API Token
```json
{
  "error": "Foodics API token not configured",
  "message": "Please configure your Foodics API token in Settings"
}
```

### Foodics API Error
```json
{
  "error": "Failed to fetch branches from Foodics",
  "details": "Network timeout / Auth error / etc"
}
```

## Testing Checklist

- [ ] Branches load from Foodics when modal opens
- [ ] Branch list is up-to-date with Foodics
- [ ] Cashiers load for selected Foodics branch
- [ ] Device creation stores Foodics IDs in meta
- [ ] Device list shows correct branch names
- [ ] Existing devices (with FK) still display correctly
- [ ] Error messages show when API token missing

## Future Considerations

### Option 1: Keep Current Approach
- Always fetch from Foodics
- Real-time data
- More API calls

### Option 2: Hybrid Approach
- Cache branches in local DB
- Refresh on demand
- Fallback to cache if API fails

### Option 3: Background Sync
- Periodic sync (hourly/daily)
- Use local cache for display
- Update on Foodics webhook

**Current Decision**: Keep Option 1 (Always fetch from Foodics)
- Simple
- Always accurate
- API calls are fast
- Can add caching later if needed

## Files Modified

1. `routes/foodics-api.js`:
   - `GET /api/foodics/branches` - Fetch from Foodics
   - `POST /api/foodics/devices` - Store Foodics IDs in meta
   - `GET /api/foodics/devices` - Display branch from meta

2. `foodics/devices.html`:
   - Send `branch_name` in device creation

## Related Documentation

- Main implementation: `docs/foodics-order-push-implementation.md`
- Cashier dropdown: `docs/cashier-dropdown-implementation.md`
- Database schema: `sql/migrations/025_foodics_order_push.sql`

---

**Status**: ✅ Complete
**Impact**: All new devices use Foodics IDs directly - no local branch dependency
