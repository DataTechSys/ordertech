import Foundation
import Combine

/// Robust menu state synchronization for Display-to-Display remote control
/// Maintains authoritative state and handles reconnection gracefully
@MainActor
class MenuStateSync: ObservableObject {
    
    // MARK: - Published State
    
    /// Current selected category (controlled by remote or local)
    @Published var selectedCategory: String? = nil
    
    /// Current selected product (for options sheet)
    @Published var selectedProduct: String? = nil
    
    /// Current scroll position (product ID to scroll to)
    @Published var scrollToProduct: String? = nil
    
    /// Whether remote control is currently active (peer is controlling)
    @Published var remoteControlActive: Bool = false
    
    /// Last update timestamp (for conflict resolution)
    @Published var lastUpdateTime: Date? = nil
    
    // MARK: - Internal State
    
    /// Stored menu state for recovery after reconnection
    private var storedState: MenuState? = nil
    
    /// Whether we're the controlling device (sending updates)
    private var isController: Bool = false
    
    /// Whether we're the display device (receiving updates)
    var isDisplay: Bool = false
    
    /// Callback to send state updates via WebSocket
    var sendStateUpdate: ((MenuState) -> Void)?
    
    /// Last sent state (to avoid duplicate sends)
    private var lastSentState: MenuState? = nil
    
    // MARK: - State Model
    
    struct MenuState: Codable, Equatable {
        var selectedCategory: String?
        var selectedProduct: String?
        var scrollToProduct: String?
        var timestamp: TimeInterval
        var controllerDeviceId: String?
        
        init(
            selectedCategory: String? = nil,
            selectedProduct: String? = nil,
            scrollToProduct: String? = nil,
            timestamp: TimeInterval = Date().timeIntervalSince1970,
            controllerDeviceId: String? = nil
        ) {
            self.selectedCategory = selectedCategory
            self.selectedProduct = selectedProduct
            self.scrollToProduct = scrollToProduct
            self.timestamp = timestamp
            self.controllerDeviceId = controllerDeviceId
        }
        
        var isEmpty: Bool {
            selectedCategory == nil && selectedProduct == nil && scrollToProduct == nil
        }
    }
    
    // MARK: - Initialization
    
    init() {
        print("[MenuStateSync] Initialized")
    }
    
    // MARK: - Configuration
    
    /// Configure as a controller (cashier or primary display)
    func configureAsController(deviceId: String) {
        print("[MenuStateSync] Configured as CONTROLLER (deviceId: \(deviceId))")
        isController = true
        isDisplay = false
        remoteControlActive = true
    }
    
    /// Configure as a display (receiving remote control)
    func configureAsDisplay() {
        print("[MenuStateSync] Configured as DISPLAY (receiving remote control)")
        isController = false
        isDisplay = true
        remoteControlActive = false
    }
    
    /// Reset to neutral state (local control)
    func resetToLocalControl() {
        print("[MenuStateSync] Reset to local control")
        isController = false
        isDisplay = false
        remoteControlActive = false
        clearState()
    }
    
    // MARK: - State Updates (Outgoing)
    
    /// Update category selection and broadcast to peers
    func updateCategory(_ category: String?, deviceId: String) {
        guard isController else {
            print("[MenuStateSync] ⚠️ Not controller - ignoring category update")
            return
        }
        
        let state = MenuState(
            selectedCategory: category,
            selectedProduct: selectedProduct,
            scrollToProduct: scrollToProduct,
            timestamp: Date().timeIntervalSince1970,
            controllerDeviceId: deviceId
        )
        
        applyAndBroadcast(state)
    }
    
    /// Update product selection and broadcast to peers
    func updateProduct(_ product: String?, deviceId: String) {
        guard isController else {
            print("[MenuStateSync] ⚠️ Not controller - ignoring product update")
            return
        }
        
        let state = MenuState(
            selectedCategory: selectedCategory,
            selectedProduct: product,
            scrollToProduct: scrollToProduct,
            timestamp: Date().timeIntervalSince1970,
            controllerDeviceId: deviceId
        )
        
        applyAndBroadcast(state)
    }
    
    /// Update scroll position and broadcast to peers
    func updateScrollPosition(_ productId: String?, deviceId: String) {
        guard isController else {
            print("[MenuStateSync] ⚠️ Not controller - ignoring scroll update")
            return
        }
        
        let state = MenuState(
            selectedCategory: selectedCategory,
            selectedProduct: selectedProduct,
            scrollToProduct: productId,
            timestamp: Date().timeIntervalSince1970,
            controllerDeviceId: deviceId
        )
        
        applyAndBroadcast(state)
    }
    
    /// Update full menu state and broadcast
    func updateFullState(
        category: String?,
        product: String?,
        scroll: String?,
        deviceId: String
    ) {
        guard isController else {
            print("[MenuStateSync] ⚠️ Not controller - ignoring full state update")
            return
        }
        
        let state = MenuState(
            selectedCategory: category,
            selectedProduct: product,
            scrollToProduct: scroll,
            timestamp: Date().timeIntervalSince1970,
            controllerDeviceId: deviceId
        )
        
        applyAndBroadcast(state)
    }
    
    private func applyAndBroadcast(_ state: MenuState) {
        // Apply locally
        applyState(state, source: "local")
        
        // Store for recovery
        storedState = state
        
        // Broadcast if changed
        if lastSentState != state {
            print("[MenuStateSync] 📤 Broadcasting state: category=\(state.selectedCategory ?? "nil"), product=\(state.selectedProduct ?? "nil"), scroll=\(state.scrollToProduct ?? "nil")")
            sendStateUpdate?(state)
            lastSentState = state
        }
    }
    
    // MARK: - State Updates (Incoming)
    
    /// Receive menu state from remote peer
    func receiveState(_ state: MenuState) {
        guard isDisplay else {
            print("[MenuStateSync] Not configured as display - ignoring received state")
            return
        }
        
        // Check if state is newer than what we have
        if let lastUpdate = lastUpdateTime {
            let receivedTime = Date(timeIntervalSince1970: state.timestamp)
            if receivedTime < lastUpdate {
                print("[MenuStateSync] ⚠️ Received older state - ignoring")
                return
            }
        }
        
        print("[MenuStateSync] 📥 Received state: category=\(state.selectedCategory ?? "nil"), product=\(state.selectedProduct ?? "nil"), scroll=\(state.scrollToProduct ?? "nil")")
        
        // Apply state
        applyState(state, source: "remote")
        
        // Store for recovery
        storedState = state
        
        // Mark remote control as active
        if !remoteControlActive {
            remoteControlActive = true
            print("[MenuStateSync] ✅ Remote control activated")
        }
    }
    
    private func applyState(_ state: MenuState, source: String) {
        print("[MenuStateSync] Applying state from \(source): category=\(state.selectedCategory ?? "nil"), product=\(state.selectedProduct ?? "nil"), scroll=\(state.scrollToProduct ?? "nil")")
        
        selectedCategory = state.selectedCategory
        selectedProduct = state.selectedProduct
        scrollToProduct = state.scrollToProduct
        lastUpdateTime = Date(timeIntervalSince1970: state.timestamp)
    }
    
    // MARK: - State Recovery
    
    /// Request current state from peer (called after reconnection)
    func requestStateSync(deviceId: String) {
        print("[MenuStateSync] 🔄 Requesting state sync from peer")
        
        // Send a special sync request event
        let syncRequest = MenuState(
            timestamp: Date().timeIntervalSince1970,
            controllerDeviceId: deviceId
        )
        
        sendStateUpdate?(syncRequest)
    }
    
    /// Provide current state to peer (response to sync request)
    func provideCurrentState(deviceId: String) {
        guard isController, let stored = storedState else {
            print("[MenuStateSync] No stored state to provide")
            return
        }
        
        print("[MenuStateSync] 📤 Providing current state to peer")
        
        // Re-send current state
        var state = stored
        state.timestamp = Date().timeIntervalSince1970
        state.controllerDeviceId = deviceId
        
        sendStateUpdate?(state)
    }
    
    /// Restore state after reconnection
    func restoreState() {
        guard let stored = storedState else {
            print("[MenuStateSync] No stored state to restore")
            return
        }
        
        print("[MenuStateSync] 🔄 Restoring stored state")
        applyState(stored, source: "restore")
    }
    
    // MARK: - Clear State
    
    func clearState() {
        print("[MenuStateSync] Clearing all menu state")
        selectedCategory = nil
        selectedProduct = nil
        scrollToProduct = nil
        lastUpdateTime = nil
        storedState = nil
        lastSentState = nil
    }
    
    // MARK: - Connection Events
    
    /// Handle connection established
    func onConnectionEstablished() {
        print("[MenuStateSync] Connection established")
        
        if isController {
            // Controller re-sends current state
            if let stored = storedState {
                print("[MenuStateSync] Re-broadcasting state after connection")
                sendStateUpdate?(stored)
            }
        } else if isDisplay {
            // Display requests state sync
            print("[MenuStateSync] Display requesting state sync")
            // Will be triggered by peer:connected event
        }
    }
    
    /// Handle connection lost
    func onConnectionLost() {
        print("[MenuStateSync] Connection lost - maintaining state for recovery")
        remoteControlActive = false
    }
    
    // MARK: - Debugging
    
    func printCurrentState() {
        print("""
        [MenuStateSync] === CURRENT STATE ===
        Controller: \(isController)
        Display: \(isDisplay)
        Remote Active: \(remoteControlActive)
        Category: \(selectedCategory ?? "nil")
        Product: \(selectedProduct ?? "nil")
        Scroll: \(scrollToProduct ?? "nil")
        Last Update: \(lastUpdateTime?.formatted() ?? "never")
        ===================================
        """)
    }
}

// MARK: - WebSocket Event Encoding/Decoding

extension MenuStateSync.MenuState {
    /// Convert to WebSocket event payload
    func toWebSocketEvent(type: String = "menu:state", basketId: String) -> [String: Any] {
        var event: [String: Any] = [
            "type": type,
            "basketId": basketId,
            "timestamp": timestamp
        ]
        
        if let cat = selectedCategory {
            event["selectedCategory"] = cat
        }
        if let prod = selectedProduct {
            event["selectedProduct"] = prod
        }
        if let scroll = scrollToProduct {
            event["scrollToProduct"] = scroll
        }
        if let controller = controllerDeviceId {
            event["controllerDeviceId"] = controller
        }
        
        return event
    }
    
    /// Create from WebSocket event payload
    static func fromWebSocketEvent(_ event: [String: Any]) -> MenuStateSync.MenuState? {
        guard let timestamp = event["timestamp"] as? TimeInterval else {
            return nil
        }
        
        return MenuStateSync.MenuState(
            selectedCategory: event["selectedCategory"] as? String,
            selectedProduct: event["selectedProduct"] as? String,
            scrollToProduct: event["scrollToProduct"] as? String,
            timestamp: timestamp,
            controllerDeviceId: event["controllerDeviceId"] as? String
        )
    }
}
