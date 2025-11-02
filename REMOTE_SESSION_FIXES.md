# Remote Display Session Fixes

## Issues Fixed

### ✅ 1. Hang Up Button
**Status**: Already working  
**Solution**: Implemented `connectedDisplayId` tracking to properly identify the connected display.

### ✅ 2. Basket Not Clearing on New Session
**Status**: Fixed in this commit  
**Problem**: Basket was cleared when connecting to a remote display, but immediately overwritten by incoming `basket:sync` events before RTC connection was established.

**Solution**: 
- Added `ignoreBasketSync` flag in `DisplaySessionStore`
- Flag is set to `true` when connecting to a new display (after clearing basket)
- All `basket:sync` and `basket:update` events are ignored until RTC connection is established
- Flag is set to `false` once RTC connects, allowing normal basket synchronization
- Also reset on `session:started` events

**Files Changed**:
- `ios/OrderTech/Sources/Session/DisplaySessionStore.swift`

**Code Changes**:
```swift
// Added flag
private var ignoreBasketSync: Bool = false

// Set when connecting
connectToDisplay() {
    self.ignoreBasketSync = true
    // ... clear basket ...
}

// Reset when RTC connects
startEnhancedRTCProvider() {
    self.ignoreBasketSync = false
    // ... after successful connection ...
}

// Check before applying basket updates
case "basket:sync", "basket:update":
    if ignoreBasketSync {
        print("[Display] Ignoring basket sync during connection phase")
    } else {
        applyBasket(event)
    }
```

### ✅ 3. Checkout Overlay Not Appearing on Remote Device
**Status**: Fixed in this commit  
**Problem**: Client was sending `ui:checkoutOverlay` events, but server didn't have a handler for them, causing WebSocket errors.

**Solution**:
- Added `handleUiCheckoutOverlay()` function to server WebSocket handlers
- Function broadcasts the checkout overlay state to all peers in the basket
- Allows both cashier and display roles to control the overlay
- Added proper message routing in the WebSocket message handler

**Files Changed**:
- `server.js`

**Code Changes**:
```javascript
// New handler function
function handleUiCheckoutOverlay(ws, msg) {
  const meta = clientMeta.get(ws) || {};
  const basketId = String(msg.basketId || meta.basketId || 'default');
  const show = !!msg.show;
  broadcast(basketId, { type: 'ui:checkoutOverlay', basketId, show, serverTs: Date.now() });
  console.log(`[WS] Checkout overlay broadcast to basketId=${basketId} show=${show}`);
}

// Added to message router
if (msg.type === 'ui:checkoutOverlay') return handleUiCheckoutOverlay(ws, msg);
```

## Testing

### Test Case 1: Basket Clearing
1. Connect Cashier iPad to Display iPad
2. Add items to basket on Cashier
3. Hang up the connection
4. Connect again
5. **Expected**: Basket should be empty on both devices
6. **Previous**: Old basket items remained
7. **Now**: Basket is cleared and stays empty

### Test Case 2: Checkout Overlay Sync
1. Connect Cashier iPad to Display iPad
2. Add items to basket
3. Tap "Checkout" on Cashier
4. **Expected**: Checkout overlay appears on both Cashier and Display
5. **Previous**: Overlay only appeared on Cashier, WebSocket error on server
6. **Now**: Overlay appears on both devices, synchronized

### Test Case 3: Hang Up Button
1. Connect Cashier to Display
2. Once connected, open display picker
3. **Expected**: "Hang Up" button appears for the connected display
4. **Previous**: Button didn't appear due to ID mismatch
5. **Now**: Button appears correctly

## Deployment Steps

1. **iOS App**:
   - Rebuild the app in Xcode
   - Deploy to test devices
   - No configuration changes needed

2. **Server**:
   - Restart the Node.js server to load the new WebSocket handler
   - No database changes needed
   - No configuration changes needed

## Logs to Monitor

### Client (iOS):
```
[DisplaySessionStore] Cleared basket and UI state before remote session
[Display] Ignoring basket sync during connection phase
[Display] Enhanced RTC provider livekit started successfully
[Display] Received ui:checkoutOverlay event - showing overlay: true
```

### Server:
```
[WS] Checkout overlay broadcast to basketId=... show=true
```

## Related Files
- `ios/OrderTech/Sources/Session/DisplaySessionStore.swift` - Display session management
- `ios/OrderTech/Sources/App/LocalModeManager.swift` - Checkout overlay control (no changes)
- `server.js` - WebSocket message handlers

## Notes
- The `ignoreBasketSync` flag is a temporary state during connection setup
- Once RTC is established, normal basket synchronization resumes
- The checkout overlay state is now properly synchronized across all connected devices
- Both fixes maintain backward compatibility with existing sessions
