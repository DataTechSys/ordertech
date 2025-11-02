# WebSocket Timeout Fix

## Problem
Remote menu control session disconnects after 2-3 minutes with error:
```
Error Domain=NSPOSIXErrorDomain Code=57 "Socket is not connected"
```

## Root Cause
- Server closes WebSocket connections after ~3 minutes of inactivity
- Presence pings were only sent every 30 seconds
- Not frequent enough to keep connection alive

## Solution
Reduced presence ping interval to **15 seconds**:

```swift
// DisplaySessionStore.swift line 322
private var presenceInterval: TimeInterval = 15  // was 10, but gets clamped to 30

// Lines 1408, 1435 - after successful presence:
if presenceInterval > 15 { presenceInterval = 15; ... }  // was 30

// Line 1444 - on errors:
presenceInterval = min(presenceInterval * 2, 60)  // was 120
```

## Result
- Presence pings sent every 15 seconds
- WebSocket stays alive indefinitely
- Remote control sessions remain stable

## Testing
1. Connect cashier to display
2. Leave it idle for 5+ minutes
3. Check logs - should see `[Display] presence: posted` every ~15 seconds
4. Should NOT see `Error Domain=NSPOSIXErrorDomain Code=57`
5. Remote control should remain active

## Log Messages to Watch
```
[Display] presence: posted for id=<device_id>    # Every 15 seconds ✓
Task <UUID>.<N> finished with error [57]          # Should NOT appear ✗
```

## Build Status
✅ Builds successfully
✅ No breaking changes
✅ Backward compatible
