# Modifier Fix Implementation Plan

## Problem Summary
The iOS app is not displaying modifiers for products because the Foodics API `/modifier_options` endpoint is not returning the `modifier_id` field, which is crucial for linking modifier options to their respective modifier groups.

## Changes Made

### 1. Enhanced Data Models (FoodicsModels.swift)
**Added fields to capture complete Foodics data:**

#### FoodicsModifierGroup
- ✅ Added `sku` field
- ✅ Added `is_active` field
- ✅ Added `is_ready` field
- ✅ Added `deleted_at` field
- ✅ Added proper decoding logic for all status fields

#### FoodicsModifierOption
- ✅ Added `sku` field
- ✅ Already has `modifier_id` field (but API isn't returning it)
- ✅ Already has `is_active`, `is_ready`, `deleted_at` fields
- ✅ Updated init methods to include SKU

### 2. Enhanced CatalogStore Logic
**Added filtering for active-only data:**

- ✅ Filter modifier groups to only active/ready/not-deleted
- ✅ Filter modifier options to only active/ready/not-deleted (already implemented)
- ✅ Added logging to verify all fields are being captured including SKU
- ✅ Added logging to count how many options have `modifier_id` populated

## Current Data Flow

### Step 1: Fetch All Modifiers Data
```swift
// 1. Fetch all modifier options
let modifierOptions = try await client.listModifierOptions()

// 2. Fetch all modifier groups  
let modifierGroups = try await client.listModifierGroups()

// 3. Fetch products with embedded modifiers
let products = try await client.listProducts() // includes modifiers via include=category,modifiers
```

### Step 2: Filter Active Only
```swift
// Filter options: only active, ready, not deleted
let activeOptions = modifierOptions.filter { opt in
    let active = (opt.is_active ?? 1) == 1
    let ready = (opt.is_ready ?? 1) == 1
    let notDeleted = (opt.deleted_at == nil) || ((opt.deleted_at ?? \"\").isEmpty)
    return active && ready && notDeleted
}

// Filter groups: only active, ready, not deleted
let activeGroups = modifierGroups.filter { g in
    let active = (g.is_active ?? 1) == 1
    let ready = (g.is_ready ?? 1) == 1
    let notDeleted = (g.deleted_at == nil) || ((g.deleted_at ?? \"\").isEmpty)
    return active && ready && notDeleted
}
```

### Step 3: Build Mapping (THE PROBLEM IS HERE)
```swift
// Try to map options to groups using modifier_id field
var optionsByGroupId = [String: [FoodicsModifierOption]]()
for option in activeOptions {
    if let gid = option.modifier_id, !gid.isEmpty {
        optionsByGroupId[gid, default: []].append(option)
    }
}
// ❌ ISSUE: modifier_id is nil/empty for all options from Foodics API
// Result: optionsByGroupId is EMPTY
```

### Step 4: Map Products to Modifiers
```swift
// For each product, use embedded modifiers array
for product in products {
    for embeddedModifier in product.modifiers {
        // Get group ID from embedded modifier
        let groupId = embeddedModifier.id
        
        // Look up options for this group
        let options = optionsByGroupId[groupId] ?? []
        // ❌ ISSUE: options is EMPTY because mapping failed in Step 3
        
        // Get excluded option IDs from pivot table
        let excludedIds = embeddedModifier.pivot?.excluded_options_ids ?? []
        
        // Filter out excluded options
        let validOptions = options.filter { !excludedIds.contains($0.id) }
        
        // Build modifier group with min/max from pivot
        let modifierGroup = ModifierGroup(
            id: groupId,
            name: embeddedModifier.name,
            min: embeddedModifier.pivot?.minimum_options ?? 0,
            max: embeddedModifier.pivot?.maximum_options ?? 1,
            options: validOptions // ❌ EMPTY!
        )
    }
}
```

## Root Cause Analysis

The Foodics API endpoint `/v5/modifier_options` is returning options **WITHOUT** the `modifier_id` field:

```json
{
  "data": [
    {
      "id": "option-uuid",
      "name": "Oat Milk",
      "price": 0.5,
      "is_active": 1,
      "is_ready": 1,
      "deleted_at": null,
      // ❌ MISSING: "modifier_id": "group-uuid"
    }
  ]
}
```

## Solution Options

### Option 1: Fix Foodics API Request (RECOMMENDED)
**Check if the API requires an include parameter:**

According to Foodics docs, try adding `include=modifier` to the request:
```swift
"/modifier_options?include=modifier"
```

This might populate the `modifier_id` field.

### Option 2: Use Alternative Endpoint
**Check if there's a product-specific modifier endpoint:**

Instead of fetching all options globally, fetch per-product:
```
GET /v5/products/{productId}/modifiers
GET /v5/products/{productId}/modifier_options
```

### Option 3: Use Embedded Product Data ONLY (CURRENT FALLBACK)
**Rely on the embedded modifiers in products:**

The product response already includes:
- Modifier group metadata (id, name, reference)
- Pivot table with min/max/excluded/default options
- BUT needs separate lookup for option details

**Problem:** We still need option names and prices, which come from modifier_options.

### Option 4: Fetch Options Per Group
**After getting modifier groups, fetch options for each:**

```swift
for group in modifierGroups {
    let options = try await client.fetchOptionsForGroup(groupId: group.id)
    // This endpoint might return options with proper group linkage
}
```

## Next Steps

### Immediate Actions:

1. **Run the updated app** and check the debug logs:
   ```
   [CatalogStore] Sample modifier option: ... modifier_id=MISSING
   [CatalogStore] Options with modifier_id field: 0/448
   ```

2. **Test if `include=modifier` helps:**
   - Update `FoodicsClient.listModifierOptions()` to use:
     ```swift
     "/modifier_options?include=modifier"
     ```

3. **Check Foodics API documentation:**
   - Visit: https://developers.foodics.com/guides/introduction.html
   - Look for:
     - Modifier options endpoint documentation
     - Include parameters for relationships
     - Alternative endpoints for modifier data

4. **Contact Foodics Support** if needed:
   - Ask: "How do we get the `modifier_id` field populated in `/v5/modifier_options` response?"
   - Ask: "Is there a relationship we need to include in the request?"

### Test Script:
```bash
# Build and run
cd /Users/mosawi/DATATECH/OrderTech/ios
xcodebuild -workspace OrderTech.xcworkspace -scheme OrderTech -destination 'platform=iOS Simulator,name=iPhone 15' | grep "\[CatalogStore\]"
```

## Expected Behavior After Fix

Once `modifier_id` is populated in modifier options:

1. ✅ All modifier groups show with correct options
2. ✅ Options are filtered by active/ready status
3. ✅ Excluded options are properly filtered out
4. ✅ Min/max selections enforced
5. ✅ SKU fields available for all entities

## Files Modified

1. `OrderTechCore/Sources/OrderTechCore/FoodicsModels.swift`
   - Enhanced `FoodicsModifierGroup` with SKU and status fields
   - Enhanced `FoodicsModifierOption` with SKU field

2. `OrderTech/Sources/Features/Catalog/CatalogStore.swift`
   - Added filtering for active modifier groups
   - Added detailed logging for debugging
   - Added SKU field verification

## Testing Checklist

- [ ] Verify modifier_id field is present in API response
- [ ] Verify active-only filtering works correctly
- [ ] Verify SKU fields are captured
- [ ] Verify excluded options are filtered out
- [ ] Test product with multiple modifier groups
- [ ] Test min/max selection constraints
- [ ] Test delivery modifier group is hidden
