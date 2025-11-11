import SwiftUI
import OrderTechCore
import Foundation
import Combine
import Security


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
            case .cash: return "Knet"
            case .card: return "Credit Card"
            case .digital: return "Koobs Membership"
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
        // Clear basket on cold start
        clearLocalBasket()
        print("[LocalModeManager] Cold start - basket cleared")
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
        
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("OT.PaymentMethod.Updated"),
            object: nil,
            queue: .main
        ) { notification in
            if let paymentMethodString = notification.userInfo?["paymentMethod"] as? String,
               let paymentMethod = PaymentMethod(rawValue: paymentMethodString) {
                self.selectedPaymentMethod = paymentMethod
                print("[LocalModeManager] Received payment method update from remote: \(paymentMethod.displayName)")
            }
        }
        
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("OT.CheckoutBasket.Updated"),
            object: nil,
            queue: .main
        ) { notification in
            if let linesData = notification.userInfo?["lines"] as? [[String: Any]],
               let totalsData = notification.userInfo?["totals"] as? [String: Any] {
                // Parse lines
                let lines = linesData.compactMap { lineDict -> BasketLineUI? in
                    guard let id = lineDict["id"] as? String,
                          let name = lineDict["name"] as? String,
                          let qty = lineDict["qty"] as? Int,
                          let unitPrice = lineDict["unitPrice"] as? Double,
                          let lineTotal = lineDict["lineTotal"] as? Double,
                          let options = lineDict["options"] as? [String] else {
                        return nil
                    }
                    let nameAr = lineDict["nameAr"] as? String
                    let imageURL = lineDict["imageURL"] as? String
                    return BasketLineUI(
                        id: id,
                        name: name,
                        nameAr: nameAr,
                        qty: qty,
                        unitPrice: unitPrice,
                        lineTotal: lineTotal,
                        options: options,
                        imageURL: imageURL
                    )
                }
                
                // Parse totals
                if let subtotal = totalsData["subtotal"] as? Double,
                   let tax = totalsData["tax"] as? Double,
                   let total = totalsData["total"] as? Double {
                    self.localBasketLines = lines
                    self.localBasketTotals = BasketTotalsUI(subtotal: subtotal, tax: tax, total: total)
                    print("[LocalModeManager] Received checkout basket update from remote: \(lines.count) items, total: \(total)")
                }
            }
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
    func addToLocalBasket(product: Product, qty: Int = 1, modifiers: [[String: Any]]? = nil) {
        let lineId = "\(product.id):local:\(UUID().uuidString)"
        
        // Compute options and price delta from modifiers
        let optionLabels: [String] = (modifiers ?? []).compactMap { item in
            let name = (item["name"] as? String) ?? ""
            let quantity = (item["quantity"] as? Int) ?? 1
            // Format with quantity if > 1 (e.g., "2x Espresso Shot")
            if quantity > 1 {
                return "\(quantity)x \(name)"
            }
            return name
        }.filter { !$0.isEmpty }
        let delta: Double = (modifiers ?? []).reduce(0.0) { sum, item in
            let quantity = (item["quantity"] as? Int) ?? 1
            var price: Double = 0
            if let v = item["price"] as? Double { price = v }
            else if let s = item["price"] as? String, let v = Double(s) { price = v }
            return sum + (price * Double(quantity))
        }
        let unit = product.price + delta
        let total = unit * Double(qty)
        
        // Merge only when no modifiers (to preserve separate lines when customizations exist)
        if optionLabels.isEmpty, let existingIndex = localBasketLines.firstIndex(where: {
            $0.id.hasPrefix(product.id + ":") || $0.id == product.id
        }) {
            let existingLine = localBasketLines[existingIndex]
            let newQty = existingLine.qty + qty
            let newTotal = existingLine.unitPrice * Double(newQty)
            let updatedLine = BasketLineUI(
                id: existingLine.id,
                name: existingLine.name,
                nameAr: existingLine.nameAr,
                qty: newQty,
                unitPrice: existingLine.unitPrice,
                lineTotal: newTotal,
                options: existingLine.options,
                imageURL: existingLine.imageURL
            )
            localBasketLines[existingIndex] = updatedLine
        } else {
            // Extract Arabic name from name_localized
            let nameAr = product.name_localized?["ar"]
            let newLine = BasketLineUI(
                id: lineId,
                name: product.name,
                nameAr: nameAr,
                qty: qty,
                unitPrice: unit,
                lineTotal: total,
                options: optionLabels,
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
                    nameAr: existingLine.nameAr,
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
        
        print("[LocalModeManager] startCheckout: showCheckoutOverlay=true")
        
        // Sync checkout overlay state to remote display if connected
        if let store = displaySessionStore, store.peersConnected {
            print("[LocalModeManager] Sending checkout overlay to remote (peersConnected=true)")
            store.sendCheckoutOverlayState(show: true)
        } else {
            let hasStore = displaySessionStore != nil
            let isConnected = displaySessionStore?.peersConnected ?? false
            print("[LocalModeManager] NOT sending checkout overlay: hasStore=\(hasStore), peersConnected=\(isConnected)")
        }
    }
    
    func startRemoteCheckout(from store: DisplaySessionStore) {
        // Copy remote basket to local basket for checkout
        localBasketLines = store.basketLines
        localBasketTotals = store.basketTotals
        saveLocalState()
        
        // Store reference to clear remote basket after checkout
        self.displaySessionStore = store
        
        // Start checkout with remote basket
        showCheckoutOverlay = true
        
        print("[LocalModeManager] startRemoteCheckout: showCheckoutOverlay=true, peersConnected=\(store.peersConnected)")
        
        // Sync checkout overlay state AND basket data to remote display
        store.sendCheckoutOverlayState(show: true)
        store.sendCheckoutBasketData(lines: localBasketLines, totals: localBasketTotals)
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
        
        // Close checkout overlay and return to main screen
        showCheckoutOverlay = false
        lastOrderReceipt = nil  // Don't show receipt, return to main screen
        showReceipt = false
        
        // Sync checkout overlay close to remote display
        if let store = displaySessionStore, store.peersConnected {
            store.sendCheckoutOverlayState(show: false)
        }
        
        // Clear local basket
        clearLocalBasket()
        
        // Also clear remote basket if we have a connected display session
        // This applies to both remote checkout and D2D connections
        if let sessionStore = displaySessionStore, sessionStore.peersConnected {
            // Send basket:clear event to reset the session
            sessionStore.clearRemoteBasket()
            print("[LocalModeManager] Cleared remote basket after checkout")
        }
        
        // Try to submit to server
        attemptToSubmitOrder(receipt)
    }
    
    func cancelCheckout() {
        showCheckoutOverlay = false
        
        // Sync checkout overlay close to remote display if connected
        if let store = displaySessionStore, store.peersConnected {
            store.sendCheckoutOverlayState(show: false)
        }
    }
    
    func syncPaymentMethod() {
        // Sync payment method selection to remote display if connected
        if let store = displaySessionStore, store.peersConnected {
            store.sendPaymentMethodUpdate(paymentMethod: selectedPaymentMethod.rawValue)
            print("[LocalModeManager] Synced payment method to remote: \(selectedPaymentMethod.displayName)")
        }
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
        
        // Add device token for authentication
        if let deviceToken = env.deviceToken {
            request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")
        }
        
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
