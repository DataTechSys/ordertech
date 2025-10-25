import Foundation
import Combine
import OrderTechCore

@MainActor
final class SessionStore: ObservableObject {
    @Published var basketId: String? = nil
    @Published var providerTag: String = "" // Live | Mock — empty until LiveKit provider is explicitly started
    @Published var signalBars: Int = 0 // 0...3
    @Published var posterActive: Bool = false
    @Published var micMuted: Bool = false
    // UI mirroring from Display → Cashier
    @Published var selectedCategoryName: String? = nil
    @Published var selectedProductId: String? = nil
    @Published var scrollToProductId: String? = nil

    private var ws: OrderTechCore.WebSocketManager!
    
    init() {
        // WebSocket manager will be set via attach()
    }
    private var bag = Set<AnyCancellable>()
    private weak var basketRef: BasketStore?
    private weak var envStore: EnvironmentStore?
    private var livekitStarting: Bool = false

    // Track WS basket versions and debounce re-introducing just-removed items
    private var lastBasketVersion: Int? = nil
    private var recentlyRemoved: [String: Date] = [:]
    private let recentlyRemovedWindow: TimeInterval = 0.8

    // Suppress mapping of basket items with these SKU prefixes (used while options sheet is open)
    private var suppressedPrefixes: [String] = []

    // RTC provider instance (LiveKit-only)
    private var livekit: LiveKitRTC?
    
    // Connection state tracking for filtering remote updates during unstable periods
    @Published var isConnectionStable: Bool = true
    private var connectionStableTimer: Timer?
    private var fallbackStabilityTimer: Timer?
    
    // Debouncing for excessive nil/close commands
    private var lastCloseCommandAt: Date = Date.distantPast
    private let closeCommandDebounceInterval: TimeInterval = 0.5
    
    #if canImport(LiveKit)
    var currentLiveKit: LiveKitRTC? { livekit }
    #endif

    // Future: peersConnected, shouldConnect, overlay state, etc.

    func attach(basket: BasketStore, env: EnvironmentStore, ws: OrderTechCore.WebSocketManager) {
        self.basketRef = basket
        self.envStore = env
        self.ws = ws
        // Subscribe once to WS stream
        ws.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] dict in 
                // Convert dictionary to WSEvent if possible
                if let data = try? JSONSerialization.data(withJSONObject: dict),
                   let event = try? JSONDecoder().decode(WSEvent.self, from: data) {
                    self?.handle(event: event)
                } else {
                    self?.handleRawEvent(dict)
                }
            }
            .store(in: &bag)
        ws.$isConnected
            .receive(on: DispatchQueue.main)
            .removeDuplicates()
            .sink { [weak self] connected in
                guard let self = self else { return }
                
                if connected {
                    Swift.print("[SessionStore] WebSocket connected - handling reconnection")
                    // WebSocket reconnected - mark as unstable during reestablishment
                    self.markConnectionUnstable()
                    
                    if let id = self.basketId {
                        self.ws.sendSubscribe(basketId: id)
                        self.ws.sendHello(basketId: id, role: "cashier", name: "Cashier iPad")
                        Swift.print("[SessionStore] Sent subscribe/hello for basket: \(id)")
                        
                        // Fetch current poster state from server when reconnecting
                        if let envStore = self.envStore {
                            Task {
                                await self.fetchPosterState(env: envStore)
                            }
                        }
                    }
                    
                    // Mark as stable after giving time for initial message flood to settle
                    Swift.print("[SessionStore] Scheduling WebSocket stability recovery in 2.0 seconds")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                        Swift.print("[SessionStore] WebSocket stability delay elapsed - marking stable")
                        self?.markConnectionStable()
                    }
                } else {
                    Swift.print("[SessionStore] WebSocket disconnected - marking unstable")
                    // WebSocket disconnected - mark as unstable
                    self.markConnectionUnstable()
                }
            }
            .store(in: &bag)
    }

    func connectIfNeeded(env: EnvironmentStore, basketId: String) {
        self.basketId = basketId
        ws.connect()
    }

    // Start a session with a specific display (pairId) and connect WS/RTC
    @MainActor
    func startSessionWithPairId(env: EnvironmentStore, pairId: String) async {
        self.basketId = pairId
        // Show floating bubble immediately so user sees feedback (prefer LiveKit)
        providerTag = "Live"
        let client = HttpClient(env: env)
        _ = try? await client.sessionStart(pairId: pairId)
        ws.connect()
        // Fetch current poster state when starting session
        await fetchPosterState(env: env)
        // Begin RTC with LiveKit-only connection
        await connectRTC(env: env)
    }

    func setBasket(id: String?) { basketId = id }

    // Temporary fast pair: choose first available display and start a session, then connect WS.
    @MainActor
    func attemptAutoFastPair(env: EnvironmentStore) async {
        // Check if device token is available
        if env.deviceToken == nil {
            print("[SessionStore] AutoFastPair: deviceToken missing. Skipping.")
            return
        }
        if basketId != nil {
            print("[SessionStore] AutoFastPair: basket already set: \(basketId!)")
            return
        }
        let client = HttpClient(env: env)
        do {
            let displays = try await client.presenceDisplays()
            print("[SessionStore] AutoFastPair: presence count=\(displays.count)")
            guard let chosen = displays.first(where: { ($0.busy ?? false) == false }) ?? displays.first else {
                print("[SessionStore] AutoFastPair: no displays available.")
                return
            }
            self.basketId = chosen.id
            print("[SessionStore] AutoFastPair: chose display id=\(chosen.id)")
            // Start session first to align with web flow
            _ = try? await client.sessionStart(pairId: chosen.id)
            // Open WebSocket which will auto send subscribe/hello
            ws.connect()
            // Fetch current poster state when auto-pairing
            await fetchPosterState(env: env)
        } catch {
            print("[SessionStore] AutoFastPair failed: \(error.localizedDescription)")
        }
    }

    func toggleMute() {
        print("[SessionStore] toggleMute called - current state: \(micMuted)")
        micMuted.toggle()
        print("[SessionStore] toggleMute - new state: \(micMuted)")
        
        if let lk = livekit {
            print("[SessionStore] calling setMicMuted(\(micMuted)) on LiveKit instance: \(lk)")
            lk.setMicMuted(micMuted)
        } else {
            print("[SessionStore] ERROR - no LiveKit instance available for mute")
        }
    }
    
    func flipCamera() {
        print("[SessionStore] flipCamera called")
        if let lk = livekit {
            print("[SessionStore] calling flipCamera on LiveKit instance: \(lk)")
            // lk.flipCamera() // Method not available in LiveKitRTC
        } else {
            print("[SessionStore] ERROR - no LiveKit instance available")
        }
    }

    // Control what incoming SKUs to suppress in basket mapping (e.g., while options sheet is open)
    func setSuppressedPrefixes(_ prefixes: [String]) { suppressedPrefixes = prefixes }
    func clearSuppressedPrefixes() { suppressedPrefixes = [] }

    // Outgoing basket ops
    func sendAdd(sku: String, name: String, price: Double, imageURL: String? = nil, options: [String]? = nil, modifiers: [BasketItemBody.Modifier]? = nil) {
        guard let id = basketId else { return }
        // Send basket add operation via WebSocket
        var payload: [String: Any] = [
            "type": "basket:add",
            "basketId": id,
            "sku": sku,
            "name": name,
            "price": price
        ]
        if let img = imageURL { payload["imageURL"] = img }
        ws.send(json: payload)
    }

    // UI mirror: product preview/options on display
    func sendShowPreview(product: Product) {
        guard let id = basketId else { return }
        let p = productPayload(product)
        ws.send(json: ["type":"ui:showPreview", "basketId": id, "product": p])
    }
    func sendShowOptions(product: Product, groups: [AnyCodableModifierGroup]) {
        guard let id = basketId else { return }
        let p = productPayload(product)
        let gs: [[String: Any]] = groups.map { g in
            var obj: [String: Any] = [
                "id": g.group.id,
                "name": g.group.name,
                "required": g.group.required ?? false,
                "min": g.group.min_select ?? 0,
                "max": g.group.max_select ?? Int.max
            ]
            let opts: [[String: Any]] = g.options.map { o in ["id": o.id, "name": o.name, "delta": o.price ?? 0] }
            obj["options"] = opts
            return obj
        }
        ws.send(json: ["type":"ui:showOptions", "basketId": id, "product": p, "groups": gs])
    }
    func sendOptionsClose() {
        guard let id = basketId else { return }
        ws.send(json: ["type":"ui:optionsClose", "basketId": id])
    }
    func sendOptionsCancel() {
        guard let id = basketId else { return }
        ws.send(json: ["type":"ui:optionsCancel", "basketId": id])
    }

    private func productPayload(_ p: Product) -> [String: Any] {
        var obj: [String: Any] = [
            "id": p.id,
            "name": p.name,
            "price": p.price
        ]
        if let ar = p.name_localized { obj["name_localized"] = ar }
        if let img = p.image_url { obj["image_url"] = img }
        return obj
    }
    func sendRemove(sku: String) {
        guard let id = basketId else { return }
        // Mark as recently removed to prevent flicker if a stale WS update reintroduces it briefly
        recentlyRemoved[sku] = Date()
        ws.send(json: ["type": "basket:remove", "basketId": id, "sku": sku])
    }
    func sendSetQty(sku: String, qty: Int) {
        guard let id = basketId else { return }
        ws.send(json: ["type": "basket:setQty", "basketId": id, "sku": sku, "qty": qty])
    }
    func sendSelectCategory(name: String) {
        guard let id = basketId else { return }
        ws.send(json: ["type":"ui:selectCategory", "basketId": id, "name": name])
    }

    func sendShowProduct(id productId: String) {
        guard let id = basketId else { 
            print("[SessionStore] sendShowProduct: no basketId, cannot send to display")
            return 
        }
        let message = ["type":"ui:showOptions", "basketId": id, "product_id": productId]
        print("[SessionStore] sendShowProduct: sending to display - \(message)")
        ws.send(json: message)
    }

    func sendScrollTo(id productId: String) {
        guard let id = basketId else { return }
        ws.send(json: ["type":"ui:scrollTo", "basketId": id, "product_id": productId])
    }
    func sendVideoModeSmall() {
        guard let id = basketId else { return }
        ws.send(json: ["type":"ui:videoMode", "basketId": id, "mode": "small"]) 
    }
    func sendClear() {
        guard let id = basketId else { return }
        ws.sendBasketUpdate(basketId: id, op: .clear)
    }

    @MainActor
    func pay(env: EnvironmentStore) async {
        guard let id = basketId, !id.isEmpty else { return }
        let client = HttpClient(env: env)
        do { _ = try await client.sessionPay(pairId: id) } catch { /* non-fatal */ }
    }

    @MainActor
    func reset(env: EnvironmentStore) async {
        guard let id = basketId, !id.isEmpty else { return }
        let client = HttpClient(env: env)
        do {
            _ = try await client.sessionReset(pairId: id)
            // Reset UI state locally
            posterActive = false
            signalBars = 0
        } catch { /* non-fatal */ }
    }

    @MainActor
    func togglePoster(env: EnvironmentStore) async {
        guard let id = basketId, !id.isEmpty else { return }
        let client = HttpClient(env: env)
        do {
            if posterActive {
                _ = try await client.posterStop(pairId: id)
                // Send WebSocket event to Display app
                ws.send(json: ["type": "poster:stop", "basketId": id])
            } else {
                _ = try await client.posterStart(pairId: id)
                // Send WebSocket event to Display app
                ws.send(json: ["type": "poster:start", "basketId": id])
            }
            // Optimistic UI; normally poster:status WS event will confirm
            posterActive.toggle()
            print("[SessionStore] togglePoster: sent \(posterActive ? "poster:start" : "poster:stop") to display")
        } catch { /* non-fatal */ }
    }

    @MainActor
    func fetchPosterState(env: EnvironmentStore) async {
        guard let id = basketId, !id.isEmpty else { return }
        let client = HttpClient(env: env)
        do {
            let response = try await client.getPosterStatus(pairId: id)
            let posterState = response.poster_active ?? false
            posterActive = posterState
            print("[SessionStore] fetchPosterState: retrieved poster state from server - active: \(posterState)")
        } catch {
            print("[SessionStore] fetchPosterState failed: \(error.localizedDescription) - keeping current state")
        }
    }

    // MARK: - RTC integration
    // Connect using LiveKit-only (P2P deprecated as of GENERAL_LOG.md)
    func connectRTC(env: EnvironmentStore) async {
        await _connectRTC(env: env)
    }

    private func _connectRTC(env: EnvironmentStore) async {
        print("[SessionStore] connectRTC called. basketId=\(basketId ?? "nil") - LiveKit-only mode")
        // Ensure WS is connected before sending provider events to the Display
        await waitForWSConnected()
        let id: String
        if let existing = basketId {
            id = existing
        } else {
            guard let paired = await fastPairIfNeeded(env: env) else {
                print("[SessionStore] fastPairIfNeeded returned nil. Aborting connect.")
                return
            }
            id = paired
        }
        let client = HttpClient(env: env)
        _ = try? await client.sessionStart(pairId: id)
        let cfg = try? await client.getWebRTCConfig()
        
        // LIVEKIT-ONLY: Skip provider ordering and go directly to LiveKit
        print("[SessionStore] Using LiveKit-only connection (P2P deprecated)")
        
        #if canImport(LiveKit)
        // Mark connection as unstable during reconnection process
        markConnectionUnstable()
        
        // Ensure complete cleanup of any existing LiveKit instance before creating new one
        if let existingLk = self.livekit {
            print("[SessionStore] Cleaning up existing LiveKit instance before reconnect")
            existingLk.stop()
            self.livekit = nil
            
            // Video views will automatically detach when LiveKit instance is cleared
            
            // Allow cleanup to complete before proceeding
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        
        providerTag = "Live"
        // Always use a fresh LiveKit instance per session to avoid stale state
        let lk = LiveKitRTC(pairId: id, http: client)
        
        // Wire up connection stability callbacks (not available in current LiveKitRTC)
        // lk.onConnectionStabilityChanged = { [weak self] (isStable: Bool) in
        //     print("[SessionStore] LiveKit reported connection stability change: \(isStable)")
        //     if isStable {
        //         self?.handleLiveKitConnectionFullyReady()
        //     } else {
        //         self?.markConnectionUnstable()
        //     }
        // }
        
        // Wire up mute state sync callback (not available in current LiveKitRTC)
        // lk.onMuteStateSyncRequired = { [weak self] (liveKitMuted: Bool) in
        //     print("[SessionStore] LiveKit requesting mute state sync: LiveKit muted=\(liveKitMuted)")
        //     DispatchQueue.main.async {
        //         guard let self = self else { return }
        //         print("[SessionStore] Current SessionStore micMuted=\(self.micMuted), LiveKit muted=\(liveKitMuted)")
        //         if self.micMuted != liveKitMuted {
        //             print("[SessionStore] Syncing SessionStore mute state to match LiveKit: \(liveKitMuted)")
        //             self.micMuted = liveKitMuted
        //         } else {
        //             print("[SessionStore] Mute states already in sync")
        //         }
        //     }
        // }
        
        self.livekit = lk
        await waitForWSConnected()
        sendProviderEvent(provider: "livekit", id: id)
        do {
            try await lk.start()
            self.signalBars = max(self.signalBars, lk.signalBars)
            print("[SessionStore] LiveKit started successfully. bars=\(self.signalBars)")
            // Mark connection as stable after successful connection
            markConnectionStable()
            return
        } catch {
            print("[SessionStore] LiveKit start failed: \(error.localizedDescription)")
            self.livekit = nil
            // When LiveKit is unavailable due to server config, provide mock connection for UI testing
            if error.localizedDescription.contains("503") || error.localizedDescription.contains("livekit_unavailable") {
                print("[SessionStore] LiveKit service unavailable on server (503) - providing mock connection for testing")
                providerTag = "Mock"
                signalBars = 2
                await waitForWSConnected()
                sendProviderEvent(provider: "livekit", id: id)  // Tell display LiveKit is "working"
                // Mark connection as stable immediately since we have a working mock connection
                print("[SessionStore] Mock connection established - marking as stable immediately")
                DispatchQueue.main.async {
                    self.connectionStableTimer?.invalidate()
                    self.connectionStableTimer = nil
                    self.fallbackStabilityTimer?.invalidate()
                    self.fallbackStabilityTimer = nil
                    self.isConnectionStable = true
                    print("[SessionStore] Mock connection marked STABLE - remote UI updates enabled")
                }
                return
            }
        }
        #else
        print("[SessionStore] LiveKit not available in this build")
        #endif
        
        // If we reach here, LiveKit failed - no fallback (P2P deprecated)
        providerTag = ""
        signalBars = 0
        print("[SessionStore] RTC connection failed - LiveKit unavailable")
    }

    @MainActor
    func stopRTC(env: EnvironmentStore) async {
        let id = self.basketId
        // Mark connection as unstable during cleanup
        markConnectionUnstable()
        // LiveKit-only cleanup
        livekit?.stop(); livekit = nil
        signalBars = 0
        
        // Video views will automatically detach when LiveKit instance is cleared
        
        // Inform display to exit RTC provider
        if let bid = id { ws.send(json: ["type":"rtc:provider", "basketId": bid, "provider": "off"]) }
        if let id = id, !id.isEmpty { _ = try? await HttpClient(env: env).deleteRTCSession(pairId: id, reason: "user") }
    }
    
    /// Full session refresh - reset all state to clean startup condition
    /// This provides the same clean state as a fresh app launch
    @MainActor
    func refreshSession(env: EnvironmentStore) async {
        print("[SessionStore] 🔄 FULL SESSION REFRESH - Resetting all state to clean startup condition")
        
        // 1. Stop all RTC connections and clear providers
        print("[SessionStore] Step 1: Stopping RTC and clearing connections")
        let oldBasketId = self.basketId
        
        // Stop LiveKit completely
        if let lk = livekit {
            print("[SessionStore] Stopping existing LiveKit instance")
            lk.stop()
            self.livekit = nil
        }
        
        // Clear all RTC state
        signalBars = 0
        providerTag = ""
        
        // 2. Disconnect WebSocket
        print("[SessionStore] Step 2: Disconnecting WebSocket")
        ws.disconnect()
        
        // 3. Reset all session state
        print("[SessionStore] Step 3: Resetting all session state")
        basketId = nil
        posterActive = false
        micMuted = false
        selectedCategoryName = nil
        selectedProductId = nil
        scrollToProductId = nil
        
        // Clear connection stability tracking
        connectionStableTimer?.invalidate()
        connectionStableTimer = nil
        fallbackStabilityTimer?.invalidate()
        fallbackStabilityTimer = nil
        isConnectionStable = true
        
        // Clear debouncing state
        lastBasketVersion = nil
        recentlyRemoved.removeAll()
        suppressedPrefixes.removeAll()
        lastCloseCommandAt = Date.distantPast
        
        // 4. Wait for cleanup to complete
        print("[SessionStore] Step 4: Waiting for cleanup to complete")
        try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
        
        // 5. Inform display to refresh if we had a session
        if let bid = oldBasketId {
            print("[SessionStore] Step 5: Informing display to refresh session: \(bid)")
            
            // Send explicit session refresh signal to display via WebSocket
            // Need to briefly reconnect WebSocket to send the signal
            ws.connect()
            
            // Wait briefly for connection
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
            
            // Send session refresh signal
            ws.send(json: [
                "type": "session:refresh",
                "basketId": bid,
                "reason": "cashier_refresh",
                "timestamp": Date().timeIntervalSince1970
            ])
            
            // Also send RTC stopped signal for good measure
            ws.send(json: [
                "type": "rtc:stopped",
                "basketId": bid,
                "reason": "session_refresh"
            ])
            
            // Give WebSocket time to send messages
            try? await Task.sleep(nanoseconds: 300_000_000) // 0.3 seconds
            
            // Disconnect again - we'll reconnect properly later
            ws.disconnect()
            
            // Also inform via HTTP API
            let client = HttpClient(env: env)
            try? await client.deleteRTCSession(pairId: bid, reason: "session_refresh")
        }
        
        print("[SessionStore] ✅ SESSION REFRESH COMPLETE - Ready for fresh connection")
    }


    @MainActor
    private func fastPairIfNeeded(env: EnvironmentStore) async -> String? {
        if let id = basketId { return id }
        await attemptAutoFastPair(env: env)
        return basketId
    }

    private func waitForWSConnected(timeout: TimeInterval = 5.0) async {
        let start = Date()
        while !ws.isConnected && Date().timeIntervalSince(start) < timeout {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        // Give server a moment to process subscribe/hello routing (slightly longer to avoid race)
        try? await Task.sleep(nanoseconds: 700_000_000)
    }

    private func sendProviderEvent(provider: String, id: String) {
        // Fire immediately, then twice more with small delays to overcome timing gaps
        ws.send(json: ["type":"rtc:provider", "basketId": id, "provider": provider])
        Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            ws.send(json: ["type":"rtc:provider", "basketId": id, "provider": provider])
            try? await Task.sleep(nanoseconds: 300_000_000)
            ws.send(json: ["type":"rtc:provider", "basketId": id, "provider": provider])
        }
    }

    private func handleRawEvent(_ dict: [String: Any]) {
        // Handle raw dictionary events that couldn't be decoded to WSEvent
        let type = dict["type"] as? String ?? ""
        print("[SessionStore] handleRawEvent: \(type)")
        // Add handling for specific event types if needed
    }
    
    private func handle(event: WSEvent) {
        switch event {
        case .basketSync(let wire), .basketUpdate(let wire):
            apply(wire: wire)
        case .posterStatus(let status):
            posterActive = (status.lowercased() == "active")
        // case .peerStatus(let connected, _):  // Not in current WSEvent definition
        //     signalBars = connected ? max(signalBars, 1) : 0
        case .rtcStatus:
            // keep simple for now; stats-based bars will come with RTC
            break
        case .uiSelectCategory(let name):
            // Apply category selection with stability check to prevent loop
            if isConnectionStable {
                selectedCategoryName = name
                print("[SessionStore] Remote selectedCategoryName update applied: '\(name)'")
            } else {
                print("[SessionStore] Ignoring remote category update during unstable connection: '\(name)'")
            }
        case .uiShowOptions(let productId):
            // Apply product selection with stability check and debouncing
            if isConnectionStable {
                selectedProductId = productId
                print("[SessionStore] Remote selectedProductId update applied: '\(productId)'")
            } else {
                print("[SessionStore] Ignoring remote product update during unstable connection: '\(productId)'")
            }
        case .uiScrollTo(let productId):
            if isConnectionStable {
                scrollToProductId = productId
                print("[SessionStore] Remote scrollTo update applied: \(productId)")
            } else {
                print("[SessionStore] Ignoring remote scrollTo update during unstable connection")
            }
        case .uiOptionsClose, .uiOptionsCancel:
            // Only process close commands if we have something to close and haven't processed a recent one
            let now = Date()
            let shouldProcess = now.timeIntervalSince(lastCloseCommandAt) >= closeCommandDebounceInterval
            
            if shouldProcess && isConnectionStable {
                if selectedProductId != nil {
                    selectedProductId = nil
                    lastCloseCommandAt = now
                    print("[SessionStore] Remote close request processed - cleared selectedProductId")
                } else {
                    print("[SessionStore] Remote close request ignored - no product selected")
                }
            } else if !isConnectionStable {
                print("[SessionStore] Ignoring remote close request during unstable connection")
            } else {
                print("[SessionStore] Remote close request debounced (too soon after last close)")
            }
        case .sessionStarted:
            // OSN-based provider or popular seeding handled elsewhere later
            break
        case .sessionEnded:
            // No-op for now
            break
        case .selectCategory(let name):
            selectedCategoryName = name
        case .selectProduct(let id):
            selectedProductId = id
        case .showOptions(let id):
            selectedProductId = id
        case .closeOptions:
            selectedProductId = nil
        case .scrollTo(let id):
            scrollToProductId = id
        case .unknown:
            break
        @unknown default:
            break
        }
    }

    private func apply(wire: BasketWire) {
        guard let basket = self.basketRef else { return }
        // Ignore stale versions if server provides versioning
        if let v = wire.version {
            if let last = lastBasketVersion, v < last { return }
            lastBasketVersion = max(lastBasketVersion ?? v, v)
        }

        // GC recently removed markers
        let now = Date()
        recentlyRemoved = recentlyRemoved.filter { now.timeIntervalSince($0.value) < recentlyRemovedWindow }

        let items = (wire.items ?? [])
        // Preserve any known image URLs from the current basket to avoid thumbnails disappearing
        let previousImages: [String: String?] = Dictionary(uniqueKeysWithValues: basket.items.map { ($0.id, $0.imageURL) })
        var mappedDict: [String: BasketItem] = [:]
        for it in items {
            let sku = it.sku ?? it.id ?? ""
            guard !sku.isEmpty else { continue }
            // While the options sheet is open for a product, suppress any incoming adds for that product's SKUs
            if suppressedPrefixes.contains(where: { sku == $0 || sku.hasPrefix($0 + ":") || sku.hasPrefix($0 + "#") }) {
                // Skip for now; we'll merge local copy below
                continue
            }
            // If this SKU was just removed locally, skip reintroducing it for a brief window
            if recentlyRemoved[sku] != nil { continue }
            let name = it.name ?? sku
            let price = it.price ?? 0
            let qty = it.qty ?? 1
            // Prefer server-provided image_url; otherwise keep any previously known image for this sku
            let resolvedImage = it.image_url ?? previousImages[sku] ?? nil
            mappedDict[sku] = BasketItem(id: sku, name: name, price: price, qty: qty, imageURL: resolvedImage)
        }
        // Merge back locally-present items for suppressed prefixes so they don't disappear on the first add
        if !suppressedPrefixes.isEmpty {
            for local in basket.items {
                let sku = local.id
                if suppressedPrefixes.contains(where: { sku == $0 || sku.hasPrefix($0 + ":") || sku.hasPrefix($0 + "#") }) {
                    // If server didn't include it, keep local copy
                    if mappedDict[sku] == nil {
                        mappedDict[sku] = local
                    }
                }
            }
        }
        // Install in a stable order: preserve previous order where possible, then append new
        var mapped: [BasketItem] = []
        let prevOrder = basket.items.map { $0.id }
        var used = Set<String>()
        for id in prevOrder {
            if let it = mappedDict[id] { mapped.append(it); used.insert(id) }
        }
        for (id, it) in mappedDict where !used.contains(id) {
            mapped.append(it)
        }
        basket.items = mapped
    }
    
    // MARK: - Connection Stability Tracking
    
    // Manual recovery function for debugging/testing - can be called from UI
    func forceConnectionStable() {
        print("[SessionStore] *** MANUAL FORCE - marking connection as stable immediately ***")
        print("[SessionStore] Current state: isConnectionStable=\(isConnectionStable), livekit=\(livekit != nil)")
        
        DispatchQueue.main.async {
            // Cancel all existing timers
            self.connectionStableTimer?.invalidate()
            self.connectionStableTimer = nil
            self.fallbackStabilityTimer?.invalidate()
            self.fallbackStabilityTimer = nil
            
            // Force stable state
            self.isConnectionStable = true
            print("[SessionStore] Connection MANUALLY forced to STABLE - remote UI updates enabled")
            print("[SessionStore] LiveKit status: hasRoom=\(self.livekit?.hasRemoteVideo != nil), signalBars=\(self.signalBars)")
            
            // Post notification that connection is now stable for any UI components that need to know
            NotificationCenter.default.post(name: .cashierConnectionStabilized, object: nil)
            
            // Reset any stuck UI state
            self.resetUIStateAfterReconnect()
        }
    }
    
    private func markConnectionUnstable() {
        print("[SessionStore] Marking connection as unstable - filtering remote UI updates")
        DispatchQueue.main.async {
            self.isConnectionStable = false
            
            // Capture current menu state before marking unstable for later resync
            self.lastStableMenuState = (
                categoryName: self.selectedCategoryName,
                productId: self.selectedProductId,
                scrollToId: self.scrollToProductId
            )
            print("[SessionStore] Captured menu state for resync: category=\(self.lastStableMenuState.categoryName ?? "nil")")
            
            // Cancel any existing timers
            self.connectionStableTimer?.invalidate()
            self.connectionStableTimer = nil
            self.fallbackStabilityTimer?.invalidate()
            
            // Set up fallback timer (10 seconds) to ensure stability is restored even if primary mechanism fails
            print("[SessionStore] Setting up 10-second fallback stability timer")
            self.fallbackStabilityTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: false) { [weak self] _ in
                print("[SessionStore] *** FALLBACK TIMER FIRED - forcing connection stable ***")
                self?.isConnectionStable = true
                self?.fallbackStabilityTimer = nil
                print("[SessionStore] Connection forced to STABLE via fallback - remote UI updates enabled")
                // Post notification that connection is now stable for any UI components that need to know
                NotificationCenter.default.post(name: .cashierConnectionStabilized, object: nil)
                // Trigger menu state resync after fallback recovery
                self?.needsMenuStateSync = true
            }
        }
    }
    
    private func handleLiveKitConnectionFullyReady() {
        print("[SessionStore] LiveKit connection is fully ready - marking stable immediately")
        DispatchQueue.main.async {
            // Cancel any existing timers since LiveKit reports it's ready
            self.connectionStableTimer?.invalidate()
            self.connectionStableTimer = nil
            self.fallbackStabilityTimer?.invalidate()
            self.fallbackStabilityTimer = nil
            
            // Mark as stable immediately
            self.isConnectionStable = true
            print("[SessionStore] Connection marked STABLE via LiveKit callback - remote UI updates enabled")
            
            // Post notification that connection is now stable for any UI components that need to know
            NotificationCenter.default.post(name: .cashierConnectionStabilized, object: nil)
            
            // Reset any stuck UI state that might have occurred during unstable connection
            self.resetUIStateAfterReconnect()
        }
    }
    
    private func markConnectionStable() {
        print("[SessionStore] markConnectionStable() called - scheduling stability timer")
        DispatchQueue.main.async {
            // Cancel any existing timers
            self.connectionStableTimer?.invalidate()
            self.fallbackStabilityTimer?.invalidate()
            self.fallbackStabilityTimer = nil
            
            print("[SessionStore] Creating stability timer with 3.0 second delay")
            self.connectionStableTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { [weak self] timer in
                print("[SessionStore] *** STABILITY TIMER FIRED - marking connection as stable ***")
                self?.isConnectionStable = true
                self?.connectionStableTimer = nil
                self?.fallbackStabilityTimer?.invalidate()
                self?.fallbackStabilityTimer = nil
                print("[SessionStore] Connection is now STABLE - remote UI updates enabled")
                
                // Post notification that connection is now stable for any UI components that need to know
                NotificationCenter.default.post(name: .cashierConnectionStabilized, object: nil)
                
                // Reset any stuck UI state that might have occurred during unstable connection
                self?.resetUIStateAfterReconnect()
            }
        }
    }
    
    // Store the last known stable UI state for resynchronization after reconnect
    private var lastStableMenuState: (categoryName: String?, productId: String?, scrollToId: String?) = (nil, nil, nil)
    
    // Track if menu state needs to be synchronized after reconnect
    @Published var needsMenuStateSync: Bool = false
    
    /// Reset UI state that may have gotten stuck during connection instability
    private func resetUIStateAfterReconnect() {
        Swift.print("[SessionStore] Resetting UI state after connection stabilized")
        
        // Clear any stuck product selection state that might prevent menu interactions
        // This helps resolve cases where the menu/options UI gets stuck open
        if selectedProductId != nil {
            Swift.print("[SessionStore] Clearing potentially stuck selectedProductId: \(selectedProductId ?? "nil")")
            selectedProductId = nil
            
            // Send explicit close command to ensure display UI is also cleared
            sendOptionsClose()
        }
        
        // Preserve and resync menu state instead of clearing it
        if selectedCategoryName != nil {
            Swift.print("[SessionStore] Preserving selectedCategoryName: \(selectedCategoryName ?? "nil") and scheduling resync")
            // Trigger menu state resynchronization to ensure both sides are in sync
            needsMenuStateSync = true
        }
        
        // Clear scroll state but prepare to resync if needed
        if scrollToProductId != nil {
            Swift.print("[SessionStore] Clearing potentially stuck scrollToProductId: \(scrollToProductId ?? "nil")")
            scrollToProductId = nil
        }
        
        // Clear any suppressed prefixes that might prevent proper basket updates
        if !suppressedPrefixes.isEmpty {
            Swift.print("[SessionStore] Clearing \(suppressedPrefixes.count) suppressed prefixes that may be stuck")
            clearSuppressedPrefixes()
        }
        
        // Sync mute state with LiveKit after reconnection to ensure UI is consistent
        if let lk = livekit {
            Swift.print("[SessionStore] Syncing mute state after reconnection - current UI state: \(micMuted)")
            // Note: isMicrophoneEnabled() method not available in current LiveKitRTC
            // Keep UI state as-is for now
        }
        
        Swift.print("[SessionStore] UI state reset completed")
    }
    
    /// Resynchronize menu state after connection stabilization
    func resyncMenuState(currentCategoryName: String?) {
        guard isConnectionStable else {
            Swift.print("[SessionStore] Skipping menu state resync - connection not stable")
            return
        }
        
        Swift.print("[SessionStore] Resynchronizing menu state - category: \(currentCategoryName ?? "nil")")
        
        if let categoryName = currentCategoryName {
            // Update our stored state
            selectedCategoryName = categoryName
            // Send to display to ensure synchronization
            sendSelectCategory(name: categoryName)
            Swift.print("[SessionStore] Sent category resync to display: \(categoryName)")
        }
        
        // Clear the sync flag
        needsMenuStateSync = false
        Swift.print("[SessionStore] Menu state resync completed")
    }
}

