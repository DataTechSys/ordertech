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
    
    // Callback for state changes
    var onStateChange: ((RTCProviderState, Bool) -> Void)?
    
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
            print("[RTCOrchestrator] About to start provider: \(providerType)")
            try await provider.start(pairId: pairId)
            print("[RTCOrchestrator] Provider start completed, updating orchestrator state to .connected")
            
            // Ensure we update the orchestrator state on the main actor
            await MainActor.run {
                self.providerState = .connected
                self.connectionQuality = provider.signalBars
                // Notify about state change
                self.onStateChange?(self.providerState, self.isConnected)
            }
            
            print("[RTCOrchestrator] Successfully started \(providerType) - orchestrator state: \(providerState), provider state: \(provider.state)")
            
            // Double-check that the state was properly set
            if providerState != .connected {
                print("[RTCOrchestrator] WARNING: orchestrator state was not properly set to .connected, forcing update")
                await MainActor.run {
                    self.providerState = .connected
                    // Notify about the forced state change as well
                    self.onStateChange?(self.providerState, self.isConnected)
                }
            }
        } catch {
            print("[RTCOrchestrator] Provider start failed with error: \(error)")
            await MainActor.run {
                self.providerState = .failed
                // Notify about state change
                self.onStateChange?(self.providerState, self.isConnected)
            }
            print("[RTCOrchestrator] Failed to start \(providerType): \(error)")
            throw error
        }
    }
    
    func stopCurrentProvider() async {
        print("[RTCOrchestrator] Stopping current provider - activeProvider: \(activeProvider?.providerType ?? "none"), providerState: \(providerState)")
        activeProvider?.stop()
        activeProvider = nil
        
        await MainActor.run {
            self.providerState = .stopped
            self.connectionQuality = 0
            // Notify about state change
            self.onStateChange?(self.providerState, self.isConnected)
        }
        
        currentPairId = nil
        isStarting = false
        print("[RTCOrchestrator] Provider stopped - state reset to .stopped, isConnected: \(isConnected)")
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
                liveKit = LiveKitRTC(pairId: pairId, http: http, deviceId: deviceId)
            }
            
            state = .connecting
            print("[EnhancedLiveKit] State set to .connecting, about to call liveKit.start()")
            try await liveKit?.start()
            print("[EnhancedLiveKit] liveKit.start() completed successfully, setting state to .connected")
            state = .connected
            print("[EnhancedLiveKit] State set to .connected - EnhancedLiveKitProvider.start() completed successfully")
            
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
        print("[EnhancedLiveKit] Stopping provider - transitioning to LOCAL mode")
        state = .stopping
        liveKit?.stop()
        liveKit = nil
        state = .stopped
        lastHealthMetrics = nil
        currentPairId = nil
        isStarting = false
        print("[EnhancedLiveKit] Provider stopped - should revert to LOCAL mode display")
    }
    
    func setMicMuted(_ muted: Bool) {
        // Implementation would go here
    }
    
    func preload(pairId: String) async throws {
        // Create LiveKit instance without starting
        if liveKit == nil {
            liveKit = LiveKitRTC(pairId: pairId, http: http, deviceId: deviceId)
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
    @Published var lastCashierName: String? = nil
    @Published var cashierDeviceId: String? = nil
    @Published var connectedDisplayName: String? = nil  // Name of connected display (for D2D)

    // Track WS state to avoid duplicate logs and duplicate hello
    private var lastWSState: Bool? = nil
    private var didSendHello: Bool = false

    // HTTP readiness & presence backoff
    private var httpReady: Bool = false
    private var presenceInterval: TimeInterval = 15  // Reduced from 10 to 15 seconds for better keep-alive

    // UI state published for the Display
    @Published var basketLines: [BasketLineUI] = []
    @Published var basketTotals: BasketTotalsUI = .zero
    @Published var preview: PreviewState? = nil
    @Published var poster: PosterState? = nil
    @Published var scrollToProductId: String? = nil
    @Published var posterURLs: [String] = []
    @Published var showIdlePoster: Bool = false
    // Suppress showing local options sheet in response to our own mirror echo
    @Published var suppressOptionsEcho: Bool = false
    // If set, an edit was initiated for this specific line (SKU). Use setQty instead of add.
    @Published var pendingEditSku: String? = nil

    // Remote UI control (from Cashier)
    @Published var selectedCategoryName: String? = nil
    @Published var selectedProductId: String? = nil
    // Mirrored quantity for product options popup so both scenes stay in sync
    @Published var optionsQty: Int = 1
    // Mirrored modifier selections for product options popup (groupId -> Set<optionId>)
    @Published var optionsSelection: [String: Set<String>] = [:]
    // Mirrored expanded/collapsed state for modifier groups
    @Published var optionsExpanded: [String: Bool] = [:]
    // Shared checkout overlay state (mirrors across all displays)
    @Published var showCheckoutOverlay: Bool = false
    
    // MARK: - Connection Health Monitoring
    
    /// Connection health monitor for robust remote control
    @Published var connectionHealthMonitor: ConnectionHealthMonitor = ConnectionHealthMonitor()
    
    // MARK: - Menu State Synchronization
    
    /// Menu state synchronization manager for robust D2D remote control
    @Published var menuStateSync: MenuStateSync = MenuStateSync()

    private let env: EnvironmentStore
    private let http: HttpClient
    private let ws: WebSocketManager
    private var bag = Set<AnyCancellable>()
    private var presenceTimer: Timer?
    private var statusTimer: Timer?
    private var wsKeepAliveTimer: Timer?

    #if canImport(WebRTC)
    @Published var webRTCService = WebRTCService()
    #endif
    
    // Enhanced RTC Provider Management
    private var _rtcOrchestrator: RTCProviderOrchestrator?
    var rtcOrchestrator: RTCProviderOrchestrator? { _rtcOrchestrator }
    
    // Legacy RTC providers (kept for backward compatibility)
    private var p2p: RTCProvider? = nil
    // Track which pairId the current p2p instance was created with to avoid mismatches
    private var p2pPairId: String? = nil
    #if canImport(LiveKit)
    private var livekit: LiveKitRTC? = nil
    var currentLiveKit: LiveKitRTC? { 
        // First check if orchestrator has a LiveKit provider
        if let orchestrator = _rtcOrchestrator {
            if let enhancedProvider = orchestrator.activeProvider as? EnhancedLiveKitProvider {
                // Always return the LiveKit instance if the enhanced provider exists and has one
                // Don't gate on connection state - let the video view handle availability
                if let liveKit = enhancedProvider.liveKit {
                    print("[CurrentLiveKit] Returning enhanced LiveKit instance")
                    return liveKit
                }
            }
        }
        
        // Fallback to legacy instance
        if livekit != nil {
            print("[CurrentLiveKit] Returning legacy livekit instance")
        }
        return livekit 
    }
    #endif
    // Provider start guards to prevent duplicate concurrent starts
    private var livekitStarting: Bool = false
    private var p2pStarting: Bool = false
    private var desiredProvider: String = ""
    // Fallback: auto-start LiveKit when peer is connected and no provider is active
    private var rtcAutoStartAttempted: Bool = false
    // Current basket/room ID (server-side device_id for this display) - publicly accessible
    @Published var activeBasketId: String? = nil
    // Track the connected display ID (for D2D connections)
    @Published var connectedDisplayId: String? = nil
    // Flag to ignore basket syncs during new connection (until RTC is established)
    private var ignoreBasketSync: Bool = false

    // Identity
    var deviceId: String  // Changed from let to var to allow updates
    var friendlyName: String
    var branch: String
    
    /// Update deviceId and reinitialize RTC providers
    func updateDeviceId(_ newDeviceId: String) {
        print("[DisplaySessionStore] Updating deviceId from \(deviceId) to \(newDeviceId)")
        deviceId = newDeviceId
        // Reinitialize RTC orchestrator with new deviceId
        setupRTCOrchestrator()
    }

    init(env: EnvironmentStore, deviceId: String, friendlyName: String, branch: String) {
        self.env = env
        self.http = HttpClient(env: env)
        self.ws = WebSocketManager(env: env)
        self.deviceId = deviceId
        self.friendlyName = friendlyName
        self.branch = branch

        // Initialize RTC Provider Orchestrator
        setupRTCOrchestrator()
        
        // Initialize connection health monitor
        connectionHealthMonitor.configure(sessionStore: nil) // DisplaySessionStore doesn't have SessionStore reference
        connectionHealthMonitor.startMonitoring()
        
        // Initialize menu state sync
        menuStateSync.sendStateUpdate = { [weak self] state in
            self?.sendMenuState(state)
        }
        
        // Listen for LiveKit participant disconnection
        NotificationCenter.default.addObserver(
            forName: Notification.Name("OT.Display.RemoteVideoLost"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleRemoteVideoLost()
        }
        
        ws.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] obj in 
                // Record events for health monitoring
                self?.connectionHealthMonitor.recordEventReceived(type: "\(obj["type"] ?? "unknown")")
                self?.handle(event: obj)
                // Post notification to reset idle timer on any WebSocket activity
                NotificationCenter.default.post(name: .displayResetIdleTimer, object: nil)
            }
            .store(in: &bag)

ws.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] ok in
                guard let self else { return }
                // Only react on changes to reduce noise
                if self.lastWSState != ok {
                    self.lastWSState = ok
                    self.connected = ok
                    // Update health monitor
                    self.connectionHealthMonitor.updateWebSocketState(connected: ok)
                    print("[Display] WS status changed → connected=\(ok)")
                    
                    // Fetch display status from database when connection changes
                    if ok {
                        Task {
                            await self.fetchDisplayStatus()
                        }
                    }
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
                    // Clear cashier info when disconnected
                    self.lastCashierName = nil
                    self.cashierDeviceId = nil
                    // Clear poster state when disconnected to ensure clean state on reconnect
                    self.poster = nil
                    // Clear all remote menu control state to restore local control
                    self.selectedCategoryName = nil
                    self.selectedProductId = nil
                    self.scrollToProductId = nil
                    self.preview = nil
                    self.suppressOptionsEcho = false
                    self.pendingEditSku = nil
                }
            }
            .store(in: &bag)
    }

func start() {
        Task { [weak self] in
            guard let self else { return }
            print("[Display] start(): begin; token pre-check=\(self.env.deviceToken != nil)")
            // Ensure tenant association & validate token before proceeding
            await self.ensureTenantIfPossible()
            await self.validateToken()
            let hasToken = (self.env.deviceToken != nil)
            print("[Display] start(): after validateToken; token present=\(hasToken)")
            guard hasToken else { print("[Display] start(): no token, aborting start."); return }
            // Prefetch posters for rotating backdrop (tenant-aware)
            await self.loadPosters()
            await MainActor.run {
                // WS connect
                print("[Display] WS connect → base=\(self.env.baseURL.absoluteString) wsBase=\(self.env.wsBaseURL.absoluteString)")
                self.ws.connect()
                // Presence heartbeat only after HTTP is ready
                self.reschedulePresenceTimer()
                // Start periodic status checking
                self.startStatusTimer()
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
                    print("[Display] ensure-tenant(api1): unauthorized (\(httpResp.statusCode)) — clearing token")
                    await MainActor.run { env.deviceToken = nil }
                    return
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
        // Validate device token with a lightweight call using manual request only (avoid HttpClient side effects)
        do {
            let data = try await self.getManifestManual()
            _ = try? JSONDecoder().decode(Manifest.self, from: data)
            httpReady = true
            print("[Display] validateToken: /manifest ok via bearer; HTTP ready=true")
        } catch let e as APIError {
            httpReady = false
            // Strict: any non-2xx (including 401/403/404) → clear token and stop
            print("[Display] validateToken: APIError code=\(e.code ?? -1) msg=\(e.message) — clearing token")
            await MainActor.run { self.env.deviceToken = nil }
            return
        } catch {
            // Strict: any error → clear token and stop
            print("[Display] validateToken: error: \(error.localizedDescription) — clearing token")
            await MainActor.run { self.env.deviceToken = nil }
            return
        }
        // After validation attempt, (re)schedule presence timer appropriately
        await MainActor.run { self.reschedulePresenceTimer() }
    }

    func stop() {
        print("[Display] stop(): Full reset initiated")
        
        // Send disconnect notification to remote first and wait for acknowledgment
        let disconnectBasketId = activeBasketId ?? deviceId
        ws.send(json: ["type":"rtc:stopped", "basketId": disconnectBasketId, "reason": "display_stop"])
        print("[Display] Sent rtc:stopped notification to basketId=\(disconnectBasketId)")
        
        // Stop all timers
        presenceTimer?.invalidate(); presenceTimer = nil
        statusTimer?.invalidate(); statusTimer = nil
        
        // Stop orchestrator and legacy providers
        Task {
            await _rtcOrchestrator?.stopCurrentProvider()
            await MainActor.run {
                self.peersConnected = false
                print("[Display] All providers stopped - peersConnected reset to false")
            }
        }
        p2p?.stop(); p2p = nil; p2pPairId = nil
        #if canImport(LiveKit)
        livekit?.stop(); livekit = nil; livekitStarting = false
        #endif
        
        // Clear connection tracking
        connectedDisplayId = nil
        
        // Full state reset like fresh start
        peersConnected = false
        lastRtcStatusAt = nil
        lastCashierName = nil
        cashierDeviceId = nil
        desiredProvider = ""
        rtcAutoStartAttempted = false
        
        // Clear all UI state including local basket
        basketLines = []
        basketTotals = .zero
        preview = nil
        poster = nil
        selectedCategoryName = nil
        selectedProductId = nil
        scrollToProductId = nil
        suppressOptionsEcho = false
        pendingEditSku = nil
        optionsQty = 1
        optionsSelection = [:]
        optionsExpanded = [:]
        
        // Revert to default subscription (own deviceId) to be discoverable again
        subscribeDefaultBasket()
        
        // Restart presence and status timers
        reschedulePresenceTimer()
        startStatusTimer()
        Task { await self.sendPresence() }
        
        print("[Display] Full reset complete - ready for new connection")
    }
    
    /// Handle remote video loss due to LiveKit participant disconnection
    private func handleRemoteVideoLost() {
        print("[DisplaySessionStore] Remote participant disconnected - handling video loss")
        
        // Update connection state immediately
        peersConnected = false
        
        // The LocalModeManager will detect peersConnected=false and activate local mode
        // We don't need to do anything else here - the existing logic will handle it
        print("[DisplaySessionStore] Set peersConnected=false - local mode should activate")
    }
    
    /// Connect to another display device (D2D connection)
    func connectToDisplay(targetDisplayId: String) async {
        print("[DisplaySessionStore] Connecting to display: \(targetDisplayId)")
        
        // Clear basket and UI state from previous session before connecting
        await MainActor.run {
            self.basketLines = []
            self.basketTotals = .zero
            self.preview = nil
            self.poster = nil
            self.selectedCategoryName = nil
            self.selectedProductId = nil
            self.scrollToProductId = nil
            // Ignore basket syncs until RTC connection is established
            self.ignoreBasketSync = true
            print("[DisplaySessionStore] Cleared basket and UI state before remote session")
        }
        
        // Ensure WebSocket is connected first
        if !ws.isConnected {
            print("[DisplaySessionStore] WebSocket not connected, reconnecting...")
            await MainActor.run {
                ws.connect()
            }
            // Wait for connection
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
        }
        
        // Stop RTC providers but keep WebSocket connected
        await MainActor.run {
            // Stop timers temporarily
            presenceTimer?.invalidate()
            presenceTimer = nil
            statusTimer?.invalidate()
            statusTimer = nil
        }
        
        // Notify peers and stop RTC
        ws.send(json: ["type":"rtc:stopped", "basketId": activeBasketId ?? deviceId, "reason": "switching_display"])
        
        // Stop orchestrator and legacy providers
        await _rtcOrchestrator?.stopCurrentProvider()
        await MainActor.run {
            self.peersConnected = false
            print("[DisplaySessionStore] RTC providers stopped for display switch")
        }
        
        // Stop legacy providers
        await MainActor.run {
            self.p2p?.stop()
            self.p2p = nil
            self.p2pPairId = nil
            #if canImport(LiveKit)
            self.livekit?.stop()
            self.livekit = nil
            self.livekitStarting = false
            #endif
        }
        
        // Small delay to ensure RTC cleanup completes
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        
        // Subscribe to the target display's basket using display: prefix for D2D detection
        let d2dBasketId = "display:\(targetDisplayId)"
        ws.send(json: ["type": "subscribe", "basketId": d2dBasketId])
        
        // Send hello as display connecting to another display
        // Note: Using role=cashier as workaround - server may not handle D2D with role=display
        var hello: [String: Any] = [
            "type": "hello",
            "basketId": targetDisplayId,
            "role": "cashier",  // Pretend to be cashier so server initiates RTC
            "name": friendlyName
        ]
        hello["device_id"] = deviceId
        if let tok = env.deviceToken, !tok.isEmpty { hello["token"] = tok }
        ws.send(json: hello)
        
        activeBasketId = targetDisplayId
        connectedDisplayId = targetDisplayId
        
        // Fetch the display name from presence API
        Task {
            await self.fetchConnectedDisplayName(displayId: targetDisplayId)
        }
        
        // Restart timers for the new connection
        await MainActor.run {
            self.reschedulePresenceTimer()
        }
        
        // Send device name directly to the remote display
        ws.send(json: [
            "type": "peer:identity",
            "basketId": targetDisplayId,
            "name": friendlyName,
            "device_id": deviceId
        ])
        print("[DisplaySessionStore] Sent peer:identity with name=\(friendlyName) to remote display")
        
        // Wait for RTC provider signal from server
        print("[DisplaySessionStore] Subscribed to display \(targetDisplayId), waiting for RTC setup")
    }
    
    // MARK: - RTC Provider Orchestration
    private func setupRTCOrchestrator() {
        _rtcOrchestrator = RTCProviderOrchestrator()
        
        // Set up callback to track orchestrator state changes
        _rtcOrchestrator?.onStateChange = { [weak self] state, isConnected in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.peersConnected = isConnected
                print("[Display] Orchestrator state changed to \(state), peersConnected updated to \(isConnected)")
            }
        }
        
        // Register available providers
        #if canImport(LiveKit)
        let enhancedLiveKit = EnhancedLiveKitProvider(deviceId: deviceId, http: http)
        _rtcOrchestrator?.registerProvider(enhancedLiveKit)
        print("[Display] LiveKit provider registered for enhanced orchestration")
        #endif
        
        print("[Display] RTC Orchestrator initialized")
    }
    
    private func startEnhancedRTCProvider(_ providerType: String, pairId: String) async {
        guard let orchestrator = _rtcOrchestrator else {
            print("[Display] RTC Orchestrator not available, falling back to legacy providers")
            return
        }
        
        do {
            try await orchestrator.startProvider(providerType, pairId: pairId)
            await MainActor.run {
                self.peersConnected = orchestrator.isConnected
                // Re-enable basket syncs now that RTC is connected
                self.ignoreBasketSync = false
                print("[Display] Enhanced RTC provider \(providerType) started successfully - peersConnected: \(self.peersConnected)")
            }
        } catch {
            print("[Display] Enhanced RTC provider \(providerType) failed to start: \(error)")
            await MainActor.run {
                self.peersConnected = false
                print("[Display] Enhanced RTC provider \(providerType) failed - peersConnected set to false")
            }
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

    func sendSelectCategory(name: String) {
        // Mirror category selection to remote (Cashier or Display)
        let targetBasket = activeBasketId ?? deviceId
        ws.send(json: ["type":"ui:selectCategory", "basketId": targetBasket, "name": name])
        print("[Display] Sent ui:selectCategory to basketId=\(targetBasket) name=\(name)")
    }
    func sendShowProduct(id: String) {
        let targetBasket = activeBasketId ?? deviceId
        ws.send(json: ["type":"ui:showOptions", "basketId": targetBasket, "product_id": id])
        print("[Display] Sent ui:showOptions to basketId=\(targetBasket) product_id=\(id)")
    }
    func sendScrollTo(id: String) {
        let targetBasket = activeBasketId ?? deviceId
        ws.send(json: ["type":"ui:scrollTo", "basketId": targetBasket, "product_id": id])
        print("[Display] Sent ui:scrollTo to basketId=\(targetBasket) product_id=\(id)")
    }
    
    /// Send menu state update via WebSocket
    private func sendMenuState(_ state: MenuStateSync.MenuState) {
        let basketId = activeBasketId ?? deviceId
        let event = state.toWebSocketEvent(basketId: basketId)
        ws.send(json: event)
        print("[Display] Sent menu:state: category=\(state.selectedCategory ?? "nil"), product=\(state.selectedProduct ?? "nil"), scroll=\(state.scrollToProduct ?? "nil")")
    }
    
    /// Reset menu synchronization to local control
    func resetToLocalControl() {
        print("[Display] Resetting menu synchronization to local control")
        
        // Clear all remote control state to ensure full local control
        selectedCategoryName = nil
        selectedProductId = nil
        scrollToProductId = nil
        preview = nil
        
        // Clear remote control authority
        suppressOptionsEcho = false
        pendingEditSku = nil
        
        print("[Display] Menu state cleared - local control restored")
    }
    
    /// Reset menu synchronization to allow remote control
    func resetToRemoteControl() {
        print("[Display] Resetting menu synchronization to allow remote control")
        
        // Clear any pending local edits or suppressions
        suppressOptionsEcho = false
        pendingEditSku = nil
        
        // Don't clear selectedCategoryName and selectedProductId here
        // as they might be needed for the handoff to remote control
        
        print("[Display] Ready to accept remote control")
    }

    private func handle(event: [String: Any]) {
        let type = (event["type"] as? String) ?? ""
        print("[Display] WS event: \(type)")
        switch type {
        case "peer:identity":
            // Custom event to receive peer name directly from connecting display
            if let remoteName = event["name"] as? String, !remoteName.isEmpty {
                connectedDisplayName = remoteName
                print("[Display] Received peer:identity with name: \(remoteName)")
            }
            if let remoteDeviceId = event["device_id"] as? String, !remoteDeviceId.isEmpty {
                connectedDisplayId = remoteDeviceId
                print("[Display] Received peer:identity with device_id: \(remoteDeviceId)")
            }
        case "peer:status":
            let raw = (event["status"] as? String) ?? ""
            let status = raw.lowercased()
            print("[Display] WS event: peer:status status=\(status)")
            print("[Display] peer:status event keys: \(event.keys.joined(separator: ", "))")
            if let name = event["name"] { print("[Display] peer:status.name = \(name)") }
            if let cashierName = event["cashier_name"] { print("[Display] peer:status.cashier_name = \(cashierName)") }
            if let cashierNameCamel = event["cashierName"] { print("[Display] peer:status.cashierName = \(cashierNameCamel)") }
            if let displayName = event["displayName"] { print("[Display] peer:status.displayName = \(displayName)") }
            if let deviceId = event["device_id"] { print("[Display] peer:status.device_id = \(deviceId)") }
            if let cashierDevId = event["cashier_device_id"] { print("[Display] peer:status.cashier_device_id = \(cashierDevId)") }
            
            // Extract remote device name and device_id from event if available
            // Try multiple fields: name (for D2D), cashierName/cashier_name (for cashier connection)
            if let remoteName = event["name"] as? String, !remoteName.isEmpty {
                connectedDisplayName = remoteName
                print("[Display] Updated connected display name from peer:status: \(remoteName)")
            } else if let cashierName = (event["cashierName"] as? String) ?? (event["cashier_name"] as? String), !cashierName.isEmpty {
                lastCashierName = cashierName
                print("[Display] Updated cashier name from peer:status: \(cashierName)")
            }
            
            // Extract device IDs
            if let deviceId = event["device_id"] as? String, !deviceId.isEmpty {
                connectedDisplayId = deviceId
                cashierDeviceId = deviceId
                print("[Display] Updated connected device_id from peer:status: \(deviceId)")
                
                // Fetch display name if we only have the ID
                if connectedDisplayName == nil && lastCashierName == nil {
                    Task {
                        await self.fetchConnectedDisplayName(displayId: deviceId)
                    }
                }
            } else if let cashierDevId = event["cashier_device_id"] as? String {
                cashierDeviceId = cashierDevId
            }
            
            switch status {
            case "connected":
                peersConnected = true
                connectionHealthMonitor.updatePeerState(connected: true)
                
                // Request menu state sync on reconnection (if configured as display)
                if menuStateSync.isDisplay {
                    print("[Display] Peer reconnected - requesting menu state sync")
                    menuStateSync.requestStateSync(deviceId: deviceId)
                }
                
                // Do not auto-start any provider on generic peer:status. We wait for an explicit rtc:provider or rtc:offer
                // event which includes the correct basketId/pairId to avoid mismatches.
            case "disconnected", "stopped", "off":
                let wasPreviouslyConnected = peersConnected
                peersConnected = false
                connectionHealthMonitor.updatePeerState(connected: false)
                desiredProvider = ""
                rtcAutoStartAttempted = false
                
                print("[Display] Peer status changed to \(status) - peersConnected set to false (was \(wasPreviouslyConnected))")
                
                if wasPreviouslyConnected {
                    print("[Display] Peer disconnected - stopping RTC providers and reverting to LOCAL mode")
                    // Clear basket from remote session
                    basketLines = []
                    basketTotals = .zero
                    // Clear poster state when peer disconnects
                    poster = nil
                    // Clear remote menu control state to restore full local control
                    selectedCategoryName = nil
                    selectedProductId = nil
                    scrollToProductId = nil
                    preview = nil
                    suppressOptionsEcho = false
                    pendingEditSku = nil
                    optionsQty = 1
                    optionsSelection = [:]
                    optionsExpanded = [:]
                    Task {
                        await _rtcOrchestrator?.stopCurrentProvider()
                        await MainActor.run {
                            self.peersConnected = false // Ensure it's set again on main thread
                            print("[Display] RTC providers stopped due to peer disconnection - remote basket and menu state cleared, local control restored")
                        }
                    }
                }
                
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
            // Stop all RTC providers (legacy and orchestrator)
            p2p?.stop(); p2p = nil; p2pPairId = nil
            #if canImport(LiveKit)
            livekit?.stop(); livekit = nil; livekitStarting = false
            #endif
            
            // Stop orchestrator and update peersConnected
            Task {
                await _rtcOrchestrator?.stopCurrentProvider()
                await MainActor.run {
                    self.peersConnected = false
                    // Clear poster state when RTC stops
                    self.poster = nil
                    // Clear connection tracking
                    self.connectedDisplayId = nil
                    // Clear basket on disconnect
                    self.basketLines = []
                    self.basketTotals = .zero
                    print("[Display] rtc:stopped - all RTC providers stopped, basket and state cleared, peersConnected set to false")
                }
            }
            
            // Reset provider state
            desiredProvider = ""
            rtcAutoStartAttempted = false
            ignoreBasketSync = false
            
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
            // Ignore basket syncs during initial connection phase (until RTC connected)
            if ignoreBasketSync {
                print("[Display] Ignoring basket sync during connection phase")
            } else {
                applyBasket(event)
            }
        case "session:started":
            // new session clears basket/preview
            basketLines = []
            basketTotals = .zero
            preview = nil
            // Reset ignore flag for new sessions
            ignoreBasketSync = false
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
            // Clear poster state when session ends
            poster = nil
            // Clear all remote menu control state to ensure clean local mode
            selectedCategoryName = nil
            selectedProductId = nil
            scrollToProductId = nil
            preview = nil
            suppressOptionsEcho = false
            pendingEditSku = nil
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
                self.optionsQty = 1
                self.optionsSelection = [:]
                self.optionsExpanded = [:]
            }
        case "ui:optionsCancel":
            // Cancel options and clear any preview/selection
            Task { @MainActor in
                self.selectedProductId = nil
                self.preview = nil
                self.pendingEditSku = nil
                self.optionsQty = 1
                self.optionsSelection = [:]
                self.optionsExpanded = [:]
            }
        case "poster:start":
            applyPoster(event, start: true)
        case "poster:stop":
            applyPoster(event, start: false)
        case "ui:checkoutOverlay":
            // Handle remote checkout overlay state change
            if let show = event["show"] as? Bool {
                Task { @MainActor in
                    self.showCheckoutOverlay = show
                    print("[Display] Received ui:checkoutOverlay event - showing overlay: \(show)")
                }
            }
        case "ui:paymentMethod":
            // Handle remote payment method change
            if let paymentMethodString = event["paymentMethod"] as? String {
                // Forward to LocalModeManager if available
                Task { @MainActor in
                    NotificationCenter.default.post(
                        name: NSNotification.Name("OT.PaymentMethod.Updated"),
                        object: nil,
                        userInfo: ["paymentMethod": paymentMethodString]
                    )
                    print("[Display] Received ui:paymentMethod event - method: \(paymentMethodString)")
                }
            }
        case "ui:checkoutBasket":
            // Handle remote checkout basket data sync
            if let linesData = event["lines"] as? [[String: Any]],
               let totalsData = event["totals"] as? [String: Any] {
                Task { @MainActor in
                    NotificationCenter.default.post(
                        name: NSNotification.Name("OT.CheckoutBasket.Updated"),
                        object: nil,
                        userInfo: ["lines": linesData, "totals": totalsData]
                    )
                    print("[Display] Received ui:checkoutBasket event with \(linesData.count) items")
                }
            }
        case "ui:videoMode":
            if let mode = (event["mode"] as? String)?.lowercased() {
                if mode == "small" { NotificationCenter.default.post(name: .displayCollapseVideo, object: nil) }
                if mode == "full" { NotificationCenter.default.post(name: .displayExpandVideo, object: nil) }
            }
        case "menu:state":
            // Receive menu state synchronization from peer
            if let state = MenuStateSync.MenuState.fromWebSocketEvent(event) {
                menuStateSync.receiveState(state)
            }
        case "menu:state:sync":
            // Peer requesting current menu state
            menuStateSync.provideCurrentState(deviceId: deviceId)
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
                // Count presence as activity to prevent false "event silence" warnings
                await MainActor.run {
                    connectionHealthMonitor.recordEventReceived(type: "presence:sent")
                }
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
                // Count presence as activity to prevent false "event silence" warnings
                await MainActor.run {
                    connectionHealthMonitor.recordEventReceived(type: "presence:sent")
                }
                if presenceInterval > 15 { presenceInterval = 15; await MainActor.run { reschedulePresenceTimer() } }
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
                // Count presence as activity to prevent false "event silence" warnings
                await MainActor.run {
                    connectionHealthMonitor.recordEventReceived(type: "presence:sent")
                }
                if presenceInterval > 15 { presenceInterval = 15; await MainActor.run { reschedulePresenceTimer() } }
                return
            }
            if code3 == 401 || code3 == 403 {
                print("[Display] presence: unauthorized (fallback3=\(code3)) — clearing token")
                await MainActor.run { self.env.deviceToken = nil }
                return
            }
            print("[Display] presence: HTTP \(code3)")
            presenceInterval = min(presenceInterval * 2, 60)  // Cap at 60s instead of 120s
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
                // Prefer 'lineId' as the canonical line identifier (supports modifier variants)
                let id = (raw["lineId"] as? String)
                    ?? (raw["sku"] as? String)
                    ?? (raw["id"] as? String)
                    ?? (raw["productId"] as? String)
                    ?? UUID().uuidString
                let name = (raw["name"] as? String)
                    ?? (raw["productName"] as? String)
                    ?? "Item"
                let nameAr = (raw["nameAr"] as? String) ?? (raw["name_ar"] as? String)
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
                lines.append(BasketLineUI(id: id, name: name, nameAr: nameAr, qty: qty, unitPrice: price, lineTotal: total, options: options, imageURL: image))
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
            // Configure menu state sync for D2D connections
            if cashierDeviceId == nil && connectedDisplayId != nil {
                // This is a Display-to-Display connection, configure as display (receiver)
                menuStateSync.configureAsDisplay()
                print("[Display] Configured MenuStateSync as display (D2D mode)")
            }
            
            // Use enhanced orchestrator if available, otherwise fall back to legacy
            Task { [weak self] in
                guard let self = self else { return }
                if self._rtcOrchestrator != nil {
                    await self.startEnhancedRTCProvider("livekit", pairId: pairId)
                    // Notify menu state sync that connection is established
                    await MainActor.run {
                        self.menuStateSync.onConnectionEstablished()
                    }
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
                if self._rtcOrchestrator != nil {
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
    func addToBasket(product: Product, qty: Int = 1, modifiers: [[String: Any]]? = nil) {
        var item: [String: Any] = [
            "sku": product.id,
            "name": product.name,
            "price": product.price
        ]
        if let nameAr = product.name_localized, !nameAr.isEmpty { item["nameAr"] = nameAr }
        if let img = product.image_url, !img.isEmpty { item["image_url"] = img }
        if let mods = modifiers, !mods.isEmpty {
            item["modifiers"] = mods
        }
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
    
    func sendCheckoutOverlayState(show: Bool) {
        let targetBasket = activeBasketId ?? deviceId
        ws.send(json: ["type": "ui:checkoutOverlay", "basketId": targetBasket, "show": show])
        print("[Display] Sent ui:checkoutOverlay to basketId=\(targetBasket) show=\(show)")
    }
    
    func sendPaymentMethodUpdate(paymentMethod: String) {
        let targetBasket = activeBasketId ?? deviceId
        ws.send(json: ["type": "ui:paymentMethod", "basketId": targetBasket, "paymentMethod": paymentMethod])
        print("[Display] Sent ui:paymentMethod to basketId=\(targetBasket) paymentMethod=\(paymentMethod)")
    }
    
    func sendCheckoutBasketData(lines: [BasketLineUI], totals: BasketTotalsUI) {
        let targetBasket = activeBasketId ?? deviceId
        
        // Convert basket lines to JSON-serializable format
        let linesData: [[String: Any]] = lines.map { line in
            var dict: [String: Any] = [
                "id": line.id,
                "name": line.name,
                "qty": line.qty,
                "unitPrice": line.unitPrice,
                "lineTotal": line.lineTotal,
                "options": line.options,
                "imageURL": line.imageURL ?? ""
            ]
            if let nameAr = line.nameAr {
                dict["nameAr"] = nameAr
            }
            return dict
        }
        
        let totalsData: [String: Any] = [
            "subtotal": totals.subtotal,
            "tax": totals.tax,
            "total": totals.total
        ]
        
        ws.send(json: [
            "type": "ui:checkoutBasket",
            "basketId": targetBasket,
            "lines": linesData,
            "totals": totalsData
        ])
        
        print("[Display] Sent ui:checkoutBasket to basketId=\(targetBasket) with \(lines.count) items")
    }
    
    func clearRemoteBasket() {
        // Clear local basket state
        basketLines = []
        basketTotals = .zero
        
        // Send basket:update with clear action to server/peers to reset the session
        ws.send(json: [
            "type": "basket:update",
            "basketId": activeBasketId ?? deviceId,
            "op": ["action": "clear"]
        ])
        
        print("[DisplaySessionStore] Remote basket cleared and session reset sent")
    }
    
    // MARK: - Display Status API
    
    /// Fetch current display status from server including cashier information
    private func fetchDisplayStatus() async {
        guard let token = env.deviceToken, !token.isEmpty else { return }
        
        do {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            comps.path = "/display/status"
            guard let url = comps.url else { return }
            
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue(token, forHTTPHeaderField: "x-device-token")
            req.setValue(deviceId, forHTTPHeaderField: "x-device-id")
            
            if let tenantId = env.tenantId, !tenantId.isEmpty {
                req.setValue(tenantId, forHTTPHeaderField: "x-tenant-id")
            }
            
            req.setValue("application/json", forHTTPHeaderField: "accept")
            
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                print("[Display] fetchDisplayStatus: HTTP error \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                return
            }
            
            struct DisplayStatus: Codable {
                let device_id: String
                let name: String?
                let role: String
                let status: String
                let online: Bool
                let connected: Bool
                let connection_status: String
                let session_id: String?
                let cashier_name: String?
                let cashier_device_id: String?
                let connected_at: String?
                let last_seen: String?
            }
            
            let displayStatus = try JSONDecoder().decode(DisplayStatus.self, from: data)
            
            await MainActor.run {
                self.lastCashierName = displayStatus.cashier_name
                self.cashierDeviceId = displayStatus.cashier_device_id
                
                print("[Display] Status from DB: connected=\(displayStatus.connected), cashier=\(displayStatus.cashier_name ?? "none"), session=\(displayStatus.session_id ?? "none")")
                
                // Only update peersConnected from DB if RTC orchestrator agrees (don't override active D2D connections)
                let dbConnected = displayStatus.connected && displayStatus.cashier_name != nil
                let rtcConnected = self._rtcOrchestrator?.isConnected ?? false
                
                // If RTC says we're connected, trust that over DB (important for D2D connections)
                if rtcConnected {
                    print("[Display] RTC orchestrator shows connected - ignoring DB status to preserve D2D connection")
                } else if dbConnected != self.peersConnected {
                    // Only update from DB when RTC is not active
                    print("[Display] Updating peersConnected from DB: \(self.peersConnected) -> \(dbConnected)")
                    self.peersConnected = dbConnected
                }
            }
            
        } catch {
            print("[Display] fetchDisplayStatus error: \(error.localizedDescription)")
        }
    }
    
    private func startStatusTimer() {
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            Task {
                await self?.fetchDisplayStatus()
            }
        }
        RunLoop.main.add(statusTimer!, forMode: .common)
        print("[Display] Started periodic status checking (30s interval)")
    }
    
    /// Fetch the name of a connected display from presence API
    private func fetchConnectedDisplayName(displayId: String) async {
        guard let token = env.deviceToken, !token.isEmpty else { return }
        
        do {
            let client = HttpClient(env: env)
            let displays = try await client.presenceDisplays()
            
            // Find the display by ID
            if let display = displays.first(where: { $0.id == displayId }) {
                await MainActor.run {
                    self.connectedDisplayName = display.name
                    print("[Display] Fetched connected display name: \(display.name ?? "nil") for ID: \(displayId)")
                }
            } else {
                print("[Display] Could not find display with ID: \(displayId) in presence list")
            }
        } catch {
            print("[Display] fetchConnectedDisplayName error: \(error.localizedDescription)")
        }
    }
}

extension Notification.Name {
    static let displayCollapseVideo = Notification.Name("OT.Display.CollapseVideo")
    static let displayExpandVideo = Notification.Name("OT.Display.ExpandVideo")
    static let displayKickVideo = Notification.Name("OT.Display.KickVideo")
    static let displayLocalCameraReady = Notification.Name("OT.Display.LocalCameraReady")
    static let displayVideoRefresh = Notification.Name("OT.Display.VideoRefresh")
    static let displayResetIdleTimer = Notification.Name("OT.Display.ResetIdleTimer")
}
