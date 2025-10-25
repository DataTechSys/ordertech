# Popup Synchronization Issue - Analysis & Fix

## Problem Description

When a product popup/options dialog is open on both Cashier and Display apps:
1. ✅ **Cashier popup closes** correctly when user adds product to cart
2. ❌ **Display popup stays open** - not synchronized with Cashier

## Root Cause Analysis

### The Expected Flow
1. User clicks product → Both apps show product options popup
2. User adds product from Cashier → Cashier sends `ui:optionsClose` event
3. Display receives `ui:optionsClose` → Should close popup

### The Actual Issue
While investigating, I found that the Display **does** handle `ui:optionsClose` events correctly (see `DisplaySessionStore.swift` lines 909-920). The issue appears to be a **timing or reliability problem** with the WebSocket event delivery.

**Potential causes:**
1. **Debouncing on Cashier side**: The Cashier has a 0.5-second debounce interval for close commands that might interfere
2. **Network delays**: WebSocket events might be delayed or lost
3. **Event ordering**: Multiple rapid events (basket:update + ui:optionsClose) might cause race conditions

## Fix Applied

Added a **redundant popup close mechanism** to ensure synchronization regardless of explicit `ui:optionsClose` events:

```swift
case "basket:sync", "basket:update":
    applyBasket(event)
    
    // Close any open product options popup when items are added/updated from Cashier
    // This ensures UI synchronization even if explicit ui:optionsClose events are delayed
    if event["type"] as? String == "basket:update" {
        if let selectedId = self.selectedProductId {
            print("[Display] basket:update received while product options open (productId: \(selectedId)) - auto-closing popup")
            Task { @MainActor in
                self.selectedProductId = nil
                self.preview = nil
                self.pendingEditSku = nil
            }
        }
    }
```

### How This Fix Works

1. **Primary mechanism**: Still relies on `ui:optionsClose` events (unchanged)
2. **Fallback mechanism**: When a `basket:update` is received (indicating item was added/modified), automatically close any open popup
3. **Logic**: If someone is adding items to the basket, any open product selection dialog should close

## Benefits

✅ **Reliable synchronization**: Popup will close on Display even if `ui:optionsClose` events are delayed/lost  
✅ **Non-breaking**: Existing `ui:optionsClose` handling remains intact  
✅ **Intuitive**: Basket updates naturally indicate that product selection is complete  
✅ **Diagnostic**: Added enhanced logging to help debug any future issues

## Testing

After applying this fix:

1. **Open product popup** on both apps
2. **Add product from Cashier**
3. **Verify both popups close** immediately
4. **Check logs** for diagnostic messages

Expected log output:
```
[Display] basket:update received while product options open (productId: some-product-id) - auto-closing popup
[Display] ui:optionsClose event received - currentProductId: some-product-id
[Display] ui:optionsClose processed - popup closed
```

The fix ensures popup synchronization works reliably across both the primary and fallback mechanisms.