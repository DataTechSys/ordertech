# LiveKit Participant Disconnection Handling Fix

## Problem

When the remote cashier device disconnected (by closing the app or losing connection), the Display device was not properly detecting the disconnection and returning to local mode. Instead, it would:

1. Show stale/frozen remote video from the previous session
2. Remain in "remote mode" even though no peer was actually connected
3. Only recover when WebSocket reconnected, but even then would sometimes show stale video

### Root Cause

The LiveKit SDK's `room(_:didDisconnectParticipant:)` callback was firing correctly when a remote participant left, but we were only logging it without taking any action. This meant:

- The remote video track remained cached in memory
- The video views continued showing the last frame
- The connection state (`peersConnected`) wasn't updated
- LocalModeManager didn't know the peer was gone

## Solution

Implemented proper handling of LiveKit participant disconnection:

### 1. Clear Remote Track on Participant Disconnect

**File:** `LiveKitRTC.swift`

```swift
func room(_ room: Room, didDisconnectParticipant participant: RemoteParticipant) {
    print("[Display][LiveKit] remote participant disconnected: \(participant.identity?.stringValue ?? "unknown")")
    
    // Clear remote track when participant disconnects
    DispatchQueue.main.async {
        self.remoteTrack = nil
        self.linkStatus = .remotePending
        print("[LiveKitRTC] cleared remote track - connection should transition to local mode")
        
        // Clear views to stop showing stale video
        let views = (self.remoteViews.compactMap { $0.view }) + (self.remoteView != nil ? [self.remoteView!].compactMap{$0} : [])
        views.forEach { view in
            view.track = nil
            print("[LiveKitRTC] cleared track from VideoView: \(view)")
        }
        
        // Notify system that remote video is gone
        NotificationCenter.default.post(name: Notification.Name("OT.Display.RemoteVideoLost"), object: nil)
    }
}
```

### 2. Listen for Disconnection Notification

**File:** `DisplaySessionStore.swift`

Added notification observer in the `init` method:

```swift
// Listen for LiveKit participant disconnection
NotificationCenter.default.addObserver(
    forName: Notification.Name("OT.Display.RemoteVideoLost"),
    object: nil,
    queue: .main
) { [weak self] _ in
    self?.handleRemoteVideoLost()
}
```

### 3. Update Connection State

**File:** `DisplaySessionStore.swift`

Added handler to update connection state:

```swift
/// Handle remote video loss due to LiveKit participant disconnection
private func handleRemoteVideoLost() {
    print("[DisplaySessionStore] Remote participant disconnected - handling video loss")
    
    // Update connection state immediately
    peersConnected = false
    
    // The LocalModeManager will detect peersConnected=false and activate local mode
    // We don't need to do anything else here - the existing logic will handle it
    print("[DisplaySessionStore] Set peersConnected=false - local mode should activate")
}
```

## Flow Diagram

```
Remote Cashier Closes App
         ↓
LiveKit detects participant left
         ↓
room(_:didDisconnectParticipant:) fires
         ↓
Clear remoteTrack + clear all VideoViews
         ↓
Post "OT.Display.RemoteVideoLost" notification
         ↓
DisplaySessionStore receives notification
         ↓
Set peersConnected = false
         ↓
LocalModeManager detects peersConnected=false
         ↓
Activates local mode + shows local camera
         ↓
Display returns to local control
```

## Expected Behavior After Fix

### When Remote Disconnects:

1. **Immediate Detection**: LiveKit SDK fires disconnect callback within ~1-2 seconds
2. **Video Cleared**: Remote video views are immediately cleared (black screen)
3. **State Updated**: `peersConnected` set to `false` immediately
4. **Local Mode Activated**: LocalModeManager activates local mode
5. **Local Camera Shown**: Display switches to showing local camera
6. **Local Control Restored**: User can interact with menu locally

### When Remote Reconnects:

1. WebSocket reconnects (if it was disconnected)
2. Peer status updated to "connected"
3. LocalModeManager detects reconnection
4. Deactivates local mode
5. Remote control restored
6. New LiveKit video connection established
7. Fresh remote video appears (not stale)

## Testing Checklist

- [x] Build succeeds without errors
- [ ] Display shows local camera when remote closes app
- [ ] Display doesn't show stale/frozen remote video
- [ ] Display correctly returns to remote mode when cashier reconnects
- [ ] Works across multiple disconnect/reconnect cycles
- [ ] Works when WiFi drops temporarily
- [ ] Works when iPad goes to sleep and wakes up

## Log Messages to Watch For

```
[Display][LiveKit] remote participant disconnected: <participant_id>
[LiveKitRTC] cleared remote track - connection should transition to local mode
[LiveKitRTC] cleared track from VideoView: <view>
[DisplaySessionStore] Remote participant disconnected - handling video loss
[DisplaySessionStore] Set peersConnected=false - local mode should activate
[LocalModeManager] Connection lost - activating local mode immediately
[LocalModeManager] Activating local mode
[CameraBoxView] Local mode - Local camera main video appeared
```

## Related Files Modified

1. **OrderTech/Sources/RTC/LiveKitRTC.swift**
   - Enhanced `room(_:didDisconnectParticipant:)` to clear state and notify

2. **OrderTech/Sources/Session/DisplaySessionStore.swift**
   - Added notification observer for remote video loss
   - Added `handleRemoteVideoLost()` handler method

## Notes

- This fix works in conjunction with the existing `LocalModeManager` 
- No changes needed to `LocalModeManager` itself - it already watches `peersConnected`
- The fix is backward compatible with existing code
- WebSocket disconnection is handled separately and continues to work as before

## WebSocket Keep-Alive Fix (Added 2025-10-28)

### Problem
After a couple of minutes, the WebSocket connection was timing out with error:
```
Error Domain=NSPOSIXErrorDomain Code=57 "Socket is not connected"
```

This was causing the remote menu control session to disconnect even though LiveKit was still connected.

### Root Cause
- Server has a ~3 minute inactivity timeout on WebSocket connections
- Presence pings were being sent every 30 seconds (after first success)
- This wasn't frequent enough to keep the connection alive
- The `presenceInterval` would reset to 30s after successful ping

### Solution
Reduced WebSocket keep-alive interval:

1. **Initial presence interval**: Changed from 10s to 15s
2. **Maximum presence interval**: Changed from 30s to 15s (after success)
3. **Backoff cap on errors**: Changed from 120s to 60s

This ensures presence pings are sent **every 15 seconds**, which is well below the server's 3-minute timeout.

### Files Modified
- `DisplaySessionStore.swift` (lines 322, 1408, 1435, 1444)

### Testing
- Monitor logs for `[Display] presence: posted` messages
- Should appear every ~15 seconds
- WebSocket should stay connected for hours without disconnection
- Look for `Error Domain=NSPOSIXErrorDomain Code=57` - should no longer occur

## Future Enhancements

Consider adding:
- Explicit WebSocket ping/pong frames (if OrderTechCore WebSocketManager supports it)
- Timeout mechanism if participant doesn't reconnect within X minutes
- Visual indicator showing "reconnecting..." state
- Graceful degradation if video quality drops before full disconnect
