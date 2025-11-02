import Foundation
import Combine
import OrderTechCore

/// Minimal DisplaySessionStore for local-only DriveThru app
/// No WebSocket, RTC, or remote connections - just local state management
@MainActor
final class DisplaySessionStore: ObservableObject {
    // UI state for poster overlay
    @Published var showIdlePoster: Bool = false
    @Published var poster: PosterState? = nil
    
    // Basket UI state (unused in local mode, but needed for compatibility)
    @Published var basketLines: [BasketLineUI] = []
    @Published var basketTotals: BasketTotalsUI = .zero
    
    // Preview state (unused in local mode)
    @Published var preview: PreviewState? = nil
    
    // Product selection state (for product detail popup)
    @Published var selectedProductId: String? = nil
    @Published var selectedCategoryName: String? = nil
    @Published var scrollToProductId: String? = nil
    
    // Product options state
    @Published var optionsQty: Int = 1
    @Published var optionsSelection: [String: Set<String>] = [:]
    @Published var optionsExpanded: [String: Bool] = [:]
    @Published var optionsExpandedGroups: Set<String> = []
    @Published var pendingEditSku: String? = nil
    
    // Checkout overlay state
    @Published var showCheckoutOverlay: Bool = false
    
    // Connection state (always false for local-only mode)
    @Published var connected: Bool = false
    @Published var peersConnected: Bool = false
    
    // Remote connection info (unused in local mode)
    @Published var lastCashierName: String? = nil
    @Published var connectedDisplayName: String? = nil
    @Published var connectedDisplayId: String? = nil
    
    // Stub properties for compatibility
    var rtcOrchestrator: RTCProviderOrchestrator? { nil }
    var deviceId: String
    var friendlyName: String
    
    init(deviceId: String, friendlyName: String) {
        self.deviceId = deviceId
        self.friendlyName = friendlyName
        print("[DisplaySessionStore] Initialized in local-only mode")
    }
    
    // Stub methods - do nothing in local mode
    func start() {
        print("[DisplaySessionStore] Local-only mode - no remote connections")
    }
    
    func stop() {
        // No connections to stop
    }
    
    func sendSelectCategory(name: String) {
        // Local only - no remote syncing
    }
    
    func sendShowProduct(id: String) {
        // Local only - no remote syncing
    }
    
    func addToBasket(product: Product, qty: Int, modifiers: [[String: Any]]? = nil) {
        // Local mode uses LocalModeManager for basket
    }
    
    func removeFromBasket(sku: String) {
        // Local mode uses LocalModeManager for basket
    }
    
    func sendOptionsClose() {
        // Local only - no remote syncing
    }
    
    func sendCheckoutOverlayState(show: Bool) {
        // Local only - no remote syncing
    }
    
    func sendCheckoutBasketData(lines: [BasketLineUI], totals: BasketTotalsUI) {
        // Local only - no remote syncing
    }
    
    func clearRemoteBasket() {
        // Local only - no remote basket
    }
    
    func sendPaymentMethodUpdate(paymentMethod: String) {
        // Local only - no remote syncing
    }
    
    func resetToLocalControl() {
        // Already in local mode
    }
    
    func resetToRemoteControl() {
        // Not supported in DriveThru
    }
}

// Stub for RTCProviderOrchestrator
class RTCProviderOrchestrator {
    var providerState: RTCProviderState { .stopped }
}

enum RTCProviderState {
    case stopped
    case connected
}

// UI models are defined in DisplayUIModels.swift
