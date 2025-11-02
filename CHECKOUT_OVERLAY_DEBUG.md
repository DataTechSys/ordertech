# Checkout Overlay Debug Guide

## Status Summary

### ✅ Fixed Issues
1. **Hang Up Button** - Working correctly
2. **Basket Clearing on Disconnect** - Both devices clear baskets ✅
3. **Slow Disconnect Response** - Immediate status updates ✅
4. **Camera Reappearing** - RTC cleanup prevents camera restart ✅

### ⚠️ Remaining Issue: Checkout Overlay Not Showing on Remote

## Problem Description
When tapping "Checkout" on the cashier device:
- Checkout overlay appears on cashier ✅
- Checkout overlay does NOT appear on remote display ❌

## Logs Analysis

From your logs, I don't see any of these expected messages:
```
[LocalModeManager] startCheckout: showCheckoutOverlay=true
[LocalModeManager] Sending checkout overlay to remote
[Display] Sent ui:checkoutOverlay to basketId=...
```

This suggests the checkout flow isn't calling the send method.

## Possible Causes

### 1. Display Session Store Not Set
The `LocalModeManager` needs a reference to `DisplaySessionStore` to send messages.

**Check**: Look for this in logs:
```
[LocalModeManager] NOT sending checkout overlay: hasStore=false
```

### 2. Peers Not Connected
Even if store is set, `peersConnected` must be `true`.

**Check**: Look for:
```
[LocalModeManager] NOT sending checkout overlay: hasStore=true, peersConnected=false
```

### 3. Wrong Checkout Path
The app might be using a different checkout button/flow that doesn't call the overlay sync.

## Debug Steps

### Step 1: Rebuild and Test
```bash
# Rebuild the iOS app in Xcode with the new logging
```

### Step 2: Collect Logs
1. Connect cashier to display
2. Add items to basket
3. Tap "Checkout" button
4. **Look for these log messages:**
   - `[LocalModeManager] startCheckout:` or `[LocalModeManager] startRemoteCheckout:`
   - `[LocalModeManager] Sending checkout overlay to remote`
   - `[Display] Sent ui:checkoutOverlay to basketId=...`

### Step 3: Diagnose Based on Logs

#### If you see:  
```
[LocalModeManager] NOT sending checkout overlay: hasStore=false
```
**Fix**: Ensure `LocalModeManager.displaySessionStore` is set when connecting.

#### If you see:
```
[LocalModeManager] NOT sending checkout overlay: hasStore=true, peersConnected=false
```
**Fix**: The `peersConnected` state might not be properly synced. Check why it's false when it should be true.

#### If you don't see ANY `[LocalModeManager] startCheckout` logs:
**Fix**: The checkout button might be using a different code path. Need to find which checkout function is actually being called.

## Code Locations

### Checkout Trigger
`ios/OrderTech/Sources/App/DisplayHomeView.swift:456-458`
```swift
if localMode.isLocalMode {
    localMode.startCheckout()
} else {
    localMode.startRemoteCheckout(from: store)
}
```

### Checkout Overlay Send
`ios/OrderTech/Sources/App/LocalModeManager.swift:291-297`
```swift
if let store = displaySessionStore, store.peersConnected {
    store.sendCheckoutOverlayState(show: true)
}
```

### Overlay Display
`ios/OrderTech/Sources/App/DisplayHomeView.swift:297`
```swift
if store.showCheckoutOverlay || localMode.showCheckoutOverlay {
    LocalCheckoutOverlay()
}
```

### WebSocket Send
`ios/OrderTech/Sources/Session/DisplaySessionStore.swift:1558-1562`
```swift
func sendCheckoutOverlayState(show: Bool) {
    let targetBasket = activeBasketId ?? deviceId
    ws.send(json: ["type": "ui:checkoutOverlay", "basketId": targetBasket, "show": show])
    print("[Display] Sent ui:checkoutOverlay to basketId=\(targetBasket) show=\(show)")
}
```

## Expected Log Flow

### On Cashier (when tapping Checkout):
```
[LocalModeManager] startRemoteCheckout: showCheckoutOverlay=true, peersConnected=true
[Display] Sent ui:checkoutOverlay to basketId=branch_xxx show=true
```

### On Server:
```
[WS] Checkout overlay broadcast to basketId=branch_xxx show=true
```

### On Remote Display:
```
[Display] WS event: ui:checkoutOverlay
[Display] Received ui:checkoutOverlay event - showing overlay: true
```

## Quick Tests

### Test 1: Manual WebSocket Test
After connecting devices, manually trigger checkout overlay from browser console:
```javascript
// On server or using WebSocket client
ws.send(JSON.stringify({
  type: 'ui:checkoutOverlay',
  basketId: 'branch_5d81e48c-5910-4983-b5c7-ace4722c0c65',
  show: true
}));
```

If the overlay appears on the display, the server and client handlers work. The issue is in sending.

### Test 2: Check LocalModeManager Setup
Add this log when connecting:
```swift
// In DisplayHomeView or wherever connection happens
print("[Debug] Setting displaySessionStore on LocalModeManager")
localMode.displaySessionStore = store
```

## Solution Checklist

- [ ] Rebuild iOS app with new logging
- [ ] Test checkout and collect logs
- [ ] Verify `displaySessionStore` is set on `LocalModeManager`
- [ ] Verify `peersConnected` is `true` when checkout is triggered
- [ ] Verify WebSocket message is sent (check logs)
- [ ] Verify server receives and broadcasts message (check server logs)
- [ ] Verify remote display receives message (check remote logs)

## Files Modified (Already Deployed)
- ✅ `server.js` - Added `ui:checkoutOverlay` handler
- ✅ `ios/OrderTech/Sources/Session/DisplaySessionStore.swift` - Basket clearing and disconnect fixes
- ⚠️ `ios/OrderTech/Sources/App/LocalModeManager.swift` - Added debug logging (needs rebuild)

## Next Actions

1. **Rebuild iOS app** with the new debug logging
2. **Test checkout** and share the logs
3. Based on logs, we'll identify why the message isn't being sent
4. Apply targeted fix

The server-side is ready and working. The issue is on the client sending side.
