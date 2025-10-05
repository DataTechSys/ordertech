import SwiftUI
import OrderTechCore
import Foundation

/// Manages local mode functionality for the Display app when operating without a remote cashier
@MainActor
class LocalModeManager: ObservableObject {
    // MARK: - Published Properties
    @Published var isLocalMode: Bool = false
    @Published var showCheckoutOverlay: Bool = false
    @Published var selectedPaymentMethod: PaymentMethod = .cash
    @Published var showReceipt: Bool = false
    @Published var lastOrderReceipt: LocalOrderReceipt?
    @Published var localBasketLines: [BasketLineUI] = []
    @Published var localBasketTotals: BasketTotalsUI = BasketTotalsUI(subtotal: 0, tax: 0, total: 0)
    
    // MARK: - Private Properties
    private var disconnectionTimer: Timer?
    private var lastConnectionState: Bool = true
    private let disconnectionThreshold: TimeInterval = 30.0 // 30 seconds
    private var env: EnvironmentStore?
    
    // Weak reference to DisplaySessionStore for menu sync integration
    weak var displaySessionStore: DisplaySessionStore? {
        didSet {
            // If we have a pending menu reset, do it now
            if pendingMenuReset && displaySessionStore != nil {
                pendingMenuReset = false
                resetMenuToLocalControl()
            }
        }
    }
    
    private var pendingMenuReset: Bool = false
    
    enum PaymentMethod: String, CaseIterable {
        case cash = "cash"
        case card = "card"
        case digital = "digital"
        
        var displayName: String {
            switch self {
            case .cash: return "Cash"
            case .card: return "Card"  
            case .digital: return "Digital Wallet"
            }
        }
        
        var icon: String {
            switch self {
            case .cash: return "banknote"
            case .card: return "creditcard"
            case .digital: return "iphone"
            }
        }
    }
    
    struct LocalOrderReceipt {
        let orderNumber: String
        let timestamp: Date
        let items: [BasketLineUI]
        let totals: BasketTotalsUI
        let paymentMethod: PaymentMethod
        let deviceId: String
    }
    
    // MARK: - Initialization
    init() {
        setupNotificationObservers()
    }
    
    // MARK: - Setup
    func configure(with env: EnvironmentStore, displaySessionStore: DisplaySessionStore? = nil) {
        self.env = env
        self.displaySessionStore = displaySessionStore
    }
    
    /// Check if local mode should be activated by default (when no connection exists)
    func checkInitialState(connected: Bool, peersConnected: Bool) {
        let isConnected = connected && peersConnected
        lastConnectionState = isConnected
        
        print("[LocalModeManager] Initial state check: connected=\(connected), peersConnected=\(peersConnected), should activate=\(!isConnected)")
        
        if !isConnected {
            activateLocalMode()
        }
    }
    
    private func setupNotificationObservers() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { _ in
            self.saveLocalState()
        }
        
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { _ in
            self.loadLocalState()
            self.attemptToSubmitPendingOrders()
        }
    }
    
    // MARK: - Connection Monitoring
    func updateConnectionStatus(connected: Bool, peersConnected: Bool) {
        let isConnected = connected && peersConnected
        
        print("[LocalModeManager] Connection status update: connected=\(connected), peersConnected=\(peersConnected), isConnected=\(isConnected), lastState=\(lastConnectionState)")
        
        if isConnected != lastConnectionState {
            lastConnectionState = isConnected
            
            if isConnected {
                // Connection restored
                print("[LocalModeManager] Connection restored - handling reconnection")
                handleConnectionRestored()
            } else {
                // Connection lost - activate local mode immediately
                print("[LocalModeManager] Connection lost - activating local mode immediately")
                activateLocalMode()
            }
        }
    }
    
    private func startDisconnectionTimer() {
        disconnectionTimer?.invalidate()
        disconnectionTimer = Timer.scheduledTimer(withTimeInterval: disconnectionThreshold, repeats: false) { _ in
            DispatchQueue.main.async {
                self.activateLocalMode()
            }
        }
    }
    
    private func handleConnectionRestored() {
        disconnectionTimer?.invalidate()
        disconnectionTimer = nil
        
        if isLocalMode {
            // Attempt to submit pending orders
            attemptToSubmitPendingOrders()
            
            // Always deactivate local mode when cashier reconnects
            // This ensures proper handoff of control back to the remote cashier
            print("[LocalModeManager] Cashier reconnected - deactivating local mode to restore remote control")
            deactivateLocalMode()
        }
    }
    
    // MARK: - Local Mode Management
    func activateLocalMode() {
        guard !isLocalMode else {
            print("[LocalModeManager] Local mode already active, skipping activation")
            return
        }
        
        print("[LocalModeManager] Activating local mode")
        isLocalMode = true
        disconnectionTimer?.invalidate()
        disconnectionTimer = nil
        loadLocalState()
        
        // Reset menu synchronization to local control when activating local mode
        resetMenuToLocalControl()
    }
    
    private func deactivateLocalMode() {
        guard isLocalMode else {
            print("[LocalModeManager] Local mode already inactive, skipping deactivation")
            return
        }
        
        print("[LocalModeManager] Deactivating local mode - restoring remote control")
        isLocalMode = false
        showCheckoutOverlay = false
        clearLocalBasket()
        
        // Reset menu sync to allow remote control when deactivating local mode
        resetMenuToRemoteControl()
    }
    
    // MARK: - Local Basket Management
    func addToLocalBasket(product: Product, qty: Int = 1) {
        let lineId = "\(product.id):local:\(UUID().uuidString)"
        
        // Check if product already exists in local basket
        if let existingIndex = localBasketLines.firstIndex(where: { 
            $0.id.hasPrefix(product.id + ":") || $0.id == product.id 
        }) {
            // Create updated line with new qty and total
            let existingLine = localBasketLines[existingIndex]
            let newQty = existingLine.qty + qty
            let newTotal = existingLine.unitPrice * Double(newQty)
            let updatedLine = BasketLineUI(
                id: existingLine.id,
                name: existingLine.name,
                qty: newQty,
                unitPrice: existingLine.unitPrice,
                lineTotal: newTotal,
                options: existingLine.options,
                imageURL: existingLine.imageURL
            )
            localBasketLines[existingIndex] = updatedLine
        } else {
            // Add new line
            let newLine = BasketLineUI(
                id: lineId,
                name: product.name,
                qty: qty,
                unitPrice: product.price,
                lineTotal: product.price * Double(qty),
                options: [],
                imageURL: product.image_url
            )
            localBasketLines.append(newLine)
        }
        
        updateLocalBasketTotals()
        saveLocalState()
    }
    
    func removeFromLocalBasket(lineId: String) {
        localBasketLines.removeAll { $0.id == lineId }
        updateLocalBasketTotals()
        saveLocalState()
    }
    
    func setLocalLineQty(lineId: String, qty: Int) {
        if let index = localBasketLines.firstIndex(where: { $0.id == lineId }) {
            if qty <= 0 {
                localBasketLines.remove(at: index)
            } else {
                let existingLine = localBasketLines[index]
                let newTotal = existingLine.unitPrice * Double(qty)
                let updatedLine = BasketLineUI(
                    id: existingLine.id,
                    name: existingLine.name,
                    qty: qty,
                    unitPrice: existingLine.unitPrice,
                    lineTotal: newTotal,
                    options: existingLine.options,
                    imageURL: existingLine.imageURL
                )
                localBasketLines[index] = updatedLine
            }
            updateLocalBasketTotals()
            saveLocalState()
        }
    }
    
    func clearLocalBasket() {
        localBasketLines.removeAll()
        updateLocalBasketTotals()
        saveLocalState()
    }
    
    private func updateLocalBasketTotals() {
        let subtotal = localBasketLines.reduce(0.0) { $0 + $1.lineTotal }
        let tax = subtotal * 0.0 // No tax for now, can be configured
        let total = subtotal + tax
        
        localBasketTotals = BasketTotalsUI(subtotal: subtotal, tax: tax, total: total)
    }
    
    // MARK: - Checkout Process
    func startCheckout() {
        guard !localBasketLines.isEmpty else { return }
        showCheckoutOverlay = true
    }
    
    func confirmOrder() {
        guard !localBasketLines.isEmpty else { return }
        
        let orderNumber = generateOrderNumber()
        let deviceId = env?.deviceToken ?? "unknown-device"
        
        let receipt = LocalOrderReceipt(
            orderNumber: orderNumber,
            timestamp: Date(),
            items: localBasketLines,
            totals: localBasketTotals,
            paymentMethod: selectedPaymentMethod,
            deviceId: deviceId
        )
        
        // Save order locally
        savePendingOrder(receipt)
        
        // Show receipt
        lastOrderReceipt = receipt
        showReceipt = true
        showCheckoutOverlay = false
        
        // Clear local basket
        clearLocalBasket()
        
        // Try to submit to server
        attemptToSubmitOrder(receipt)
    }
    
    func cancelCheckout() {
        showCheckoutOverlay = false
    }
    
    func dismissReceipt() {
        showReceipt = false
        lastOrderReceipt = nil
    }
    
    // MARK: - Order Submission
    private func attemptToSubmitOrder(_ receipt: LocalOrderReceipt) {
        guard let env = env else { return }
        
        Task {
            do {
                try await submitOrderToServer(receipt, env: env)
                // Remove from pending if successful
                removePendingOrder(receipt.orderNumber)
            } catch {
                print("[LocalModeManager] Failed to submit order: \(error)")
                // Order remains in pending list for retry
            }
        }
    }
    
    private func attemptToSubmitPendingOrders() {
        let pendingOrders = loadPendingOrders()
        
        for order in pendingOrders {
            attemptToSubmitOrder(order)
        }
    }
    
    private func submitOrderToServer(_ receipt: LocalOrderReceipt, env: EnvironmentStore) async throws {
        var urlComponents = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        urlComponents.path = "/api/local-order"
        
        guard let url = urlComponents.url else {
            throw NSError(domain: "LocalMode", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid server URL"])
        }
        
        let orderData: [String: Any] = [
            "order_number": receipt.orderNumber,
            "device_id": receipt.deviceId,
            "timestamp": ISO8601DateFormatter().string(from: receipt.timestamp),
            "payment_method": receipt.paymentMethod.rawValue,
            "subtotal": receipt.totals.subtotal,
            "tax": receipt.totals.tax,
            "total": receipt.totals.total,
            "items": receipt.items.map { line in
                [
                    "product_id": extractProductId(from: line.id),
                    "name": line.name,
                    "quantity": line.qty,
                    "unit_price": line.unitPrice,
                    "line_total": line.lineTotal,
                    "options": line.options
                ]
            }
        ]
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: orderData)
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "LocalMode", code: 2, userInfo: [NSLocalizedDescriptionKey: "Server error"])
        }
        
        print("[LocalModeManager] Successfully submitted order \(receipt.orderNumber) to server")
    }
    
    // MARK: - Persistence
    private func saveLocalState() {
        let encoder = JSONEncoder()
        
        if let basketData = try? encoder.encode(localBasketLines) {
            UserDefaults.standard.set(basketData, forKey: "localBasketLines")
        }
        
        if let totalsData = try? encoder.encode(localBasketTotals) {
            UserDefaults.standard.set(totalsData, forKey: "localBasketTotals")
        }
        
        UserDefaults.standard.set(selectedPaymentMethod.rawValue, forKey: "selectedPaymentMethod")
    }
    
    private func loadLocalState() {
        let decoder = JSONDecoder()
        
        if let basketData = UserDefaults.standard.data(forKey: "localBasketLines"),
           let lines = try? decoder.decode([BasketLineUI].self, from: basketData) {
            localBasketLines = lines
        }
        
        if let totalsData = UserDefaults.standard.data(forKey: "localBasketTotals"),
           let totals = try? decoder.decode(BasketTotalsUI.self, from: totalsData) {
            localBasketTotals = totals
        }
        
        if let paymentMethodString = UserDefaults.standard.string(forKey: "selectedPaymentMethod"),
           let paymentMethod = PaymentMethod(rawValue: paymentMethodString) {
            selectedPaymentMethod = paymentMethod
        }
    }
    
    private func savePendingOrder(_ receipt: LocalOrderReceipt) {
        var pendingOrders = loadPendingOrders()
        pendingOrders.append(receipt)
        
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(pendingOrders) {
            UserDefaults.standard.set(data, forKey: "pendingLocalOrders")
        }
    }
    
    private func loadPendingOrders() -> [LocalOrderReceipt] {
        let decoder = JSONDecoder()
        
        if let data = UserDefaults.standard.data(forKey: "pendingLocalOrders"),
           let orders = try? decoder.decode([LocalOrderReceipt].self, from: data) {
            return orders
        }
        
        return []
    }
    
    private func removePendingOrder(_ orderNumber: String) {
        var pendingOrders = loadPendingOrders()
        pendingOrders.removeAll { $0.orderNumber == orderNumber }
        
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(pendingOrders) {
            UserDefaults.standard.set(data, forKey: "pendingLocalOrders")
        }
    }
    
    // MARK: - Utilities
    private func generateOrderNumber() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd"
        let dateStr = formatter.string(from: Date())
        let randomSuffix = Int.random(in: 1000...9999)
        return "LOCAL-\(dateStr)-\(randomSuffix)"
    }
    
    /// Reset menu synchronization to local control through DisplaySessionStore
    private func resetMenuToLocalControl() {
        guard let sessionStore = displaySessionStore else {
            print("[LocalModeManager] DisplaySessionStore reference not set yet, marking for pending reset")
            pendingMenuReset = true
            return
        }
        
        print("[LocalModeManager] Resetting menu synchronization to local control")
        sessionStore.resetToLocalControl()
    }
    
    /// Reset menu synchronization to allow remote control when deactivating local mode
    private func resetMenuToRemoteControl() {
        guard let sessionStore = displaySessionStore else {
            print("[LocalModeManager] DisplaySessionStore reference not available for remote reset")
            return
        }
        
        print("[LocalModeManager] Resetting menu synchronization to allow remote control")
        sessionStore.resetToRemoteControl()
    }
    
    private func extractProductId(from lineId: String) -> String {
        // Extract base product ID from local line ID format: "productId:local:uuid"
        let components = lineId.split(separator: ":")
        return components.first.map(String.init) ?? lineId
    }
}

// MARK: - Codable Extensions
extension LocalModeManager.LocalOrderReceipt: Codable {}
extension LocalModeManager.PaymentMethod: Codable {}
