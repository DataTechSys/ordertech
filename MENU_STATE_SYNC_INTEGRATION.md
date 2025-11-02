# Menu State Sync Integration Guide

## Overview

`MenuStateSync` provides robust, stateful menu synchronization for Display-to-Display remote control without relying on database state. It handles:

- ✅ **Bidirectional control** - Both displays can control
- ✅ **State persistence** - Survives reconnections
- ✅ **Conflict resolution** - Timestamp-based
- ✅ **Recovery** - Automatic state restoration

## Architecture

```
┌─────────────┐         menu:state         ┌─────────────┐
│  Display A  │ ────────────────────────▶  │  Display B  │
│ (Controller)│                             │  (Display)  │
│             │ ◀────────────────────────   │             │
└─────────────┘      menu:state:sync       └─────────────┘
```

## Integration Steps

### 1. Add MenuStateSync to DisplaySessionStore

```swift
@MainActor
final class DisplaySessionStore: ObservableObject {
    // ... existing properties ...
    
    /// Menu state synchronization manager
    @Published var menuStateSync: MenuStateSync = MenuStateSync()
    
    init(env: EnvironmentStore, deviceId: String, friendlyName: String, branch: String) {
        // ... existing init ...
        
        // Configure menu state sync callback
        menuStateSync.sendStateUpdate = { [weak self] state in
            self?.sendMenuState(state)
        }
    }
}
```

### 2. Add WebSocket Event Handlers

```swift
private func handle(event: [String: Any]) {
    let type = (event["type"] as? String) ?? ""
    
    switch type {
    // ... existing cases ...
    
    case "menu:state":
        // Receive menu state from peer
        if let state = MenuStateSync.MenuState.fromWebSocketEvent(event) {
            menuStateSync.receiveState(state)
        }
    
    case "menu:state:sync":
        // Peer requesting state sync
        menuStateSync.provideCurrentState(deviceId: deviceId)
    
    // ... other cases ...
    }
}
```

### 3. Add Send Method

```swift
private func sendMenuState(_ state: MenuStateSync.MenuState) {
    let basketId = activeBasketId ?? deviceId
    let event = state.toWebSocketEvent(basketId: basketId)
    ws.send(json: event)
    print("[Display] Sent menu:state: category=\(state.selectedCategory ?? "nil")")
}
```

### 4. Configure Based on Connection Type

```swift
// When RTC connection establishes
func handleRTCProvider(_ ev: [String: Any]) {
    // ... existing code ...
    
    // For Display-to-Display: configure as display (receiving)
    if cashierDeviceId == nil {
        menuStateSync.configureAsDisplay()
    }
}

// For peer:status = connected
case "peer:status":
    if status == "connected" {
        peersConnected = true
        
        // Request state sync on reconnection
        if menuStateSync.isDisplay {
            menuStateSync.requestStateSync(deviceId: deviceId)
        }
    }
```

### 5. Update UI to Use MenuStateSync

In `DisplayHomeView.swift`:

```swift
var body: some View {
    // ... existing code ...
    .onReceive(store.menuStateSync.$selectedCategory) { category in
        // Update UI when category changes
        if let cat = category {
            // Apply category selection
        }
    }
    .onReceive(store.menuStateSync.$selectedProduct) { product in
        // Update UI when product changes
        if let prod = product {
            // Show product details
        }
    }
    .onReceive(store.menuStateSync.$scrollToProduct) { productId in
        // Scroll to product
        if let id = productId {
            // Trigger scroll
        }
    }
}
```

### 6. Send Updates When User Interacts

```swift
// When user selects category
func sendSelectCategory(name: String) {
    if menuStateSync.isController {
        menuStateSync.updateCategory(name, deviceId: deviceId)
    } else {
        // Send individual event for backward compatibility
        ws.send(json: ["type": "ui:selectCategory", "basketId": basketId, "name": name])
    }
}

// When user selects product
func sendShowProduct(id: String) {
    if menuStateSync.isController {
        menuStateSync.updateProduct(id, deviceId: deviceId)
    } else {
        // Send individual event for backward compatibility
        ws.send(json: ["type": "ui:showOptions", "basketId": basketId, "product_id": id])
    }
}
```

## State Recovery on Reconnection

When the display goes off and comes back:

1. **WebSocket reconnects** → triggers `peer:status` event
2. **Display detects reconnection** → calls `menuStateSync.requestStateSync()`
3. **Controller receives sync request** → calls `provideCurrentState()`
4. **Controller broadcasts current state** → `menu:state` event
5. **Display receives state** → UI updates automatically

## Key Benefits

### vs. Current Implementation:

| Feature | Current (DB-based) | New (MenuStateSync) |
|---------|-------------------|-------------------|
| State persistence | ❌ Lost on disconnect | ✅ Stored locally |
| Recovery speed | Slow (DB query) | Fast (WebSocket) |
| Conflict resolution | None | Timestamp-based |
| Works offline | ❌ No | ✅ Yes (local state) |
| Bidirectional | ❌ One-way | ✅ Both ways |

### Example Scenarios:

**Scenario 1: Screen Sleep/Wake**
```
1. Display goes to sleep
2. Display wakes up
3. WebSocket reconnects
4. Display requests state sync
5. Controller sends current menu state
6. Display UI updates to correct page
```

**Scenario 2: Temporary Disconnect**
```
1. Network glitch
2. MenuStateSync maintains stored state
3. Connection restored
4. State automatically re-syncs
5. No user-visible interruption
```

**Scenario 3: Multiple Displays**
```
1. Controller (Display A) selects category "Coffee"
2. All displays receive menu:state event
3. All displays update to "Coffee" category
4. Synchronized across all screens
```

## Backward Compatibility

The implementation maintains backward compatibility by:

1. **Dual events** - Sends both `menu:state` and legacy events
2. **Fallback handling** - Can receive either new or old events
3. **Gradual migration** - Can roll out incrementally

## Testing Checklist

- [ ] Display connects → receives initial state
- [ ] Category selection syncs across displays
- [ ] Product selection syncs across displays
- [ ] Display sleep/wake restores state
- [ ] Network disconnect/reconnect recovers state
- [ ] Multiple displays stay synchronized
- [ ] Conflict resolution works (timestamp wins)
- [ ] Legacy events still work (backward compatible)

## Next Steps

1. Add MenuStateSync to Xcode project
2. Integrate into DisplaySessionStore
3. Add WebSocket event handlers
4. Update UI bindings
5. Test with multiple displays
6. Monitor logs for sync events
7. Deploy incrementally
