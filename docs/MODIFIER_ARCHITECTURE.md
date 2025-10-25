# Modifier Architecture - Reference-Based System

## Overview

The OrderTech iOS app uses a **stable, reference-based architecture** for managing product modifiers. This approach is more reliable than ID-based lookups because it uses:

1. **Modifier Group References** (e.g., `"hot_milk"`, `"coffee_shot"`) - stable string identifiers
2. **Modifier Option SKUs** (e.g., `"MML-024"`, `"MML-023"`) - unique product codes

## Architecture Components

### 1. ModifierReferenceTable (`ModifierReferenceTable.swift`)

A cacheable lookup table that maps:
- **Group Reference → Group Metadata + Option SKUs**
- **Option SKU → Option Details (id, name, price, group)**

```swift
public struct ModifierReferenceTable: Codable {
    public var groups: [String: GroupEntry]      // "hot_milk" → GroupEntry
    public var options: [String: OptionEntry]    // "MML-024" → OptionEntry
    public var lastUpdated: Date
}
```

### 2. Building the Reference Table

The table is built by:
1. Fetching all modifier groups from Foodics API
2. Fetching all modifier options with `include=modifier` to get `modifier_id`
3. Analyzing product `excluded_options_ids` to discover option-group relationships
4. Storing the mapping locally in `modifier_reference_table.json`

```swift
// In CatalogStore.swift
modifierTable = ModifierReferenceTable.build(
    from: allGroups,
    options: modifierOptions,
    products: foodicsProducts
)

// Cache for offline use
try? LocalCache.saveJSON(table, to: "modifier_reference_table.json")
```

### 3. Resolving Modifiers for Products

When building a product, we use the reference table:

```swift
// Get product's embedded modifiers (contains group references + pivot data)
if let embeddedMods = product.modifiers, let table = modifierTable {
    // Use table to resolve all options for each group
    let resolvedGroups = table.resolveModifiersForProduct(embeddedModifiers: embeddedMods)
}
```

The `resolveModifiersForProduct` method:
1. Looks up each group by its **reference** (not ID)
2. Gets all options for that group by **SKU**
3. **Applies product-specific exclusions** from `pivot.excluded_options_ids`
4. Applies min/max/required rules from the pivot
5. Returns fully resolved modifier groups ready for display

## Why This Architecture?

### ✅ Advantages

1. **Stable References**: Group references like `"hot_milk"` don't change, unlike IDs
2. **Offline Support**: Table is cached locally - works without API
3. **Performance**: Single fetch + local lookups vs. repeated API calls
4. **Reliable**: SKUs are unique identifiers that merchants use
5. **Debugging**: Human-readable references (not UUIDs)

### ❌ Previous Issues

The old approach tried to fetch options per-group using non-existent API endpoints:
```
GET /modifiers/{id}/options → HTTP 405 (Method Not Allowed)
```

This never worked because Foodics API v5 doesn't support this endpoint pattern.

## Example: Hot Milk Group

### Data Flow

1. **Fetch Groups**:
   ```json
   {
     "id": "9b73d230-eb52-47a1-8621-9830f3a5ee37",
     "name": "Hot Milk",
     "reference": "hot_milk"
   }
   ```

2. **Fetch Options** (with `modifier_id`):
   ```json
   [
     {
       "id": "9b73d2e1-...",
       "sku": "MML-024",
       "name": "Barista FF Milk",
       "modifier_id": "9b73d230-...",
       "price": 0.5
     },
     {
       "id": "9b73d2e2-...",
       "sku": "MML-023",
       "name": "FF Sweet Milk",
       "modifier_id": "9b73d230-...",
       "price": 0.5
     },
     // ... 9 more options
   ]
   ```

3. **Build Reference Table**:
   ```swift
   groups["hot_milk"] = GroupEntry(
       id: "9b73d230-...",
       name: "Hot Milk",
       optionSKUs: ["MML-024", "MML-023", "MML-021", ...] // 11 SKUs
   )
   
   options["MML-024"] = OptionEntry(
       id: "9b73d2e1-...",
       name: "Barista FF Milk",
       sku: "MML-024",
       price: 0.5,
       groupReference: "hot_milk"
   )
   ```

4. **Product References Group**:
   ```json
   {
     "name": "HOT | Spanish Latte",
     "modifiers": [
       {
         "reference": "hot_milk",
         "pivot": {
           "excluded_options_ids": ["9b73d2e1-..."], // Exclude 1 option
           "minimum_options": 1,
           "maximum_options": 1
         }
       }
     ]
   }
   ```

5. **Resolve for Product**:
   ```swift
   // Look up by reference "hot_milk"
   let group = table.groups["hot_milk"]
   
   // Get all 11 options
   let allOptions = group.optionSKUs.map { table.options[$0] }
   
   // Filter out excluded (1 option)
   let available = allOptions.filter { !excludedIds.contains($0.id) }
   
   // Result: 10 options available for this product
   ```

## Logging

Look for these debug logs:

```
[ModifierReferenceTable] Built table with 12 groups and 92 options
[ModifierReferenceTable]   hot_milk: Hot Milk → 11 options
[ModifierReferenceTable][HotMilk] Group has 11 total options, 1 excluded, 10 available
[CatalogStore][HotMilk] Product HOT | Spanish Latte has 10 hot milk options
```

## Caching Strategy

1. **First Launch**: Build table from API, cache to disk
2. **Subsequent Launches**: Load from cache if API fails
3. **Cache Location**: `modifier_reference_table.json`
4. **Cache Invalidation**: Rebuild on each successful API sync
5. **Fallback**: If cache + API both fail, modifiers unavailable

## Files

- `ModifierReferenceTable.swift` - Core data structure and resolution logic
- `CatalogStore.swift` - Builds and uses the table
- `LocalCache.swift` - Handles JSON persistence

## API Endpoints Used

✅ `/v5/modifiers` - Get all modifier groups  
✅ `/v5/modifier_options?include=modifier` - Get all options with group IDs  
✅ `/v5/products?include=category,modifiers` - Get products with embedded modifier metadata  
❌ `/v5/modifiers/{id}/options` - **Does not exist** (returns 405)
