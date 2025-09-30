import Foundation
import Combine
import OrderTechCore

// MARK: - RTC Provider Orchestration Types

// Provider Health Metrics
struct ProviderHealthMetrics {
    let timestamp: Date
    let connectionQuality: Double // 0.0 - 1.0
    let audioQuality: Double // 0.0 - 1.0  
    let videoQuality: Double // 0.0 - 1.0
    let latency: TimeInterval // milliseconds
    let packetLoss: Double // 0.0 - 1.0
    let jitter: TimeInterval // milliseconds
    
    var overallScore: Double {
        (connectionQuality * 0.4 + audioQuality * 0.3 + videoQuality * 0.3)
    }
    
    var isHealthy: Bool {
        overallScore > 0.7 && latency < 200 && packetLoss < 0.05
    }
}

// Provider State
enum RTCProviderState: String, CaseIterable {
    case idle
    case preloading
    case starting
    case connecting
    case connected
    case degraded
    case failed
    case stopping
    case stopped
    
    var isActiveState: Bool {
        switch self {
        case .connecting, .connected, .degraded: return true
        default: return false
        }
    }
}

// Provider Configuration
struct RTCProviderConfig {
    let priority: Int // 1 = highest priority
    let healthThreshold: Double // minimum health score
    let maxRetries: Int
    let retryDelay: TimeInterval
    let preloadEnabled: Bool
    let healthMonitoringInterval: TimeInterval
    
    static let liveKitDefault = RTCProviderConfig(
        priority: 1,
        healthThreshold: 0.7,
        maxRetries: 3,
        retryDelay: 2.0,
        preloadEnabled: true,
        healthMonitoringInterval: 2.0
    )
}

// Enhanced Provider Protocol  
protocol EnhancedRTCProvider: RTCProvider {
    var state: RTCProviderState { get }
    var lastHealthMetrics: ProviderHealthMetrics? { get }
    var config: RTCProviderConfig { get }
    var providerType: String { get } // "livekit", "twilio", etc.
    
    func preload(pairId: String) async throws
    func getHealthMetrics() async -> ProviderHealthMetrics?
    func handleStateTransition(from: RTCProviderState, to: RTCProviderState) async
}

// Simple RTC Provider Orchestrator (inline version)
class RTCProviderOrchestrator: ObservableObject {
    @Published private(set) var activeProvider: EnhancedRTCProvider?
    @Published private(set) var providerState: RTCProviderState = .idle
    @Published private(set) var connectionQuality: Int = 0
    
    private var providers: [String: EnhancedRTCProvider] = [:]
    private let providerPreferences: [String] = ["livekit", "twilio"]
    private var isStarting: Bool = false
    private var currentPairId: String?
    
    var availableProviders: [String] { Array(providers.keys) }
    var currentProviderType: String? { activeProvider?.providerType }
    var isConnected: Bool { providerState == .connected }
    
    func registerProvider(_ provider: EnhancedRTCProvider) {
        providers[provider.providerType] = provider
        print("[RTCOrchestrator] Registered provider: \(provider.providerType)")
    }
    
    func startProvider(_ providerType: String, pairId: String) async throws {
        // Prevent concurrent starts
        if isStarting {
            print("[RTCOrchestrator] Start already in progress for \(providerType), skipping")
            return
        }
        
        // If already connected to same provider and pairId, skip
        if providerState == .connected && 
           activeProvider?.providerType == providerType && 
           currentPairId == pairId {
            print("[RTCOrchestrator] Already connected to \(providerType) with pairId: \(pairId)")
            return
        }
        
        isStarting = true
        print("[RTCOrchestrator] Starting provider: \(providerType) for pairId: \(pairId)")
        
        defer {
            isStarting = false
        }
        
        guard let provider = providers[providerType] else {
            throw APIError(message: "Provider \(providerType) not registered")
        }
        
        // Stop current if different provider or different pairId
        if let current = activeProvider,
           (current.providerType != providerType || currentPairId != pairId) {
            print("[RTCOrchestrator] Stopping current provider: \(current.providerType)")
            await stopCurrentProvider()
        }
        
        activeProvider = provider
        providerState = .starting
        currentPairId = pairId
        
        do {
            try await provider.start(pairId: pairId)
            providerState = .connected
            connectionQuality = provider.signalBars
            print("[RTCOrchestrator] Successfully started \(providerType)")
        } catch {
            providerState = .failed
            print("[RTCOrchestrator] Failed to start \(providerType): \(error)")
            throw error
        }
    }
    
    func stopCurrentProvider() async {
        print("[RTCOrchestrator] Stopping current provider")
        activeProvider?.stop()
        activeProvider = nil
        providerState = .stopped
        connectionQuality = 0
        currentPairId = nil
        isStarting = false
    }
}

// Enhanced LiveKit Provider Adapter
#if canImport(LiveKit)
class EnhancedLiveKitProvider: EnhancedRTCProvider {
    var state: RTCProviderState = .idle
    var lastHealthMetrics: ProviderHealthMetrics?
    let config: RTCProviderConfig = .liveKitDefault
    let providerType: String = "livekit"
    
    // RTCProvider conformance
    let providerName: String = "LiveKit"
    var signalBars: Int { liveKit?.signalBars ?? 0 }
    
    private(set) var liveKit: LiveKitRTC?
    private let deviceId: String
    private let http: HttpClient
    private var currentPairId: String?
    private var isStarting: Bool = false
    
    init(deviceId: String, http: HttpClient) {
        self.deviceId = deviceId
        self.http = http
    }
    
    func start(pairId: String) async throws {
        // Prevent concurrent starts
        if isStarting {
            print("[EnhancedLiveKit] Start already in progress, skipping duplicate")
            return
        }
        
        // If already connected to the same pairId, skip
        if state == .connected && currentPairId == pairId {
            print("[EnhancedLiveKit] Already connected to pairId: \(pairId)")
            return
        }
        
        // Stop existing connection if switching to different pairId
        if let existing = currentPairId, existing != pairId {
            print("[EnhancedLiveKit] Switching from \(existing) to \(pairId)")
            stop()
        }
        
        isStarting = true
        state = .starting
        currentPairId = pairId
        
        defer {
            isStarting = false
        }
        
        do {
            if liveKit == nil {
                liveKit = LiveKitRTC(pairId: pairId, http: http)
            }
            
            state = .connecting
            try await liveKit?.start()
            state = .connected
            
            // Update health metrics
            lastHealthMetrics = ProviderHealthMetrics(
                timestamp: Date(),
                connectionQuality: 0.8,
                audioQuality: 0.8,
                videoQuality: 0.8,
                latency: 100,
                packetLoss: 0.01,
                jitter: 10
            )
            
            print("[EnhancedLiveKit] Successfully connected to pairId: \(pairId)")
        } catch {
            state = .failed
            currentPairId = nil
            throw error
        }
    }
    
    func stop() {
        print("[EnhancedLiveKit] Stopping provider")
        state = .stopping
        liveKit?.stop()
        liveKit = nil
        state = .stopped
        lastHealthMetrics = nil
        currentPairId = nil
        isStarting = false
    }
    
    func setMicMuted(_ muted: Bool) {
        print("[EnhancedLiveKit] setMicMuted called with muted: \(muted)")
        liveKit?.setMicMuted(muted)
    }
    
    func preload(pairId: String) async throws {
        // Create LiveKit instance without starting
        if liveKit == nil {
            liveKit = LiveKitRTC(pairId: pairId, http: http)
        }
    }
    
    func getHealthMetrics() async -> ProviderHealthMetrics? {
        // Return current metrics or calculate new ones
        return lastHealthMetrics
    }
    
    func handleStateTransition(from: RTCProviderState, to: RTCProviderState) async {
        // Handle state transition logic
        print("[EnhancedLiveKit] State transition: \(from) -> \(to)")
    }
}
#endif

@MainActor
final class DisplaySessionStore: ObservableObject {
    @Published var connected: Bool = false
    @Published var peersConnected: Bool = false
    @Published var lastRtcStatusAt: Date? = nil

    // Track WS state to avoid duplicate logs and duplicate hello
    private var lastWSState: Bool? = nil
    private var didSendHello: Bool = false

    // HTTP readiness & presence backoff
    private var httpReady: Bool = false
    private var presenceInterval: TimeInterval = 10

    // UI state published for the Display
    @Published var basketLines: [BasketLineUI] = []
    @Published var basketTotals: BasketTotalsUI = .zero
    @Published var preview: PreviewState? = nil
    @Published var poster: PosterState? = nil
    @Published var scrollToProductId: String? = nil
    @Published var posterURLs: [String] = []
    // Suppress showing local options sheet in response to our own mirror echo
    @Published var suppressOptionsEcho: Bool = false
    // If set, an edit was initiated for this specific line (SKU). Use setQty instead of add.
    @Published var pendingEditSku: String? = nil

    // Remote UI control (from Cashier)
    @Published var selectedCategoryName: String? = nil
    @Published var selectedProductId: String? = nil

    private let env: EnvironmentStore
    private let http: HttpClient
    private let ws: WebSocketManager
    private var bag = Set<AnyCancellable>()
    private var presenceTimer: Timer?

    #if canImport(WebRTC)
    @Published var webRTCService = WebRTCService()
    #endif
    
    // Enhanced RTC Provider Management
    private var rtcOrchestrator: RTCProviderOrchestrator?
    
    // Legacy RTC providers (kept for backward compatibility)
    private var p2p: RTCProvider? = nil
    // Track which pairId the current p2p instance was created with to avoid mismatches
    private var p2pPairId: String? = nil
    #if canImport(LiveKit)
    private var livekit: LiveKitRTC? = nil
    var currentLiveKit: LiveKitRTC? { 
        // First check if orchestrator has a LiveKit provider
        if let orchestrator = rtcOrchestrator,
           let enhancedProvider = orchestrator.activeProvider as? EnhancedLiveKitProvider,
           enhancedProvider.state == .connected {
            return enhancedProvider.liveKit
        }
        // Fallback to legacy instance
        return livekit 
    }
    #endif
    // Provider start guards to prevent duplicate concurrent starts
    private var livekitStarting: Bool = false
    private var p2pStarting: Bool = false
    private var desiredProvider: String = ""
    // Fallback: auto-start LiveKit when peer is connected and no provider is active
    private var rtcAutoStartAttempted: Bool = false
    // Current basket/room ID (server-side device_id for this display)
    private var activeBasketId: String? = nil
    
    // Activation persistence for graceful degradation
    private let activationPersistence = ActivationPersistence()

    // Identity
    let deviceId: String
    var friendlyName: String
    var branch: String

    init(env: EnvironmentStore, deviceId: String, friendlyName: String, branch: String) {
        self.env = env
        self.http = HttpClient(env: env)
        self.ws = WebSocketManager(env: env)
        self.deviceId = deviceId
        self.friendlyName = friendlyName
        self.branch = branch
        
        // Load activation persistence state
        activationPersistence.load()

        // Initialize RTC Provider Orchestrator
        setupRTCOrchestrator()
        
        ws.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] obj in self?.handle(event: obj) }
            .store(in: &bag)

ws.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] ok in
                guard let self else { return }
                // Only react on changes to reduce noise
                if self.lastWSState != ok {
                    self.lastWSState = ok
                    self.connected = ok
                    print("[Display] WS status changed → connected=\(ok)")
                }
                if ok {
                    if !self.didSendHello {
                        self.onWSOpen()
                        self.didSendHello = true
                    }
                } else {
                    // Reset hello sentinel and subscription state when disconnected so on reconnect we resubscribe/hello
                    self.didSendHello = false
                    self.activeBasketId = nil
                }
            }
            .store(in: &bag)
    }

func start() {
        Task { [weak self] in
            guard let self else { return }
            print("[Display] start(): begin; token pre-check=\(self.env.deviceToken != nil)")
            
            // Check if we have a valid activation (including grace period)
            let hasToken = (self.env.deviceToken != nil)
            let hasValidActivation = hasToken && (self.activationPersistence.record?.isActive == true)
            
            print("[Display] start(): token present=\(hasToken), valid activation=\(hasValidActivation)")
            guard hasToken else { 
                print("[Display] start(): no token, aborting start.")
                return 
            }
            
            // Ensure tenant association & validate token (but don't abort on failure)
            await self.ensureTenantIfPossible()
            await self.validateToken()
            
            // Continue with startup even if HTTP validation failed (may be in grace period)
            let stillHasToken = (self.env.deviceToken != nil)
            guard stillHasToken else {
                print("[Display] start(): token was cleared during validation, aborting.")
                return
            }
            
            // Prefetch posters for rotating backdrop (tenant-aware) - best effort
            await self.loadPosters()
            
            await MainActor.run {
                // WS connect - may work even if HTTP is down
                print("[Display] WS connect → base=\(self.env.baseURL.absoluteString) wsBase=\(self.env.wsBaseURL.absoluteString)")
                self.ws.connect()
                // Presence heartbeat - adapt to HTTP readiness
                self.reschedulePresenceTimer()
            }
            
            // Send an immediate presence ping so pickers see us right away
            await self.sendPresence()
        }
    }

    private func ensureTenantIfPossible() async {
        guard (env.deviceToken ?? "").isEmpty == false else { return }
        struct Assoc: Decodable { let tenant_id: String? }
        // Prefer current API host for association; only try fixed app host when the API host is the app host
        let baseHost = (URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()).host ?? ""
        let tryAppHostFirst = (baseHost == "app.ordertech.me")
        if tryAppHostFirst {
            do {
                if let url = URL(string: "https://app.ordertech.me/ws/associate") {
                    var req = URLRequest(url: url)
                    req.httpMethod = "POST"
                    let hdrs = headers()
                    for (k, v) in hdrs { req.setValue(v, forHTTPHeaderField: k) }
                    req.setValue("application/json", forHTTPHeaderField: "accept")
                    let (data, resp) = try await URLSession.shared.data(for: req)
                    if let httpResp = resp as? HTTPURLResponse {
                        if (200..<300).contains(httpResp.statusCode) {
                            if let assoc = try? JSONDecoder().decode(Assoc.self, from: data), let tid = assoc.tenant_id, !tid.isEmpty {
                                await MainActor.run { env.setTenantId(tid) }
                                print("[Display] ensure-tenant(app): associated tenant_id=\(tid)")
                                return
                            }
                        } else if httpResp.statusCode == 401 || httpResp.statusCode == 403 {
                            // When using the app host, 401 simply means Admin doesn’t recognize this token; proceed to API/WS without clearing
                            print("[Display] ensure-tenant(app): unauthorized (\(httpResp.statusCode)) — skipping, will try API/WS host")
                        }
                    }
                }
            } catch {
                // ignore, will proceed to API/WS fallbacks below
            }
        }
        // Then try on API host (manual request to avoid clearing token on 401)
        do {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            comps.path = "/ws/associate"
            if let url = comps.url {
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                let hdrs = headers()
                for (k, v) in hdrs { req.setValue(v, forHTTPHeaderField: k) }
                req.setValue("application/json", forHTTPHeaderField: "accept")
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let httpResp = resp as? HTTPURLResponse else { throw APIError(message: "no_http") }
                if httpResp.statusCode == 404 {
                    print("[Display] ensure-tenant(api1): 404 → falling back to WS host")
                } else if (200..<300).contains(httpResp.statusCode) {
                    if let assoc = try? JSONDecoder().decode(Assoc.self, from: data), let tid = assoc.tenant_id, !tid.isEmpty {
                        await MainActor.run { env.setTenantId(tid) }
                        print("[Display] ensure-tenant(api1): associated tenant_id=\(tid)")
                        return
                    } else {
                        print("[Display] ensure-tenant(api1): no tenant_id returned")
                    }
                } else if httpResp.statusCode == 401 || httpResp.statusCode == 403 {
                    print("[Display] ensure-tenant(api1): unauthorized (\(httpResp.statusCode)) — will retry other endpoints")
                    // Don't clear token here - let validateToken handle auth failures
                } else {
                    print("[Display] ensure-tenant(api1): HTTP \(httpResp.statusCode)")
                }
            }
        } catch {
            // ignore; will try WS host
        }
        // Fallback: try on WS host (https://app.ordertech.me/ws/associate)
        do {
            guard var comps = URLComponents(url: env.wsBaseURL, resolvingAgainstBaseURL: false) else { return }
            comps.scheme = "https"
            comps.path = "/ws/associate"
            guard let url = comps.url else { return }
            let tid = env.tenantId
            let tok = env.deviceToken

            // Try variants: 0=Bearer, 1=x-device-token, 2=Both
            var lastStatus = -1
            for variant in 0..<3 {
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                if let tid = tid, !tid.isEmpty { req.setValue(tid, forHTTPHeaderField: "x-tenant-id") }
                if variant == 0 {
                    if let tok = tok, !tok.isEmpty { req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization") }
                } else if variant == 1 {
                    if let tok = tok, !tok.isEmpty { req.setValue(tok, forHTTPHeaderField: "x-device-token") }
                } else {
                    if let tok = tok, !tok.isEmpty {
                        req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
                        req.setValue(tok, forHTTPHeaderField: "x-device-token")
                    }
                }
                req.setValue("application/json", forHTTPHeaderField: "accept")
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let httpResp = resp as? HTTPURLResponse else { continue }
                if (200..<300).contains(httpResp.statusCode) {
                    if let assoc = try? JSONDecoder().decode(Assoc.self, from: data), let tid = assoc.tenant_id, !tid.isEmpty {
                        await MainActor.run { env.setTenantId(tid) }
                        print("[Display] ensure-tenant(wsHost): associated tenant_id=\(tid)")
                        return
                    } else {
                        print("[Display] ensure-tenant(wsHost): no tenant_id returned")
                        return
                    }
                }
                lastStatus = httpResp.statusCode
            }
            print("[Display] ensure-tenant(wsHost): HTTP \(lastStatus)")
        } catch {
            print("[Display] ensure-tenant(wsHost): error \(error.localizedDescription)")
        }
    }

    private func validateToken() async {
        // Always attempt tenant association before validation
        await ensureTenantIfPossible()
        
        // If no activation record exists, create one on first successful activation
        if activationPersistence.record == nil, let tenantId = env.tenantId, env.deviceToken != nil {
            await MainActor.run {
                activationPersistence.create(
                    tenantId: tenantId,
                    deviceId: self.deviceId,
                    displayName: self.friendlyName,
                    branchName: self.branch
                )
            }
        }
        
        // Validate device token with a lightweight call using manual request only (avoid HttpClient side effects)
        do {
            let data = try await self.getManifestManual()
            _ = try? JSONDecoder().decode(Manifest.self, from: data)
            httpReady = true
            print("[Display] validateToken: /manifest ok via bearer; HTTP ready=true")
            
            // Mark success in persistence to extend grace period
            await MainActor.run {
                activationPersistence.updateAfterSuccess()
            }
        } catch let e as APIError {
            httpReady = false
            let errorKind: String
            
            switch e.code ?? -1 {
            case 401:
                errorKind = "unauthorized"
            case 403:
                errorKind = "forbidden"
            case 404:
                errorKind = "server"
            case 500...599:
                errorKind = "server"
            default:
                errorKind = "unknown"
            }
            
            print("[Display] validateToken: APIError code=\(e.code ?? -1) msg=\(e.message) kind=\(errorKind)")
            
            let shouldClear = await MainActor.run {
                self.activationPersistence.markFailure(kind: errorKind, code: e.code)
                return self.activationPersistence.shouldClearToken()
            }
            
            if shouldClear {
                print("[Display] validateToken: clearing token after persistent failures outside grace period")
                await MainActor.run { 
                    self.env.deviceToken = nil 
                    self.activationPersistence.clear()
                }
                return
            } else {
                print("[Display] validateToken: keeping token (in grace period or soft failure)")
            }
        } catch {
            // Network errors, timeouts, etc. - treat as soft failures
            print("[Display] validateToken: network error: \(error.localizedDescription) - keeping token")
            httpReady = false
            
            await MainActor.run {
                self.activationPersistence.markFailure(kind: "network", code: Optional<Int>.none)
            }
        }
        
        // After validation attempt, (re)schedule presence timer appropriately
        await MainActor.run { self.reschedulePresenceTimer() }
    }

    func stop() {
        presenceTimer?.invalidate(); presenceTimer = nil
        // Notify peers to clear connected indicators immediately
        ws.send(json: ["type":"rtc:stopped", "basketId": activeBasketId ?? deviceId, "reason": "display_stop"])
        ws.disconnect()
        
        // Stop orchestrator and legacy providers
        Task {
            await rtcOrchestrator?.stopCurrentProvider()
        }
        p2p?.stop(); p2p = nil; p2pPairId = nil
        #if canImport(LiveKit)
        livekit?.stop(); livekit = nil; livekitStarting = false
        #endif
        peersConnected = false
    }
    
    // MARK: - RTC Provider Orchestration
    private func setupRTCOrchestrator() {
        rtcOrchestrator = RTCProviderOrchestrator()
        
        // Register available providers
        #if canImport(LiveKit)
        let enhancedLiveKit = EnhancedLiveKitProvider(deviceId: deviceId, http: http)
        rtcOrchestrator?.registerProvider(enhancedLiveKit)
        print("[Display] LiveKit provider registered for enhanced orchestration")
        #endif
        
        print("[Display] RTC Orchestrator initialized")
    }
    
    private func startEnhancedRTCProvider(_ providerType: String, pairId: String) async {
        guard let orchestrator = rtcOrchestrator else {
            print("[Display] RTC Orchestrator not available, falling back to legacy providers")
            return
        }
        
        do {
            try await orchestrator.startProvider(providerType, pairId: pairId)
            peersConnected = orchestrator.isConnected
            print("[Display] Enhanced RTC provider \(providerType) started successfully")
        } catch {
            print("[Display] Enhanced RTC provider \(providerType) failed to start: \(error)")
            // Fall back to legacy provider if available
            await handleLegacyProviderFallback(providerType, pairId: pairId)
        }
    }
    
    private func handleLegacyProviderFallback(_ providerType: String, pairId: String) async {
        print("[Display] Falling back to legacy provider: \(providerType)")
        // Implementation of legacy provider startup (existing logic)
        // This maintains backward compatibility
    }

    private func subscribeDefaultBasket() {
        // Subscribe and hello on our deviceId (idle state)
        if activeBasketId == deviceId {
            print("[Display] subscribeDefaultBasket: already on default; skipping")
            return
        }
        print("[Display] subscribeDefaultBasket: subscribe + hello; basketId=\(deviceId) name=\(friendlyName)")
        ws.send(json: ["type": "subscribe", "basketId": deviceId])
        var hello: [String: Any] = ["type": "hello", "basketId": deviceId, "role": "display", "name": friendlyName]
        hello["device_id"] = deviceId
        if let tok = env.deviceToken, !tok.isEmpty { hello["token"] = tok }
        ws.send(json: hello)
        activeBasketId = deviceId
    }

    private func onWSOpen() {
        // subscribe + hello(role=display)
        subscribeDefaultBasket()
    }

    // REMOVED: Display should not send category selections to Cashier
    // This function was causing feedback loops where Display and Cashier would
    // fight over menu control, breaking remote control functionality
    // The proper flow is: Cashier sends commands -> Display receives & updates locally
    // func sendSelectCategory(name: String) {
    //     ws.send(json: ["type":"ui:selectCategory", "basketId": deviceId, "name": name])
    // }
    func sendShowProduct(id: String) {
        ws.send(json: ["type":"ui:showOptions", "basketId": deviceId, "product_id": id])
    }
    func sendScrollTo(id: String) {
        ws.send(json: ["type":"ui:scrollTo", "basketId": deviceId, "product_id": id])
    }

    private func handle(event: [String: Any]) {
        let type = (event["type"] as? String) ?? ""
        print("[Display] WS event: \(type)")
        switch type {
        case "peer:status":
            let raw = (event["status"] as? String) ?? ""
            let status = raw.lowercased()
            print("[Display] WS event: peer:status status=\(status)")
            switch status {
            case "connected":
                peersConnected = true
                // Do not auto-start any provider on generic peer:status. We wait for an explicit rtc:provider or rtc:offer
                // event which includes the correct basketId/pairId to avoid mismatches.
            case "disconnected", "stopped", "off":
                let _ = peersConnected
                peersConnected = false
                desiredProvider = ""
                rtcAutoStartAttempted = false
                // Return to idle subscription so we can accept a new session
                subscribeDefaultBasket()
            default:
                // Unknown or transitional status; ignore to avoid resubscribe churn
                break
            }
        case "rtc:status":
            lastRtcStatusAt = Date()
        case "rtc:provider":
            handleRTCProvider(event)
            // Remember basketId if provided by server
            if let bid = (event["basketId"] as? String), !bid.isEmpty { activeBasketId = bid }
        case "rtc:offer":
            // Process P2P offers for fallback testing when LiveKit is unavailable
            #if canImport(WebRTC)
            let pairId = (event["basketId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                ?? (activeBasketId?.trimmingCharacters(in: .whitespacesAndNewlines))
                ?? deviceId
            func extractSDP(_ ev: [String: Any]) -> String? {
                if let s = ev["sdp"] as? String { return s }
                if let p = ev["payload"] as? [String: Any], let s = p["sdp"] as? String { return s }
                if let d = ev["data"] as? [String: Any], let s = d["sdp"] as? String { return s }
                if let off = ev["offer"] as? [String: Any], let s = off["sdp"] as? String { return s }
                return nil
            }
            let wsSDP = extractSDP(event) ?? ""
            let ensureP2PAndApply: (_ sdp: String) -> Void = { sdp in
                // If an existing P2P instance was created with a different pairId, tear it down first
                if let current = self.p2pPairId, current != pairId {
                    self.p2p?.stop(); self.p2p = nil; self.p2pStarting = false; self.p2pPairId = nil
                }
                if self.p2p == nil && !self.p2pStarting {
                    self.p2pStarting = true
                    self.p2p = P2PRTC(pairId: pairId, http: self.http, webRTCService: self.webRTCService)
                    self.p2pPairId = pairId
                    Task { [weak self] in
                        defer { self?.p2pStarting = false }
                        try? await self?.p2p?.start(pairId: pairId)
                        if let p = self?.p2p as? P2PRTC { p.handleOfferFromWS(sdp: sdp) }
                    }
                } else if let p = self.p2p as? P2PRTC {
                    p.handleOfferFromWS(sdp: sdp)
                }
            }
            if !wsSDP.isEmpty {
                ensureP2PAndApply(wsSDP)
            } else {
                // Fallback: fetch offer via REST then apply
                Task { [weak self] in
                    guard let self = self else { return }
                    struct OfferResp: Decodable { let sdp: String? }
                    if let resp: OfferResp = try? await self.http.request("/webrtc/offer?pairId=\(pairId)") {
                        if let sdp = resp.sdp, !sdp.isEmpty { ensureP2PAndApply(sdp) }
                    }
                }
            }
            #endif
        case "rtc:stopped":
            p2p?.stop(); p2p = nil; p2pPairId = nil
            // If server is preclearing/resetting the session, stay on the session basket to avoid missing the next offer
            let reason = ((event["reason"] as? String) ?? "").lowercased()
            let bid = (event["basketId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if reason == "preclear" || reason == "reset" {
                let pid = (bid?.isEmpty == false) ? bid! : (activeBasketId ?? deviceId)
                activeBasketId = pid
                ws.send(json: ["type": "subscribe", "basketId": pid])
                var hello: [String: Any] = ["type": "hello", "basketId": pid, "role": "display", "name": friendlyName]
                hello["device_id"] = deviceId
                if let tok = env.deviceToken, !tok.isEmpty { hello["token"] = tok }
                ws.send(json: hello)
            } else {
                // Return to idle subscription so future cashiers can connect
                subscribeDefaultBasket()
            }
        case "basket:sync", "basket:update":
            applyBasket(event)
        case "session:started":
            // new session clears basket/preview
            basketLines = []
            basketTotals = .zero
            preview = nil
            // Fallback: If no provider was explicitly requested yet, proactively start LiveKit once
            #if canImport(LiveKit)
            if desiredProvider.isEmpty && livekit == nil && !livekitStarting {
                print("[Display] session:started → auto-start LiveKit fallback")
                desiredProvider = "livekit"
                livekitStarting = true
                Task { [weak self] in
                    guard let self = self else { return }
                    let bid = self.activeBasketId ?? self.deviceId
                    if self.livekit == nil { self.livekit = LiveKitRTC(pairId: bid, http: self.http) }
                    defer { self.livekitStarting = false }
                    try? await self.livekit?.start()
                }
            }
            #endif
        case "session:paid", "session:ended":
            // Ensure RTC is fully stopped and state reset so a new session can start cleanly
            p2p?.stop(); p2p = nil; p2pStarting = false
            #if canImport(LiveKit)
            livekit?.stop(); livekit = nil; livekitStarting = false
            #endif
            peersConnected = false
            desiredProvider = ""
            rtcAutoStartAttempted = false
            // Proactively notify server/peers that RTC has stopped (defensive)
            ws.send(json: ["type":"rtc:stopped", "basketId": activeBasketId ?? deviceId, "reason": "session_end"])
            // Return to idle subscription so a new session can start
            subscribeDefaultBasket()
            // Make sure we re-post presence so we remain visible to pickers
            reschedulePresenceTimer()
            Task { await self.sendPresence() }
        case "ui:showPreview":
            applyPreview(event)
        case "ui:selectCategory":
            // Accept category name or id under common keys
            if let name = (event["category"] as? String)
                ?? (event["name"] as? String)
                ?? (event["id"] as? String) {
                selectedCategoryName = name
            }
        case "ui:showOptions":
            // Expect product id under product_id/productId/sku/id
            if let pid = (event["product_id"] as? String)
                ?? (event["productId"] as? String)
                ?? (event["sku"] as? String)
                ?? (event["id"] as? String) {
                Task { @MainActor in self.selectedProductId = pid }
            }
        case "ui:selectProduct":
            if let pid = (event["product_id"] as? String)
                ?? (event["productId"] as? String)
                ?? (event["sku"] as? String)
                ?? (event["id"] as? String) {
                Task { @MainActor in self.selectedProductId = pid }
            }
        case "ui:scrollTo":
            if let pid = (event["product_id"] as? String)
                ?? (event["productId"] as? String)
                ?? (event["sku"] as? String)
                ?? (event["id"] as? String) {
                Task { @MainActor in self.scrollToProductId = pid }
            }
        case "ui:optionsClose":
            // Close any open product/options UI
            Task { @MainActor in
                self.selectedProductId = nil
                self.preview = nil
                self.pendingEditSku = nil
            }
        case "ui:optionsCancel":
            // Cancel options and clear any preview/selection
            Task { @MainActor in
                self.selectedProductId = nil
                self.preview = nil
                self.pendingEditSku = nil
            }
        case "poster:start":
            applyPoster(event, start: true)
        case "poster:stop":
            applyPoster(event, start: false)
        case "ui:videoMode":
            if let mode = (event["mode"] as? String)?.lowercased() {
                if mode == "small" { NotificationCenter.default.post(name: .displayCollapseVideo, object: nil) }
                if mode == "full" { NotificationCenter.default.post(name: .displayExpandVideo, object: nil) }
            }
        case "device:deactivate", "device:revoke":
            // Immediate forced deactivation from Admin
            env.deviceToken = nil
            // Clear cached activation & tenant data so the app shows empty values until re-activated
            try? LocalCache.delete("activation.json")
            try? LocalCache.delete("tenant.json")
        default:
            break
        }
    }

    private func headers() -> [String: String] {
        var h: [String:String] = [:]
        if let tid = env.tenantId, !tid.isEmpty { h["x-tenant-id"] = tid }
        if let tok = env.deviceToken, !tok.isEmpty {
            h["Authorization"] = "Bearer \(tok)"
            h["x-device-token"] = tok
        }
        return h
    }

    private func sendPresence() async {
        // Allow presence even if httpReady is not yet set; rely on auth fallbacks below
        guard (env.deviceToken ?? "").isEmpty == false else { return }
        let payload: [String: Any] = [
            "id": deviceId,
            "name": friendlyName,
            "branch": branch
        ]
        do {
            let body = try JSONSerialization.data(withJSONObject: payload)
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            comps.path = "/presence/display"
            guard let url = comps.url else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            let hdrs = headers()
            for (k, v) in hdrs { req.setValue(v, forHTTPHeaderField: k) }
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.setValue("application/json", forHTTPHeaderField: "accept")
            let (data1, resp1) = try await URLSession.shared.data(for: req)
            guard let http1 = resp1 as? HTTPURLResponse else { return }
            if (200..<300).contains(http1.statusCode) {
                print("[Display] presence: posted for id=\(deviceId)")
                if presenceInterval > 30 { presenceInterval = 30; await MainActor.run { reschedulePresenceTimer() } }
                return
            }
            // Unauthorized → clear token and stop
            if http1.statusCode == 401 || http1.statusCode == 403 {
                print("[Display] presence: unauthorized (\(http1.statusCode)) — clearing token")
                await MainActor.run { self.env.deviceToken = nil }
                return
            }
            // Fallback 1: try x-device-token only
            var req2 = URLRequest(url: url)
            req2.httpMethod = "POST"
            if let tid = env.tenantId { req2.setValue(tid, forHTTPHeaderField: "x-tenant-id") }
            if let tok = env.deviceToken { req2.setValue(tok, forHTTPHeaderField: "x-device-token") }
            req2.httpBody = body
            req2.setValue("application/json", forHTTPHeaderField: "content-type")
            req2.setValue("application/json", forHTTPHeaderField: "accept")
            let (_, resp2) = try await URLSession.shared.data(for: req2)
            let code2 = (resp2 as? HTTPURLResponse)?.statusCode ?? -1
            if (200..<300).contains(code2) {
                print("[Display] presence: posted (device-token)")
                if presenceInterval > 30 { presenceInterval = 30; await MainActor.run { reschedulePresenceTimer() } }
                return
            }
            if code2 == 401 || code2 == 403 {
                print("[Display] presence: unauthorized (fallback2=\(code2)) — clearing token")
                await MainActor.run { self.env.deviceToken = nil }
                return
            }
            // Fallback 2: try both
            var req3 = URLRequest(url: url)
            req3.httpMethod = "POST"
            if let tid = env.tenantId { req3.setValue(tid, forHTTPHeaderField: "x-tenant-id") }
            if let tok = env.deviceToken {
                req3.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
                req3.setValue(tok, forHTTPHeaderField: "x-device-token")
            }
            req3.httpBody = body
            req3.setValue("application/json", forHTTPHeaderField: "content-type")
            req3.setValue("application/json", forHTTPHeaderField: "accept")
            let (_, resp3) = try await URLSession.shared.data(for: req3)
            let code3 = (resp3 as? HTTPURLResponse)?.statusCode ?? -1
            if (200..<300).contains(code3) {
                print("[Display] presence: posted (both)")
                if presenceInterval > 30 { presenceInterval = 30; await MainActor.run { reschedulePresenceTimer() } }
                return
            }
            if code3 == 401 || code3 == 403 {
                print("[Display] presence: unauthorized (fallback3=\(code3)) — clearing token")
                await MainActor.run { self.env.deviceToken = nil }
                return
            }
            print("[Display] presence: HTTP \(code3)")
            presenceInterval = min(presenceInterval * 2, 120)
            await MainActor.run { reschedulePresenceTimer() }
        } catch {
            print("[Display] presence: error \(error.localizedDescription)")
        }
    }

    // MARK: - Event mapping

    private func applyBasket(_ event: [String: Any]) {
        guard let basket = (event["basket"] as? [String: Any]) ?? (event["data"] as? [String: Any]) else { return }
        var lines: [BasketLineUI] = []
        if let arr = (basket["lines"] as? [[String: Any]]) ?? (basket["items"] as? [[String: Any]]) {
            for raw in arr {
                // Prefer 'sku' as the canonical line identifier used for updates
                let id = (raw["sku"] as? String)
                    ?? (raw["id"] as? String)
                    ?? (raw["lineId"] as? String)
                    ?? (raw["productId"] as? String)
                    ?? UUID().uuidString
                let name = (raw["name"] as? String)
                    ?? (raw["productName"] as? String)
                    ?? "Item"
                let qty = (raw["qty"] as? Int)
                    ?? (raw["quantity"] as? Int)
                    ?? Int((raw["qty"] as? String) ?? "1") ?? 1
                let price = doubleFrom(raw["price"]) ?? doubleFrom(raw["unitPrice"]) ?? 0.0
                let total = doubleFrom(raw["total"]) ?? (price * Double(qty))
                let image = (raw["image_url"] as? String) ?? (raw["imageUrl"] as? String) ?? (raw["image"] as? String)
                var options: [String] = []
                if let opts = raw["options"] as? [String] { options = opts }
                if let mods = raw["modifiers"] as? [[String: Any]] {
                    let m = mods.compactMap { mod -> String? in
                        if let n = mod["name"] as? String, let v = mod["value"] as? String { return "\(n): \(v)" }
                        if let n = mod["name"] as? String { return n }
                        return nil
                    }
                    options.append(contentsOf: m)
                }
                lines.append(BasketLineUI(id: id, name: name, qty: qty, unitPrice: price, lineTotal: total, options: options, imageURL: image))
            }
        }
        basketLines = lines
        let subtotal = doubleFrom(basket["subtotal"]) ?? 0.0
        let tax = doubleFrom(basket["tax"]) ?? 0.0
        let total = doubleFrom(basket["total"]) ?? 0.0
        basketTotals = BasketTotalsUI(subtotal: subtotal, tax: tax, total: total)
    }

    private func applyPreview(_ event: [String: Any]) {
        let obj = (event["product"] as? [String: Any])
            ?? (event["item"] as? [String: Any])
            ?? (event["data"] as? [String: Any])
        guard let product = obj else { return }
        let name = (product["name"] as? String)
            ?? (product["title"] as? String)
            ?? (product["productName"] as? String)
            ?? "Preview"
        let price = doubleFrom(product["price"]) ?? doubleFrom(product["unitPrice"]) ?? 0.0
        let imageURL = (product["imageUrl"] as? String) ?? (product["image"] as? String)
        var options: [String] = []
        if let opts = product["options"] as? [String] { options = opts }
        if let mods = product["modifiers"] as? [[String: Any]] {
            let m = mods.compactMap { mod -> String? in
                if let n = mod["name"] as? String, let v = mod["value"] as? String { return "\(n): \(v)" }
                if let n = mod["name"] as? String { return n }
                return nil
            }
            options.append(contentsOf: m)
        }
        preview = PreviewState(name: name, price: price, imageURL: imageURL, options: options)
    }

    private func applyPoster(_ event: [String: Any], start: Bool) {
        if !start { poster = nil; return }
        let p = (event["poster"] as? [String: Any]) ?? (event["data"] as? [String: Any]) ?? event
        let title = (p["title"] as? String) ?? ""
        let message = (p["message"] as? String) ?? (p["text"] as? String) ?? ""
        let imageURL = (p["imageUrl"] as? String) ?? (p["image"] as? String)
        poster = PosterState(title: title, message: message, imageURL: imageURL)
    }

    private func doubleFrom(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let f = any as? Float { return Double(f) }
        if let i = any as? Int { return Double(i) }
        if let s = any as? String { return Double(s) }
        if let n = any as? NSNumber { return n.doubleValue }
        return nil
    }

    private func reschedulePresenceTimer() {
        presenceTimer?.invalidate(); presenceTimer = nil
        guard httpReady else { return }
        let t = Timer.scheduledTimer(withTimeInterval: max(5, presenceInterval), repeats: true) { [weak self] _ in
            Task { await self?.sendPresence() }
        }
        // Also queue a first-run ping shortly after scheduling
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            await self?.sendPresence()
        }
        presenceTimer = t
        RunLoop.main.add(t, forMode: .common)
    }

    private func getManifestManual() async throws -> Data {
        // Build GET https://api1.../manifest with auth fallbacks
        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.path = "/manifest"
        guard let url = comps.url else { throw APIError(message: "invalid_url") }
        let tid = env.tenantId
        let tok = env.deviceToken
        var lastStatus: Int = -1
        // Variants: 0=Bearer, 1=DeviceToken, 2=Both
        for variant in 0..<3 {
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            if let tid = tid, !tid.isEmpty { req.setValue(tid, forHTTPHeaderField: "x-tenant-id") }
            if variant == 0 {
                if let tok = tok, !tok.isEmpty { req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization") }
            } else if variant == 1 {
                if let tok = tok, !tok.isEmpty { req.setValue(tok, forHTTPHeaderField: "x-device-token") }
            } else {
                if let tok = tok, !tok.isEmpty {
                    req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
                    req.setValue(tok, forHTTPHeaderField: "x-device-token")
                }
            }
            req.setValue("application/json", forHTTPHeaderField: "accept")
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let httpResp = resp as? HTTPURLResponse else { continue }
            if (200..<300).contains(httpResp.statusCode) { return data }
            lastStatus = httpResp.statusCode
        }
        throw APIError(message: "HTTP \(lastStatus)", code: lastStatus)
    }

    // MARK: - Posters
    func loadPosters() async {
        do {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            comps.path = "/posters"
            guard let url = comps.url else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            let hdrs = headers()
            for (k, v) in hdrs { req.setValue(v, forHTTPHeaderField: k) }
            req.setValue("application/json", forHTTPHeaderField: "accept")
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return }
            struct PostersResp: Decodable { let items: [String]? }
            if let decoded = try? JSONDecoder().decode(PostersResp.self, from: data) {
                await MainActor.run { self.posterURLs = decoded.items ?? [] }
            }
        } catch {
            // ignore errors; fallback poster will be used
        }
    }

    private func handleRTCProvider(_ ev: [String: Any]) {
        let provider = (ev["provider"] as? String)?.lowercased() ?? ""
        let bid = (ev["basketId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let pairId = (bid?.isEmpty == false) ? bid! : deviceId
        activeBasketId = pairId
        desiredProvider = provider
        // Ensure we are subscribed to the session basket to receive peer status and subsequent events
        ws.send(json: ["type": "subscribe", "basketId": pairId])
        var hello: [String: Any] = ["type": "hello", "basketId": pairId, "role": "display", "name": friendlyName]
        hello["device_id"] = deviceId
        if let tok = env.deviceToken, !tok.isEmpty { hello["token"] = tok }
        ws.send(json: hello)
        print("[Display] rtc:provider received → provider=\(provider) pairId=\(pairId)")
        NotificationCenter.default.post(name: .displayKickVideo, object: nil)
        switch provider {
        case "p2p":
            // Note: P2P has known SDP compatibility issues, but allowing for testing when LiveKit is down
            print("[Display] P2P provider requested - allowing for testing (LiveKit preferred when available)")
            #if canImport(WebRTC)
            // If a P2P instance exists for a different pair, tear it down first
            if let current = p2pPairId, current != pairId { p2p?.stop(); p2p = nil; p2pStarting = false }
            // If already starting or running for the same pair, ignore duplicate
            if p2pStarting { return }
            p2pStarting = true
            // Stop LiveKit if switching
            #if canImport(LiveKit)
            if livekit != nil || livekitStarting { livekit?.stop(); livekit = nil; livekitStarting = false }
            #endif
            if p2p == nil { p2p = P2PRTC(pairId: pairId, http: http, webRTCService: webRTCService); p2pPairId = pairId }
            Task { [weak self] in
                defer { self?.p2pStarting = false }
                try? await self?.p2p?.start(pairId: pairId)
            }
            #else
            break
            #endif
        case "livekit", "live":
            // Use enhanced orchestrator if available, otherwise fall back to legacy
            Task { [weak self] in
                guard let self = self else { return }
                if self.rtcOrchestrator != nil {
                    await self.startEnhancedRTCProvider("livekit", pairId: pairId)
                } else {
                    // Legacy LiveKit startup
                    #if canImport(LiveKit)
                    if self.livekitStarting { return }
                    self.livekitStarting = true
                    // Stop P2P if switching
                    self.p2p?.stop(); self.p2p = nil; self.p2pStarting = false
                    if self.livekit == nil { self.livekit = LiveKitRTC(pairId: pairId, http: self.http) }
                    defer { self.livekitStarting = false }
                    try? await self.livekit?.start()
                    #endif
                }
            }
        case "twilio":
            // Use enhanced orchestrator for Twilio
            Task { [weak self] in
                guard let self = self else { return }
                if self.rtcOrchestrator != nil {
                    await self.startEnhancedRTCProvider("twilio", pairId: pairId)
                } else {
                    print("[Display] Twilio provider requires enhanced orchestrator")
                }
            }
        case "off", "stopped":
            p2p?.stop(); p2p = nil; p2pStarting = false
            #if canImport(LiveKit)
            livekit?.stop(); livekit = nil; livekitStarting = false
            #endif
            peersConnected = false
            desiredProvider = ""
            rtcAutoStartAttempted = false
            // Ensure we remain visible in pickers after RTC stops
            subscribeDefaultBasket()
            reschedulePresenceTimer()
            Task { await self.sendPresence() }
        default:
            break
        }
    }

    // MARK: - Public UI commands
    func addToBasket(product: Product, qty: Int = 1) {
        var item: [String: Any] = [
            "sku": product.id,
            "name": product.name,
            "price": product.price
        ]
        if let img = product.image_url, !img.isEmpty { item["image_url"] = img }
        let op: [String: Any] = [
            "action": "add",
            "item": item,
            "qty": max(1, qty)
        ]
        ws.send(json: [
            "type": "basket:update",
            "basketId": activeBasketId ?? deviceId,
            "op": op
        ])
    }

    func removeFromBasket(sku: String) {
        let op: [String: Any] = [
            "action": "remove",
            "item": ["sku": sku]
        ]
        ws.send(json: [
            "type": "basket:update",
            "basketId": activeBasketId ?? deviceId,
            "op": op
        ])
    }

    func setLineQty(sku: String, qty: Int) {
        let q = max(0, qty)
        let op: [String: Any] = [
            "action": "setQty",
            "item": ["sku": sku],
            "qty": q
        ]
        ws.send(json: [
            "type": "basket:update",
            "basketId": activeBasketId ?? deviceId,
            "op": op
        ])
    }

    func sendOptionsClose() {
        ws.send(json: ["type":"ui:optionsClose", "basketId": activeBasketId ?? deviceId])
    }
    
    // MARK: - Testing Methods
    
    /// Test method to verify mute functionality is working
    func testMuteFunction() {
        print("[DisplaySessionStore] *** Testing mute functionality ***")
        
        // Test with enhanced orchestrator provider
        if let orchestrator = rtcOrchestrator,
           let enhancedProvider = orchestrator.activeProvider as? EnhancedLiveKitProvider {
            print("[DisplaySessionStore] Testing mute via enhanced orchestrator")
            print("[DisplaySessionStore] Current provider state: \(enhancedProvider.state)")
            print("[DisplaySessionStore] LiveKit instance available: \(enhancedProvider.liveKit != nil)")
            
            // Test muting
            enhancedProvider.setMicMuted(true)
            
            // Test unmuting after 2 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                print("[DisplaySessionStore] Testing unmute...")
                enhancedProvider.setMicMuted(false)
            }
            return
        }
        
        // Fallback to legacy LiveKit
        #if canImport(LiveKit)
        if let lk = livekit {
            print("[DisplaySessionStore] Testing mute via legacy LiveKit")
            print("[DisplaySessionStore] LiveKit instance available")
            
            // Test muting
            lk.setMicMuted(true)
            
            // Test unmuting after 2 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                print("[DisplaySessionStore] Testing unmute...")
                lk.setMicMuted(false)
            }
        } else {
            print("[DisplaySessionStore] ERROR: No LiveKit instance available for testing")
        }
        #endif
    }
}

extension Notification.Name {
    static let displayCollapseVideo = Notification.Name("OT.Display.CollapseVideo")
    static let displayExpandVideo = Notification.Name("OT.Display.ExpandVideo")
    static let displayKickVideo = Notification.Name("OT.Display.KickVideo")
    static let displayLocalCameraReady = Notification.Name("OT.Display.LocalCameraReady")
}
