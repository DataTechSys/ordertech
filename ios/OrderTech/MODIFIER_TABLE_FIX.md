# Modifier Table Fix - Product Embedding Based Mapping

## Problem
Foodics API does not reliably return the `modifier_id` field on `FoodicsModifierOption` objects, making it impossible to directly link modifier options to their groups.

## Previous Approach (Failed)
Used name/reference heuristics to guess which options belong to which groups. This was fragile and often incorrect, causing:
- All modifier options showing up for all products
- Wrong options appearing in groups (e.g., milk options in shot groups)
- Empty groups when heuristics failed to match

## New Solution: Product Embedding Analysis

### Key Insight
Products returned by the Foodics API include embedded `modifiers` arrays with `pivot.excluded_options_ids`. These excluded option IDs tell us which options are **available** for that group (but excluded for that specific product).

By analyzing ALL products and collecting excluded option IDs per group, we can reverse-engineer the complete option-to-group mapping.

### Implementation

#### 1. ModifierReferenceTable.swift
**Changed:** `build()` method now accepts `products` parameter

**New Logic:**
```swift
// For each product
for product in products {
    // For each embedded modifier group
    for mod in product.modifiers {
        let groupRef = mod.reference // e.g., "hot_milk"
        
        // Collect all excluded option IDs
        for optionId in mod.pivot.excluded_options_ids {
            // This option COULD belong to this group
            optionsByGroupRef[groupRef].insert(optionId)
        }
    }
}
```

**Fallback:** Still tries `modifier_id` field if available as a secondary mechanism.

#### 2. CatalogStore.swift
**Changed:** Pass `foodicsProducts` to `ModifierReferenceTable.build()`

```swift
modifierTable = ModifierReferenceTable.build(
    from: allGroups,
    options: modifierOptions,
    products: foodicsProducts  // NEW
)
```

### How It Works

1. **Sync Phase:**
   - Fetch all products with `include=modifiers`
   - Fetch all modifier groups
   - Fetch all modifier options
   - Build reference table by analyzing product embeddings
   - Cache table locally

2. **Product Display:**
   - Look up group by `reference` (e.g., "hot_milk")
   - Get all options for that group from table
   - Filter out excluded options using `pivot.excluded_options_ids`
   - Show remaining options to user

3. **Caching:**
   - Table is cached to `modifier_reference_table.json`
   - Survives cold starts
   - Rebuilt during each sync

### Example

**Product:** "HOT | Spanish Latte"

**Embedded Modifiers:**
```json
{
  "id": "group123",
  "reference": "hot_milk",
  "name": "HOT MILK",
  "pivot": {
    "excluded_options_ids": ["opt001", "opt002", "opt003"]
  }
}
```

**Analysis:**
- Group `hot_milk` can have options: `opt001`, `opt002`, `opt003` (and possibly more from other products)
- For THIS product, those 3 are excluded
- So only other options in the `hot_milk` group are shown

**Across All Products:**
If 10 products mention `hot_milk` and collectively exclude options `[opt001, opt002, opt003, opt004, opt005]`, then we know the `hot_milk` group has exactly those 5 options.

### Benefits

✅ **Accurate:** Uses actual API data, not guesses  
✅ **Complete:** Discovers all options by analyzing all products  
✅ **Stable:** Cached table persists across app launches  
✅ **Filtered:** Each product shows only its available options  

### Testing

Run the app and check logs for:
```
[ModifierReferenceTable] Analyzing X products for option-to-group mapping...
[ModifierReferenceTable] Mapped Y groups from product embeddings
[ModifierReferenceTable] Built table with Y groups and Z options
[ModifierReferenceTable]   hot_milk: HOT MILK → 5 options
[ModifierReferenceTable]   coffee_shot: Coffee Shot → 3 options
```

Then tap a product and verify modifiers show correct, filtered options.
