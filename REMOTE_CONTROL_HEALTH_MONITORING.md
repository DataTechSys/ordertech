# Remote Control Health Monitoring System

## Overview

A comprehensive connection health monitoring system that ensures remote control remains solid and reliable. The system continuously validates WebSocket + LiveKit connections and automatically recovers from issues.

## Architecture

### Core Components

1. **ConnectionHealthMonitor** (`Sources/Core/ConnectionHealthMonitor.swift`)
   - Continuous health checking every 2 seconds
   - Tracks multiple connection components
   - Automatic recovery after failures
   - Event activity tracking

2. **Integration with SessionStore** (`Sources/Core/SessionStore.swift`)
   - Health monitor initialized on app startup
   - All connection state changes tracked
   - All incoming events recorded

3. **Integration with DisplaySessionStore** (`Sources/Session/DisplaySessionStore.swift`)
   - Similar integration for Display app
   - Tracks display-specific connection states

## Health Monitoring Features

### 1. Connection Status Tracking

The health monitor tracks:
- **WebSocket Connection**: Is the WebSocket connected?
- **Peer Connection**: Are peers (Cashier/Display) connected?
- **Signal Strength**: LiveKit signal bars (0-3)
- **Connection Stability**: Is the connection stable (not reconnecting)?
- **Event Activity**: Time since last event received

### 2. Health Check Algorithm

```
Healthy = WebSocket Connected + Peers Connected + Signal > 0
Remote Control Ready = Healthy + Connection Stable
```

Health checks run every 2 seconds and validate:
- All connection components are active
- No event silence >15 seconds (detects "zombie" connections)
- Connection hasn't been marked unstable

### 3. Validation on Every Remote Update

Before processing any remote control action, the system validates:

```swift
guard connectionHealthMonitor.validateRemoteControlAction(actionName: "action") else {
    print("Remote action blocked - connection unhealthy")
    return
}
```

Validated actions:
- `ui:selectCategory` - Category selection
- `ui:showOptions` - Product selection
- `ui:scrollTo` - Scroll actions
- `ui:optionsClose` - Close commands

### 4. Automatic Recovery

**Trigger Conditions:**
- 3 consecutive health check failures
- WebSocket disconnects
- Peer disconnects
- Signal loss
- Event silence >15 seconds

**Recovery Process:**
1. Post `connectionHealthRecoveryNeeded` notification
2. Wait 2 seconds for recovery
3. Perform post-recovery health check after 5 seconds
4. Resume normal monitoring

### 5. Event Activity Tracking

Every incoming WebSocket event is recorded:
```swift
connectionHealthMonitor.recordEventReceived(type: "event_type")
```

This enables detection of "silent" connections where WebSocket reports connected but no events flow.

## Usage

### Initialization

The health monitor is automatically initialized when SessionStore attaches:

```swift
func attach(basket: BasketStore, env: EnvironmentStore, ws: WebSocketManager) {
    // ... other setup ...
    
    // Initialize connection health monitor
    connectionHealthMonitor.configure(sessionStore: self)
    connectionHealthMonitor.startMonitoring()
}
```

### Monitoring State

The health monitor publishes observable state:

```swift
@Published var isHealthy: Bool = false
@Published var healthMessage: String = "Initializing..."
@Published var remoteControlActive: Bool = false
@Published var lastSuccessfulCheck: Date?
```

### Manual Recovery

For debugging, you can manually trigger recovery:

```swift
Task {
    await connectionHealthMonitor.forceRecovery()
}
```

Or print detailed status:

```swift
connectionHealthMonitor.printDetailedStatus()
```

### Full Connection Restart

For severe issues, trigger a complete restart:

```swift
Task {
    await connectionHealthMonitor.restartConnection()
}
```

## Notifications

The system uses notifications for decoupled communication:

- `remoteControlActivated` - Remote control became active
- `remoteControlDeactivated` - Remote control became inactive  
- `connectionHealthChanged` - Health status changed
- `connectionHealthRecoveryNeeded` - Recovery triggered

## Logging

All health checks and state transitions are logged with emoji indicators:

```
[ConnectionHealthMonitor] ✅ Health: WS=true, Peers=true, Signal=2, Stable=true, Remote=true
[ConnectionHealthMonitor] ❌ Blocked 'select category' - connection unhealthy
[ConnectionHealthMonitor] 🔧 Multiple health check failures - triggering recovery
[ConnectionHealthMonitor] ⚠️ Event silence detected: 16.2s since last event
```

## Benefits

### 1. **Reliability**
- Automatically detects and recovers from connection issues
- No manual intervention required
- Prevents stuck or broken remote control

### 2. **Robustness**
- Multi-level health checks (WebSocket + LiveKit + Peers + Signal)
- Validates every remote action before processing
- Graceful degradation on unstable connections

### 3. **Visibility**
- Detailed logging for debugging
- Real-time health status tracking
- Event activity monitoring

### 4. **Automatic Recovery**
- Self-heals after network disruptions
- Detects "zombie" connections
- Recovers from temporary disconnections

## Configuration

Key timing parameters (adjustable in `ConnectionHealthMonitor`):

```swift
private let healthCheckInterval: TimeInterval = 2.0  // How often to check
private let maxEventSilence: TimeInterval = 15.0     // Max time without events
private let stabilizationTimeout: TimeInterval = 10.0 // Max stabilization time
private let maxConsecutiveFailures = 3                // Failures before recovery
```

## Future Enhancements

Potential improvements:
- Visual health indicator in UI
- User notifications when remote control fails
- Metrics tracking (uptime, recovery count)
- Adaptive health check intervals based on connection quality
- Predictive recovery based on degrading metrics

## Testing

To test the health monitor:

1. **Normal Operation**: Monitor logs for regular health checks
2. **Connection Loss**: Disconnect network and verify automatic recovery
3. **Event Silence**: Stop sending events and verify silence detection
4. **Manual Recovery**: Call `forceRecovery()` and verify behavior
5. **Full Restart**: Call `restartConnection()` and verify full cycle

## Troubleshooting

### Remote Control Not Working

1. Check health status:
   ```swift
   connectionHealthMonitor.printDetailedStatus()
   ```

2. Look for issues in logs:
   - "connection unhealthy"
   - "remote control not active"
   - "event silence detected"

3. Check connection components:
   - WebSocket connected?
   - Peers connected?
   - Signal strength > 0?
   - Connection stable?

### Frequent Recoveries

If you see many recovery attempts:
- Check network stability
- Verify server is sending events regularly
- Look for WebSocket disconnect/reconnect cycles
- Check LiveKit connection quality

### Silent Connection

If connection appears active but no events flow:
- Event silence detection will trigger after 15 seconds
- Automatic recovery will attempt to fix
- Check server-side event broadcasting

## Implementation Checklist

- [x] Create ConnectionHealthMonitor class
- [x] Integrate with SessionStore
- [x] Integrate with DisplaySessionStore
- [x] Add validation on all remote updates
- [x] Implement automatic recovery
- [x] Add event activity tracking
- [x] Add detailed logging
- [ ] Add UI health indicator (future)
- [ ] Add user notifications (future)
- [ ] Add metrics tracking (future)

## Summary

The Connection Health Monitoring System makes remote control **solid and reliable** by:
- Continuously validating connection health
- Blocking invalid remote actions
- Automatically recovering from failures
- Detecting and fixing "zombie" connections
- Providing detailed visibility for debugging

Remote control now **checks every time** before processing updates, ensuring menu control stays working reliably even after network disruptions or temporary disconnections.
