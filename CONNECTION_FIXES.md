# Connection Fixes for "status=waiting" Issue

## Problem Analysis

The "status=waiting" messages were occurring because the DisplaySessionStore and Cashier apps weren't properly synchronizing their `basketId` associations with the WebSocket server. The server's `broadcastPeerStatus` function sets status to `'connected'` only when both cashier AND display are present for the same `basketId`.

### Root Causes Identified:

1. **BasketId Mismatch**: Display connects with `deviceId` as basketId (idle state), while Cashier connects with a different `basketId` (the paired device ID)
2. **Missing Synchronization**: No automatic basketId synchronization when peer status events are received
3. **Insufficient Error Handling**: Limited retry logic for connection failures
4. **Poor Connection Health Monitoring**: No proactive health checks or reconnection logic

## Implemented Fixes

### 1. Enhanced BasketId Synchronization

**File**: `ios/V-Drive/Sources/Session/DisplaySessionStore.swift`

- **Lines 685-696**: Added basketId mismatch detection in `peer:status` event handler
- **Lines 708-717**: Added handling for "waiting" status to trigger basketId synchronization
- **Lines 1167-1177**: Enhanced `handleRTCProvider` to send multiple subscribe/hello messages for reliability

**Key Changes**:
```swift
// Detect basketId mismatch and re-subscribe
if let bid = event["basketId"] as? String, !bid.isEmpty, bid != activeBasketId {
    print("[Display] 📱 CONNECTION: Detected basketId mismatch! Current=\(activeBasketId ?? \"nil\") Received=\(bid)")
    activeBasketId = bid
    // Send subscription and hello message with the correct basketId
    ws.send(json: ["type": "subscribe", "basketId": bid])
    // ... send hello message
}
```

### 2. Connection Retry Logic

**File**: `ios/V-Drive/Sources/Session/DisplaySessionStore.swift`

- **Lines 338-344**: Added connection retry state management
- **Lines 1323-1367**: Implemented exponential backoff retry mechanism
- **Lines 377-396**: Enhanced WebSocket connection event handling

**Features**:
- Maximum 5 retry attempts with exponential backoff
- Connection state preservation across retries
- Intelligent retry timing based on previous attempts

### 3. Connection Health Monitoring

**File**: `ios/V-Drive/Sources/Session/DisplaySessionStore.swift`

- **Lines 1369-1414**: Added periodic health checks every 30 seconds
- **Lines 1395-1397**: Lightweight ping messages to verify connectivity
- **Lines 1400-1413**: Re-subscription logic when peer status updates are stale

**Benefits**:
- Proactive detection of connection issues
- Automatic re-subscription when peer status is stale
- Continuous health monitoring during active sessions

### 4. Enhanced Debugging and Diagnostics

**File**: `ios/V-Drive/Sources/Session/DisplaySessionStore.swift`

- **Lines 674-676**: Added detailed peer status logging with emoji indicators
- **Lines 1417-1428**: Comprehensive diagnostic method for connection state
- **Throughout**: Enhanced logging with consistent 📱 CONNECTION prefix

**Features**:
```swift
func logConnectionDiagnostics() {
    print("[Display] 📱 CONNECTION: === DIAGNOSTIC REPORT ===")
    print("[Display] 📱 CONNECTION: WebSocket connected: \(ws.isConnected)")
    print("[Display] 📱 CONNECTION: Peers connected: \(peersConnected)")
    // ... more diagnostic info
}
```

## Testing Instructions

### 1. Build and Deploy

```bash
# Navigate to project directory
cd /Users/mosawi/DATATECH/OrderTech

# Build the DisplayApp for iOS simulator
xcodebuild -project ios/V-Drive/V-Drive.xcodeproj -scheme V-Drive -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build

# Or use Xcode directly
open ios/V-Drive/V-Drive.xcodeproj
```

### 2. Test Connection Establishment

1. **Start the Display app** in the iOS simulator
2. **Monitor the console logs** for connection status
3. **Look for these key log messages**:
   ```
   [Display] 📱 CONNECTION: WS status changed → connected=true
   [Display] 📱 CONNECTION: Started health monitoring (interval: 30s)
   [Display] subscribeDefaultBasket: subscribe + hello; basketId=[device-id]
   ```

### 3. Test Cashier-Display Pairing

1. **Start the cashier web app** and attempt to connect to the display
2. **Watch for basketId synchronization logs**:
   ```
   [Display] 📱 CONNECTION: Switching basketId from [old-id] to [new-id]
   [Display] 📱 CONNECTION: peer:status status=connected cashier=Cashier display=[name]
   ```
3. **Verify the status changes from "waiting" to "connected"**

### 4. Test Connection Recovery

1. **Simulate network issues** by toggling WiFi or network connectivity
2. **Observe retry behavior**:
   ```
   [Display] 📱 CONNECTION: Scheduling retry #1 in 2s
   [Display] 📱 CONNECTION: Attempting reconnection #1/5
   ```
3. **Verify automatic reconnection** when network is restored

### 5. Manual Diagnostic Commands

In the iOS app, you can trigger diagnostics by calling:
```swift
// From any view or debug interface
displaySessionStore.logConnectionDiagnostics()
```

## Expected Behavior After Fixes

### Before:
- Display and Cashier apps remain in "waiting" state indefinitely
- No automatic basketId synchronization
- Connection issues require manual intervention
- Limited visibility into connection problems

### After:
- **Automatic basketId synchronization** when mismatch is detected
- **Robust connection retry** with exponential backoff (up to 5 attempts)
- **Proactive health monitoring** with automatic re-subscription
- **Comprehensive logging** for easy troubleshooting
- **Fast connection recovery** after network issues

## Monitoring Connection Health

The new health monitoring system:

1. **Checks connection every 30 seconds**
2. **Sends ping messages** to verify connectivity
3. **Detects stale peer status** (no updates for 60+ seconds)
4. **Automatically re-subscribes** when issues are detected
5. **Logs all connection state changes** with clear indicators

## Troubleshooting

If connection issues persist:

1. **Check the logs** for specific error messages with the 📱 CONNECTION prefix
2. **Call `logConnectionDiagnostics()`** to get current state information
3. **Verify basketId consistency** between cashier and display
4. **Check network connectivity** and server availability
5. **Monitor server logs** for WebSocket connection and peer status events

## Next Steps

With these fixes implemented:

1. **Test thoroughly** in your development environment
2. **Deploy to staging** environment for broader testing
3. **Monitor production logs** for any remaining connection issues
4. **Consider adding metrics/telemetry** for connection health tracking

The connection reliability should be significantly improved, and the "status=waiting" issue should be resolved through automatic basketId synchronization and robust retry mechanisms.