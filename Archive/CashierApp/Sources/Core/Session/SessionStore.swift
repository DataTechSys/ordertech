import Foundation
import Combine

@MainActor
final class SessionStore: ObservableObject {
    @Published var basketId: String? = nil
    @Published var providerTag: String = "P2P" // P2P | Live | Twilio
    @Published var signalBars: Int = 0 // 0...3
    @Published var posterActive: Bool = false
    @Published var micMuted: Bool = false

    private(set) var ws = WebSocketManager()
    private var bag = Set<AnyCancellable>()
    private weak var basketRef: BasketStore?
    private var livekitStarting: Bool = false

    // Track WS basket versions and debounce re-introducing just-removed items
    private var lastBasketVersion: Int? = nil
    private var recentlyRemoved: [String: Date] = [:]
    private let recentlyRemovedWindow: TimeInterval = 0.8

    // Suppress mapping of basket items with these SKU prefixes (used while options sheet is open)
    private var suppressedPrefixes: [String] = []

    // RTC provider instance
    private var p2p: P2PRTC?
    private var livekit: LiveKitRTC?
    #if canImport(WebRTC)
    @Published var webRTCService = WebRTCService()
    private var p2pFallbackTask: Task<Void, Never>? = nil
    #endif

    #if canImport(LiveKit)
    var currentLiveKit: LiveKitRTC? { livekit }
    #endif

    // Future: peersConnected, shouldConnect, overlay state, etc.

    func attach(basket: BasketStore) {
        self.basketRef = basket
        // Subscribe once to WS stream
        ws.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] ev in self?.handle(event: ev) }
            .store(in: &bag)
        ws.$isConnected
            .receive(on: DispatchQueue.main)
            .removeDuplicates()
            .sink { [weak self] connected in
                guard let self = self, connected, let id = self.basketId else { return }
                self.ws.sendSubscribe(basketId: id)
                self.ws.sendHello(basketId: id, role: "cashier", name: "Cashier iPad")
            }
            .store(in: &bag)
    }

    func connectIfNeeded(env: EnvironmentStore, basketId: String) {
        self.basketId = basketId
        ws.connect(baseURL: env.baseURL)
    }

    // Start a session with a specific display (pairId) and connect WS/RTC
    @MainActor
    func startSessionWithPairId(env: EnvironmentStore, pairId: String) async {
        self.basketId = pairId
        let client = HttpClient(env: env)
        _ = try? await client.sessionStart(pairId: pairId)
        ws.connect(baseURL: env.baseURL)
        // Begin RTC according to backend config; non-fatal if fails
        #if canImport(WebRTC)
        await connectRTC(env: env, webRTCService: self.webRTCService)
        #else
        await connectRTC(env: env)
        #endif
    }

    func setBasket(id: String?) { basketId = id }

    // Temporary fast pair: choose first available display and start a session, then connect WS.
    @MainActor
    func attemptAutoFastPair(env: EnvironmentStore) async {
        // Respect activation requirement
        if env.requireActivation && env.deviceToken == nil {
            print("[SessionStore] AutoFastPair: activation required, deviceToken missing. Skipping.")
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
            guard let chosen = displays.first(where: { ($0.connected ?? false) == false }) ?? displays.first else {
                print("[SessionStore] AutoFastPair: no displays available.")
                return
            }
            self.basketId = chosen.id
            print("[SessionStore] AutoFastPair: chose display id=\(chosen.id)")
            // Start session first to align with web flow
            _ = try? await client.sessionStart(pairId: chosen.id)
            // Open WebSocket which will auto send subscribe/hello
            ws.connect(baseURL: env.baseURL)
        } catch {
            print("[SessionStore] AutoFastPair failed: \(error.localizedDescription)")
        }
    }

    func toggleMute() {
        micMuted.toggle()
        // Apply to provider(s)
        p2p?.setMicMuted(micMuted)
        livekit?.setMicMuted(micMuted)
    }

    // Control what incoming SKUs to suppress in basket mapping (e.g., while options sheet is open)
    func setSuppressedPrefixes(_ prefixes: [String]) { suppressedPrefixes = prefixes }
    func clearSuppressedPrefixes() { suppressedPrefixes = [] }

    // Outgoing basket ops
    func sendAdd(sku: String, name: String, price: Double) {
        guard let id = basketId else { return }
        ws.sendBasketUpdate(basketId: id, op: BasketOp(add: sku, name: name, price: price))
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
        ws.sendBasketUpdate(basketId: id, op: BasketOp(remove: sku))
    }
    func sendSetQty(sku: String, qty: Int) {
        guard let id = basketId else { return }
        ws.sendBasketUpdate(basketId: id, op: BasketOp(setQty: sku, qty: qty))
    }
    func sendSelectCategory(name: String) {
        guard let id = basketId else { return }
        ws.send(json: ["type":"ui:selectCategory", "basketId": id, "name": name])
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
            if posterActive { _ = try await client.posterStop(pairId: id) }
            else { _ = try await client.posterStart(pairId: id) }
            // Optimistic UI; normally poster:status WS event will confirm
            posterActive.toggle()
        } catch { /* non-fatal */ }
    }

    // MARK: - RTC integration
    // Connect using backend-driven RTC provider ordering
    #if canImport(WebRTC)
    func connectRTC(env: EnvironmentStore, webRTCService: WebRTCService?) async {
        await _connectRTC(env: env, useP2P: true, webRTCService: webRTCService)
    }
    #else
    func connectRTC(env: EnvironmentStore) async {
        await _connectRTC(env: env, useP2P: false, webRTCService: nil)
    }
    #endif

    private func _connectRTC(env: EnvironmentStore, useP2P: Bool, webRTCService: Any?) async {
        print("[SessionStore] connectRTC called. basketId=\(basketId ?? "nil")")
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
        let order = computeProviderOrder(cfg)
        print("[SessionStore] RTC order=\(order)")
        for p in order {
            switch p.lowercased() {
            case "p2p":
                #if canImport(WebRTC)
                guard useP2P else { continue }
                providerTag = "P2P"
                let svc = (webRTCService as? WebRTCService) ?? self.webRTCService
                let p2p = P2PRTC(pairId: id, http: client, onBars: { [weak self] b in self?.signalBars = b }, webRTCService: svc)
                self.p2p = p2p
                do {
                    try await p2p.start()
                    self.signalBars = max(self.signalBars, p2p.signalBars)
                    ws.send(json: ["type":"rtc:provider", "basketId": id, "provider": "p2p"]) 
                    print("[SessionStore] P2P started. bars=\(self.signalBars)")
                    scheduleP2PFallbackIfRemotePending(pairId: id, http: client)
                    return
                } catch {
                    print("[SessionStore] P2P start failed: \(error.localizedDescription)")
                    self.p2p = nil
                }
                #else
                continue
                #endif
            case "livekit", "live":
                #if canImport(LiveKit)
                providerTag = "Live"
                if self.livekit != nil { print("[SessionStore] LiveKit already initialized; reusing instance.") }
                let lk = self.livekit ?? LiveKitRTC(pairId: id, http: client)
                self.livekit = lk
                ws.send(json: ["type":"rtc:provider", "basketId": id, "provider": "livekit"]) 
                do {
                    try await lk.start()
                    self.signalBars = max(self.signalBars, lk.signalBars)
                    print("[SessionStore] LiveKit started. bars=\(self.signalBars)")
                    return
                } catch {
                    print("[SessionStore] LiveKit start failed: \(error.localizedDescription)")
                    self.livekit = nil
                }
                #else
                continue
                #endif
            case "twilio":
                providerTag = "Twilio"
                self.signalBars = max(self.signalBars, 2)
                print("[SessionStore] Twilio (stub) marked connected.")
                ws.send(json: ["type":"rtc:provider", "basketId": id, "provider": "twilio"]) 
                return
            default:
                continue
            }
        }
        providerTag = ""
        signalBars = 0
    }

    @MainActor
    func stopRTC(env: EnvironmentStore) async {
        let id = self.basketId
        #if canImport(WebRTC)
        p2pFallbackTask?.cancel(); p2pFallbackTask = nil
        #endif
        p2p?.stop(); p2p = nil
        livekit?.stop(); livekit = nil
        signalBars = 0
        // Inform display to exit RTC provider
        if let bid = id { ws.send(json: ["type":"rtc:provider", "basketId": bid, "provider": "off"]) }
        if let id = id, !id.isEmpty { _ = try? await HttpClient(env: env).deleteRTCSession(pairId: id, reason: "user") }
    }

    #if canImport(WebRTC)
    private func scheduleP2PFallbackIfRemotePending(pairId: String, http: HttpClient) {
        // Cancel any previous task
        p2pFallbackTask?.cancel()
        // Only schedule if LiveKit is available in the build
        #if canImport(LiveKit)
        p2pFallbackTask = Task { [weak self] in
            guard let self = self else { return }
            // Wait 10 seconds to allow ICE to complete
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            // If session changed or provider already switched, give up
            guard self.providerTag == "P2P", self.basketId == pairId else { return }
            // If remote video still not attached, fallback to LiveKit
            if self.webRTCService.remoteVideoTrack == nil {
                print("[SessionStore] P2P remote pending after timeout. Falling back to LiveKit…")
                await MainActor.run {
                    self.p2p?.stop(); self.p2p = nil
                }
                #if canImport(LiveKit)
                let lk = self.livekit ?? LiveKitRTC(pairId: pairId, http: http)
                self.livekit = lk
                self.providerTag = "Live"
                self.ws.send(json: ["type":"rtc:provider", "basketId": pairId, "provider": "livekit"]) 
                do {
                    try await lk.start()
                    self.signalBars = max(self.signalBars, lk.signalBars)
                    print("[SessionStore] Fallback to LiveKit started. bars=\(self.signalBars)")
                } catch {
                    print("[SessionStore] Fallback to LiveKit failed: \(error.localizedDescription)")
                }
                #endif
            }
        }
        #endif
    }
    #endif

    private func computeProviderOrder(_ cfg: RTCConfig?) -> [String] {
        // Default order
        var defaults = ["p2p", "livekit", "twilio"]
        guard let sfu = cfg?.sfu else { return defaults }
        var out: [String] = []
        if let d = sfu.defaultProvider, !d.isEmpty {
            out.append(d.lowercased())
        }
        if let fb = sfu.fallbackOrder {
            out.append(contentsOf: fb.map { $0.lowercased() })
        }
        // Deduplicate preserving order
        var seen = Set<String>()
        out = out.filter { if seen.contains($0) { return false } else { seen.insert($0); return true } }
        // Append any missing from defaults
        for p in defaults where !seen.contains(p) { out.append(p) }
        return out
    }

    @MainActor
    func stopP2P(env: EnvironmentStore) async {
        let id = self.basketId
        p2p?.stop(); p2p = nil
        livekit?.stop(); livekit = nil
        signalBars = 0
        // Tell display to exit RTC provider if possible
        if let bid = id { ws.send(json: ["type":"rtc:provider", "basketId": bid, "provider": "off"]) }
        if let id = id, !id.isEmpty { _ = try? await HttpClient(env: env).deleteRTCSession(pairId: id, reason: "user") }
    }

    @MainActor
    private func fastPairIfNeeded(env: EnvironmentStore) async -> String? {
        if let id = basketId { return id }
        await attemptAutoFastPair(env: env)
        return basketId
    }

    private func handle(event: WSEvent) {
        switch event {
        case .basketSync(let wire), .basketUpdate(let wire):
            apply(wire: wire)
        case .posterStatus(let active):
            posterActive = active
        case .peerStatus(let connected, _):
            signalBars = connected ? max(signalBars, 1) : 0
        case .rtcStatus:
            // keep simple for now; stats-based bars will come with RTC
            break
        case .sessionStarted:
            // OSN-based provider or popular seeding handled elsewhere later
            break
        case .sessionEnded:
            // No-op for now
            break
        case .error:
            break
        case .unknown:
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
        var mapped: [BasketItem] = []
        for it in items {
            let sku = it.sku ?? it.id ?? ""
            guard !sku.isEmpty else { continue }
            // While the options sheet is open for a product, suppress any incoming adds for that product's SKUs
            if suppressedPrefixes.contains(where: { sku == $0 || sku.hasPrefix($0 + ":") || sku.hasPrefix($0 + "#") }) { continue }
            // If this SKU was just removed locally, skip reintroducing it for a brief window
            if recentlyRemoved[sku] != nil { continue }
            let name = it.name ?? sku
            let price = it.price ?? 0
            let qty = it.qty ?? 1
            // Prefer server-provided image_url; otherwise keep any previously known image for this sku
            let resolvedImage = it.image_url ?? previousImages[sku] ?? nil
            mapped.append(BasketItem(id: sku, name: name, price: price, qty: qty, imageURL: resolvedImage))
        }
        basket.items = mapped
    }
}

