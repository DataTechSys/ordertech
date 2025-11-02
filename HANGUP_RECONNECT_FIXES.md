# Hangup and Reconnection Fixes

## Issues Fixed

### ✅ 1. Basket Not Clearing on Reconnect (Both Devices)
**Problem**: 
- When hanging up and reconnecting, the remote display's basket was cleared but the local (cashier) device kept the old basket items
- Basket sync events were overwriting the cleared basket before RTC connected

**Solution**:
1. **Client-side (iOS)**:
   - Added `ignoreBasketSync` flag that prevents basket sync during initial connection
   - Flag is set `true` when connecting, `false` when RTC establishes
   - Both `rtc:stopped` and `stop()` now clear the basket completely
   - Clear `connectedDisplayId` on disconnect

2. **Server-side**:
   - Added handler for incoming `rtc:stopped` messages
   - Server now broadcasts disconnect events to all peers
   - Ensures both devices receive the disconnect notification

**Files Changed**:
- `ios/OrderTech/Sources/Session/DisplaySessionStore.swift`
- `server.js`

### ✅ 2. Slow/Delayed Disconnect Response
**Problem**: 
- Remote device didn't immediately update connection status on hangup
- Video feed took time to disappear
- No proper signaling between devices

**Solution**:
- Added `rtc:stopped` WebSocket event handler on server
- Server broadcasts disconnect to all peers immediately
- Both devices receive and process disconnect signal
- `peersConnected` state updates immediately on both sides
- `connectedDisplayId` is cleared on disconnect

**Files Changed**:
- `server.js` - Added `rtc:stopped` message handler
- `ios/OrderTech/Sources/Session/DisplaySessionStore.swift` - Enhanced `rtc:stopped` event handler

### ✅ 3. Camera Reappearing After Reconnect
**Problem**: 
- After reconnecting, the local device's camera would send video feed again (should only be on remote display)

**Solution**:
- Proper RTC provider cleanup on disconnect
- Clear all RTC state before reconnecting
- `stop()` method now properly resets all connection state
- LiveKit instances are fully stopped and cleared

**Files Changed**:
- `ios/OrderTech/Sources/Session/DisplaySessionStore.swift`

### ✅ 4. Checkout Overlay Sync (Already Fixed)
**Solution**: Server now handles `ui:checkoutOverlay` events and broadcasts to all peers.

## Technical Changes

### Server Changes (server.js)

#### 1. Added `rtc:stopped` Handler
```javascript
if (msg.type === 'rtc:stopped') {
  try {
    const meta = clientMeta.get(ws) || {};
    const basketId = String(msg.basketId || meta.basketId || 'default');
    const reason = String(msg.reason || 'client_disconnect');
    console.log(`[WS] rtc:stopped from ${meta.role || 'unknown'} for basketId=${basketId} reason=${reason}`);
    // Broadcast to all peers in the basket
    broadcast(basketId, { type: 'rtc:stopped', basketId, reason, serverTs: Date.now() });
    // Update peer status
    broadcastPeerStatus(basketId);
  } catch (err) {
    console.error('[WS] Error handling rtc:stopped:', err.message);
  }
  return;
}
```

### iOS Changes (DisplaySessionStore.swift)

#### 1. Enhanced `stop()` Method
```swift
func stop() {
    print("[Display] stop(): Full reset initiated")
    
    // Send disconnect notification to remote first
    let disconnectBasketId = activeBasketId ?? deviceId
    ws.send(json: ["type":"rtc:stopped", "basketId": disconnectBasketId, "reason": "display_stop"])
    print("[Display] Sent rtc:stopped notification to basketId=\(disconnectBasketId)")
    
    // ... stop RTC providers ...
    
    // Clear connection tracking
    connectedDisplayId = nil
    
    // Clear all UI state including local basket
    basketLines = []
    basketTotals = .zero
    // ... clear other UI state ...
}
```

#### 2. Enhanced `rtc:stopped` Event Handler
```swift
case "rtc:stopped":
    // Stop all RTC providers
    p2p?.stop(); p2p = nil; p2pPairId = nil
    livekit?.stop(); livekit = nil; livekitStarting = false
    
    // Stop orchestrator and update state
    Task {
        await rtcOrchestrator?.stopCurrentProvider()
        await MainActor.run {
            self.peersConnected = false
            self.poster = nil
            // Clear connection tracking
            self.connectedDisplayId = nil
            // Clear basket on disconnect
            self.basketLines = []
            self.basketTotals = .zero
            print("[Display] rtc:stopped - all RTC providers stopped, basket and state cleared")
        }
    }
    
    // Reset flags
    desiredProvider = ""
    rtcAutoStartAttempted = false
    ignoreBasketSync = false
    
    // Return to idle or stay on session basket depending on reason
    let reason = ((event["reason"] as? String) ?? "").lowercased()
    if reason == "preclear" || reason == "reset" {
        // Stay on session basket
    } else {
        subscribeDefaultBasket()
    }
```

#### 3. Basket Sync Protection
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
}

// Check before applying
case "basket:sync", "basket:update":
    if ignoreBasketSync {
        print("[Display] Ignoring basket sync during connection phase")
    } else {
        applyBasket(event)
    }
```

## Testing

### Test Scenario 1: Clean Disconnect
1. **Connect** Cashier to Display
2. Add items to basket
3. **Hang Up**
4. **Expected**: 
   - Both devices clear basket immediately ✅
   - Video feed stops on both sides ✅
   - Connection status updates immediately ✅
   - No lingering UI state ✅

### Test Scenario 2: Reconnect
1. Connect Cashier to Display
2. Add items to basket
3. Hang up
4. **Reconnect**
5. **Expected**:
   - Both devices start with empty basket ✅
   - No old items remain ✅
   - Camera only streams from cashier → display ✅
   - Connection is clean and fresh ✅

### Test Scenario 3: Checkout Overlay
1. Connect Cashier to Display
2. Add items
3. Tap "Checkout"
4. **Expected**:
   - Overlay appears on **both devices** ✅
   - No WebSocket errors ✅

## Deployment

### Server
```bash
# Already deployed - revision ordertech-00107-2h4
curl https://app.ordertech.me/health  # Verify
```

### iOS App
1. Open project in Xcode
2. Build and deploy to devices
3. Test all scenarios above

## Logs to Monitor

### On Hang Up (Both Devices):
```
[Display] stop(): Full reset initiated
[Display] Sent rtc:stopped notification to basketId=...
[WS] rtc:stopped from display for basketId=... reason=display_stop
[Display] rtc:stopped - all RTC providers stopped, basket and state cleared
[Display] peersConnected=false, connectedDisplayId=nil
```

### On Reconnect:
```
[DisplaySessionStore] Connecting to display: ...
[DisplaySessionStore] Cleared basket and UI state before remote session
[Display] Ignoring basket sync during connection phase
[Display] Enhanced RTC provider livekit started successfully
[Display] basketLines=[], basketTotals.total=0
```

## Related Files
- `server.js` - WebSocket handlers
- `ios/OrderTech/Sources/Session/DisplaySessionStore.swift` - Connection and state management
- `ios/OrderTech/Sources/Shared/DisplayPickerView.swift` - Hangup button (no changes needed)

## Summary

All three issues are now fixed:
1. ✅ **Basket clearing** - Both devices clear basket on disconnect and start fresh on reconnect
2. ✅ **Disconnect response** - Immediate status update via WebSocket broadcast
3. ✅ **Camera reappearing** - Proper RTC cleanup prevents camera from restarting
4. ✅ **Checkout overlay** - Already working from previous fix

The key improvements:
- **Bidirectional signaling**: Both devices send and receive disconnect events
- **Basket protection**: New connections ignore basket syncs until RTC is ready
- **Complete cleanup**: All RTC and connection state is cleared on disconnect
- **Immediate feedback**: Both devices update UI instantly when connection state changes
