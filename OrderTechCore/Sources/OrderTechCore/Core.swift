import Foundation
import os.log
import Combine
import Security

public enum AppEnvironmentKind: String, Codable, CaseIterable { case production, staging, custom }

@available(iOS 16.0, macOS 12.0, *)
public final class EnvironmentStore: ObservableObject {
    @Published public var environment: AppEnvironmentKind
    @Published public var customBaseURLString: String
    @Published public private(set) var baseURL: URL
    @Published public var tenantId: String?
    @Published public var deviceToken: String? { didSet { setKeychain(deviceToken, key: Keys.deviceToken) } }
    // Foodics API bearer token (stored in Keychain)
    @Published public var foodicsToken: String? { didSet { setKeychain(foodicsToken, key: Keys.foodicsToken) } }
    // Optional tenant host override for activation (e.g., koobs.ordertech.me)
    @Published public var tenantHostOverride: String?

    private struct Keys {
        static let environment = "OT.envKind"
        static let customBaseURL = "OT.customBaseURL"
        static let tenantId = "OT.tenantId"
        static let deviceToken = "OT.deviceToken"
        static let tenantHostOverride = "OT.tenantHostOverride"
        static let foodicsToken = "OT.foodicsToken"
    }

public init(defaultEnv: AppEnvironmentKind = .production) {
        let raw = UserDefaults.standard.string(forKey: Keys.environment) ?? defaultEnv.rawValue
        let envKind = AppEnvironmentKind(rawValue: raw) ?? defaultEnv
        let custom = UserDefaults.standard.string(forKey: Keys.customBaseURL) ?? ""
        let tenant = UserDefaults.standard.string(forKey: Keys.tenantId)
        let token = getKeychain(Keys.deviceToken)
        var foodics = getKeychain(Keys.foodicsToken)
        // Default Foodics token for Koobs testing
        if foodics == nil || foodics?.isEmpty == true {
            foodics = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5MGQ1YTcxOC1lMzBkLTQ5ODYtODY0Ni0wNjdlZDBkMzdkMGUiLCJqdGkiOiIxN2FjYWZmZGNhOTE4YTVlMmE4ZWVmODk3ZjUyZGRiZWYxYzc0NmE1ODlhOGM4Y2Q3OTc0MWM2YzNmYTNhOTc3ZTEyYzc4MTI4NTRmODlmMCIsImlhdCI6MTc0NzgxMTYzMC4wOTY2NzUsIm5iZiI6MTc0NzgxMTYzMC4wOTY2NzUsImV4cCI6MTkwNTU3ODAzMC4wNjAyMzksInN1YiI6IjkyODNmNGI3LWNiZDEtNGNkZC05MDg0LThhZmQ2ZGYxZTkxOCIsInNjb3BlcyI6WyJnZW5lcmFsLnJlYWQiLCJvcmRlcnMubGlzdCIsInVzZXJzLnJlYWQiLCJpbnZlbnRvcnkudHJhbnNhY3Rpb25zLnJlYWQiLCJpbnZlbnRvcnkudHJhbnNhY3Rpb25zLndyaXRlIiwiaW52ZW50b3J5LnNldHRpbmdzLnJlYWQiLCJpbnZlbnRvcnkuc2V0dGluZ3Mud3JpdGUiLCJtZW51LmluZ3JlZGllbnRzLnJlYWQiLCJvcmRlcnMuZ2lmdF9jYXJkcy5yZWFkIiwiY3VzdG9tZXJzLmxpc3QiLCJjdXN0b21lcnMuYWNjb3VudHMucmVhZCIsImN1c3RvbWVycy5sb3lhbHR5LnJlYWQiLCJjb3Vwb25zLnJlYWQiLCJjb3Vwb25zLndyaXRlIl0sImJ1c2luZXNzIjoiOTI4M2Y0YjctZDA4OS00OWJkLWE0MTgtNDJiNmY4YmQ0Yzc0IiwicmVmZXJlbmNlIjoiNDk0Njc1In0.zU6PjT0DuaMfgcgqi_79m2dHy6Xt2goEgxTnAiQlBLk_j9QcILyUJImtyPfyFA81nxey3qKuyFjfh74PTkpVUAiJ1DNwKLWjaLiZC2CaJRcX2KlWxrDjjb-tXoSwsxZgLX6fHZzbJ9yemux9HQ3EAnxsvtSbGz9um3w5pqQLwPXMMchRizILjHXDhGiXJDOQdfD2N7mJnyIQ5wOnAdN37bXzpCannFTz053QzorFKmue_Uo10E8BGvMbGVknlkTiPFP4s5T9QUbdZ5nLNqIjmwUUHOqUNkDuS2m9JzgCeCanf19BWZbytbftlI6_iIIl_2T5omtz-mB_1TPdLXrHSjdFCLhyCQv4WEOdZv5e50hOs2kAur7WiILzJv2hlBl-4FGWe0lhWIvZ3sEzqPPrFiZydwY5O8PmL740q8RZELrYXnxMEzzOQBbiIeC_bDBUY2jD1BtW8QqajkVRqT8tcBmaBzCbLrT1OxIMgsejPZc4h2wlNizIckKs-RPRhUGKMRLyWuBo6xRMvqucfmp_I_ymLL11FsRal3UmIBS4vhIgsU7f0M6i0bQsHsEDfyVWhtWVnklMNbiKfGo-73tr3PqrjLqyH7Fj6HiCoWymsDx-LkXWVrsmSspeeD0H1u2FY5rb25yiCBifwl9wDW2LZdkXdDom9EXdY0olI0elGqA"
        }
        let host = UserDefaults.standard.string(forKey: Keys.tenantHostOverride)
        let base = EnvironmentStore.computeBaseURL(env: envKind, custom: custom)
        // Now assign stored properties
        self.environment = envKind
        self.customBaseURLString = custom
        self.tenantId = tenant
        self.deviceToken = token
        self.foodicsToken = foodics
        // Clear any stale localhost override to prevent unreachable WS host like "koob.localhost"
        if let h = host?.trimmingCharacters(in: .whitespacesAndNewlines), h.contains("localhost") {
            self.tenantHostOverride = nil
        } else {
            self.tenantHostOverride = host
        }
        self.baseURL = base
        // If no explicit override yet, apply DefaultAPIHost from Info.plist (if present)
        if (self.tenantHostOverride?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) {
            if let def = Bundle.main.object(forInfoDictionaryKey: "DefaultAPIHost") as? String,
               !def.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                self.tenantHostOverride = def.trimmingCharacters(in: .whitespacesAndNewlines)
                updateBaseURL()
                persist()
            }
        }
        // If a stale localhost override was found at launch, clear it from persistent storage so future launches start clean.
        if let h = host?.trimmingCharacters(in: .whitespacesAndNewlines), h.contains("localhost") {
            UserDefaults.standard.removeObject(forKey: Keys.tenantHostOverride)
        }
    }

    public func setEnvironment(_ env: AppEnvironmentKind) { environment = env; updateBaseURL(); persist() }
public func setCustomBaseURL(_ s: String) { customBaseURLString = s; updateBaseURL(); persist() }
    public func setTenantId(_ id: String?) { tenantId = id; persist() }
    public func setTenantHostOverride(_ host: String?) {
        let trimmed = host?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            tenantHostOverride = nil
        } else {
            let lower = trimmed.lowercased()
            if lower.contains("localhost") || lower.hasSuffix(".local") || lower == "127.0.0.1" {
                tenantHostOverride = nil
            } else {
                tenantHostOverride = trimmed
            }
        }
        updateBaseURL(); persist()
    }

    private func updateBaseURL() {
        // Prefer tenant host override when present
        if let host = tenantHostOverride?.trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty {
            var comps = URLComponents();
            comps.scheme = "https";
            comps.host = host;
            if let url = comps.url {
                baseURL = url
                return
            }
        }
        baseURL = Self.computeBaseURL(env: environment, custom: customBaseURLString)
    }

    public static func computeBaseURL(env: AppEnvironmentKind, custom: String) -> URL {
        if env == .custom, let url = URL(string: custom), !custom.isEmpty { return url }
        switch env {
        case .production: return URL(string: "https://app.ordertech.me")!
        case .staging: return URL(string: "https://staging-api.ordertech.me")!
        case .custom: return URL(string: "http://localhost:8080")!
        }
    }

    public var wsBaseURL: URL {
        // Prefer tenant host override when present
        if let host = tenantHostOverride?.trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty {
            var comps = URLComponents();
            comps.scheme = "wss";
            comps.host = host;
            return comps.url ?? Self.computeWSBaseURL(env: environment, custom: customBaseURLString)
        }
        return Self.computeWSBaseURL(env: environment, custom: customBaseURLString)
    }
    public static func computeWSBaseURL(env: AppEnvironmentKind, custom: String) -> URL {
        // WebSocket should terminate at Admin origin for now
        switch env {
        case .production:
            // Keep WS on app host; activation HTTP is routed to console separately
            return URL(string: "wss://app.ordertech.me")!
        case .staging:
            return URL(string: "wss://staging.your-ordertech.example")!
        case .custom:
            // Derive from custom URL, switching scheme
            if let u = URL(string: custom), !custom.isEmpty {
                var comps = URLComponents(url: u, resolvingAgainstBaseURL: false) ?? URLComponents()
                comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
                return comps.url ?? URL(string: "ws://localhost:5050")!
            }
            return URL(string: "ws://localhost:5050")!
        }
    }

    public func makeHeaders(extra: [String:String] = [:]) -> [String:String] {
        var h = extra
        if let t = tenantId { h["x-tenant-id"] = t }
        if let d = deviceToken { h["x-device-token"] = d }
        h["accept"] = "application/json"
        return h
    }

private func persist() {
        UserDefaults.standard.set(environment.rawValue, forKey: Keys.environment)
        UserDefaults.standard.set(customBaseURLString, forKey: Keys.customBaseURL)
        UserDefaults.standard.set(tenantId, forKey: Keys.tenantId)
        UserDefaults.standard.set(tenantHostOverride, forKey: Keys.tenantHostOverride)
    }
}

// MARK: - HttpClient

public struct APIError: Error, LocalizedError {
    public let message: String
    public let code: Int?
    public var errorDescription: String? { message }
    public init(message: String, code: Int? = nil) { self.message = message; self.code = code }
}

@available(iOS 16.0, macOS 12.0, *)
    public final class HttpClient {
        public let env: EnvironmentStore
        private let session: URLSession
        public private(set) var lastResponseHeaders: [String:String] = [:]
        // Host fallback map disabled (try api.ordertech.me only)
        private let fallbackHostMap: [String:String] = [:]

    public init(env: EnvironmentStore) {
        self.env = env
        let cfg = URLSessionConfiguration.default
        cfg.requestCachePolicy = .useProtocolCachePolicy
        cfg.urlCache = URLCache.shared
        cfg.httpShouldUsePipelining = true
        self.session = URLSession(configuration: cfg)
    }

    public func request<T: Decodable>(_ path: String, method: String = "GET", headers: [String:String] = [:], body: Data? = nil, decode: T.Type = T.self, fresh: Bool = false) async throws -> T {
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathPart = String(parts.first ?? "")
        let queryPart = parts.count > 1 ? String(parts[1]) : nil

        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        if pathPart.hasPrefix("/") { comps.path = pathPart } else {
            let basePath = env.baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            comps.path = "/" + ([basePath, pathPart].filter{ !$0.isEmpty }.joined(separator: "/"))
        }
        if let q = queryPart, !q.isEmpty { comps.percentEncodedQuery = q }
        guard let primaryURL = comps.url else { throw APIError(message: "Invalid URL") }
        var req = URLRequest(url: primaryURL); req.httpMethod = method
        req.cachePolicy = fresh ? .reloadIgnoringLocalCacheData : .useProtocolCachePolicy
        var all = env.makeHeaders(extra: headers)
        if fresh {
            // Only force revalidation when explicitly requested
            all["Cache-Control"] = "no-cache"
            all["Pragma"] = "no-cache"
            all["x-fresh"] = "1"
        }
        if body != nil { all["content-type"] = "application/json" }
        for (k,v) in all { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = body

        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
            // Capture response headers for debugging
            var hdrs: [String:String] = [:]
            for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
            self.lastResponseHeaders = hdrs
            guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode) }
            if T.self == Empty.self { return Empty() as! T }
            return try JSONDecoder().decode(T.self, from: data)
        } catch let e as APIError {
            // Try path fallbacks for 404 (e.g., /api prefix) before host fallback
            if (e.code ?? 0) == 404, let variants = makeAlternatePathRequests(from: req), !variants.isEmpty {
                for v in variants {
                    do {
                        let (data, resp) = try await session.data(for: v)
                        guard let http = resp as? HTTPURLResponse else { continue }
                        var hdrs: [String:String] = [:]
                        for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
                        self.lastResponseHeaders = hdrs
                        if (200..<300).contains(http.statusCode) {
                            if T.self == Empty.self { return Empty() as! T }
                            return try JSONDecoder().decode(T.self, from: data)
                        }
                    } catch { /* try next */ }
                }
            }
            // Retry once with fallback host on SSL errors
            if shouldFallback(for: e, url: req.url), let alt = makeFallbackRequest(from: req) {
                let (data, resp) = try await session.data(for: alt)
                guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
                var hdrs: [String:String] = [:]
                for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
                self.lastResponseHeaders = hdrs
                guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode) }
                if T.self == Empty.self { return Empty() as! T }
                return try JSONDecoder().decode(T.self, from: data)
            }
            throw e
        } catch {
            // Non-API errors: attempt host fallback (e.g., SSL)
            if shouldFallback(for: error, url: req.url), let alt = makeFallbackRequest(from: req) {
                let (data, resp) = try await session.data(for: alt)
                guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
                var hdrs: [String:String] = [:]
                for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
                self.lastResponseHeaders = hdrs
                guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode) }
                if T.self == Empty.self { return Empty() as! T }
                return try JSONDecoder().decode(T.self, from: data)
            }
            throw error
        }
    }

    // Raw GET helper for diagnostics
    public func getRaw(_ path: String, fresh: Bool = false) async throws -> (Data, [String:String]) {
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathPart = String(parts.first ?? "")
        let queryPart = parts.count > 1 ? String(parts[1]) : nil

        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        if pathPart.hasPrefix("/") { comps.path = pathPart } else {
            let basePath = env.baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            comps.path = "/" + ([basePath, pathPart].filter{ !$0.isEmpty }.joined(separator: "/"))
        }
        if let q = queryPart, !q.isEmpty { comps.percentEncodedQuery = q }
        guard let url = comps.url else { throw APIError(message: "Invalid URL") }

        var req = URLRequest(url: url); req.httpMethod = "GET"
        req.cachePolicy = fresh ? .reloadIgnoringLocalCacheData : .useProtocolCachePolicy
        var all = env.makeHeaders()
        if fresh {
            all["Cache-Control"] = "no-cache"
            all["Pragma"] = "no-cache"
            all["x-fresh"] = "1"
        }
        for (k,v) in all { req.setValue(v, forHTTPHeaderField: k) }

        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
            var hdrs: [String:String] = [:]
            for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
            self.lastResponseHeaders = hdrs
            guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode) }
            return (data, hdrs)
        } catch let e as APIError {
            if (e.code ?? 0) == 404, let variants = makeAlternatePathRequests(from: req), !variants.isEmpty {
                for v in variants {
                    do {
                        let (data, resp) = try await session.data(for: v)
                        guard let http = resp as? HTTPURLResponse else { continue }
                        var hdrs: [String:String] = [:]
                        for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
                        self.lastResponseHeaders = hdrs
                        if (200..<300).contains(http.statusCode) { return (data, hdrs) }
                    } catch { /* try next */ }
                }
            }
            if shouldFallback(for: e, url: req.url), let alt = makeFallbackRequest(from: req) {
                let (data, resp) = try await session.data(for: alt)
                guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
                var hdrs: [String:String] = [:]
                for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
                self.lastResponseHeaders = hdrs
                guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode) }
                return (data, hdrs)
            }
            throw e
        } catch {
            if shouldFallback(for: error, url: req.url), let alt = makeFallbackRequest(from: req) {
                let (data, resp) = try await session.data(for: alt)
                guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
                var hdrs: [String:String] = [:]
                for (k,v) in http.allHeaderFields { hdrs[String(describing: k)] = String(describing: v) }
                self.lastResponseHeaders = hdrs
                guard (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode) }
                return (data, hdrs)
            }
            throw error
        }
    }

    public struct Empty: Decodable { public init() {} }

    private func shouldFallback(for error: Error, url: URL?) -> Bool {
        guard let host = url?.host, fallbackHostMap.keys.contains(host) else { return false }
        if let ue = error as? URLError { return ue.code == .secureConnectionFailed }
        // Some lower-level errors bubble up as NSError -1200
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain && ns.code == -1200
    }

    private func makeFallbackRequest(from req: URLRequest) -> URLRequest? {
        guard let u = req.url, let host = u.host, let altHost = fallbackHostMap[host] else { return nil }
        var comps = URLComponents(url: u, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.host = altHost
        guard let altURL = comps.url else { return nil }
        var alt = req
        alt.url = altURL
        print("[HttpClient] Fallback host: \(host) → \(altHost) for \(u.path)")
        return alt
    }

    private func makeAlternatePathRequests(from req: URLRequest) -> [URLRequest]? {
        guard let u = req.url else { return nil }
        var variants: [URLRequest] = []
        let path = u.path
        // Try prefixing /api if not present
        if !path.hasPrefix("/api/") {
            var c1 = URLComponents(url: u, resolvingAgainstBaseURL: false) ?? URLComponents()
            c1.path = "/api" + (path.hasPrefix("/") ? path : "/" + path)
            if let u1 = c1.url { var r = req; r.url = u1; variants.append(r) }
        }
        // Try prefixing /v1 if not present
        if !path.hasPrefix("/v1/") {
            var c2 = URLComponents(url: u, resolvingAgainstBaseURL: false) ?? URLComponents()
            c2.path = "/v1" + (path.hasPrefix("/") ? path : "/" + path)
            if let u2 = c2.url { var r = req; r.url = u2; variants.append(r) }
        }
        return variants
    }
}

// MARK: - WebSocket Message Priority System

// Message priority levels for efficient processing
enum MessagePriority: Int, Comparable {
    case critical = 0  // Process immediately (RTC, connection events)
    case high = 1      // Process within 10ms (basket updates)
    case normal = 2    // Process within 50ms (UI interactions)
    case low = 3       // Process within 200ms (poster updates, background)
    
    static func < (lhs: MessagePriority, rhs: MessagePriority) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

// Fast message priority detection based on message type
struct MessagePriorityDetector {
    static func detectPriority(for messageData: [String: Any]) -> MessagePriority {
        guard let type = messageData["type"] as? String else {
            return .low
        }
        
        switch type {
        case "rtc:status", "rtc:provider", "rtc:stopped", "rtc:offer", "rtc:heartbeat":
            return .critical  // Real-time RTC events
        case "peer:status", "session:started", "session:ended":
            return .critical  // Connection and session events
        case "basket:sync", "basket:update":
            return .high      // Business-critical data
        case "ui:selectCategory", "ui:showOptions", "ui:scrollTo", "ui:optionsClose":
            return .normal    // UI interactions
        case "poster:status", "error":
            return .low       // Background updates
        default:
            return .low       // Unknown messages get low priority
        }
    }
}

// MARK: - Enhanced WebSocket Manager

@available(iOS 16.0, macOS 12.0, *)
public final class WebSocketManager: NSObject, ObservableObject, URLSessionWebSocketDelegate {
    @Published public private(set) var isConnected: Bool = false
    public let events = PassthroughSubject<[String:Any], Never>()
    private var url: URL?
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private let env: EnvironmentStore
    
    // Phase B: Priority-based message processing
    private struct PrioritizedMessage {
        let data: [String: Any]
        let timestamp: Date
        let priority: MessagePriority
    }
    private var messageQueue: [PrioritizedMessage] = []
    private var processingTimer: Timer?
    private var batchedMessages: [[String: Any]] = []
    private var lastBatchProcessTime: Date = Date()
    
    // Phase A: Enhanced resilience
    private var pingTimer: Timer?
    private var reconnectWorkItem: DispatchWorkItem?
    private var backoffStep: Int = 0
    private let maxBackoffStep: Int = 5
    private var reconnectScheduled: Bool = false

    public init(env: EnvironmentStore) { self.env = env }

    public func connect() {
        var comps = URLComponents(url: env.wsBaseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.path = "/"
        guard let u = comps.url else { return }
        url = u
        backoffStep = 0
        openSocket()
    }
    
    private func openSocket() {
        guard let u = self.url else { return }
        reconnectWorkItem?.cancel(); reconnectWorkItem = nil; reconnectScheduled = false
        let cfg = URLSessionConfiguration.default
        let s = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session = s
        let t = s.webSocketTask(with: u)
        task = t; t.resume(); receiveLoop()
    }

    public func disconnect() { 
        task?.cancel(with: .goingAway, reason: nil)
        task = nil; session = nil; isConnected = false 
        invalidatePing()
        cancelReconnect()
        
        // Clean up priority processing
        processingTimer?.invalidate()
        processingTimer = nil
        messageQueue.removeAll()
        batchedMessages.removeAll()
    }

    public func send(json: [String:Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: json), let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                DispatchQueue.main.async { self.isConnected = false }
                self.invalidatePing()
                self.scheduleReconnect()
            case .success(let msg):
                switch msg {
                case .string(let str): 
                    self.enqueueIncomingMessage(text: str)
                case .data(let data): 
                    if let str = String(data: data, encoding: .utf8) {
                        self.enqueueIncomingMessage(text: str)
                    }
                @unknown default: break
                }
                DispatchQueue.main.async { self.isConnected = true }
            }
            self.receiveLoop()
        }
    }
    
    // Phase B: Enqueue and process messages by priority
    private func enqueueIncomingMessage(text: String) {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        
        let priority = MessagePriorityDetector.detectPriority(for: obj)
        let pm = PrioritizedMessage(data: obj, timestamp: Date(), priority: priority)
        
        messageQueue.append(pm)
        messageQueue.sort { $0.priority < $1.priority }
        
        scheduleProcessingTimer()
    }
    
    private func scheduleProcessingTimer() {
        DispatchQueue.main.async {
            self.processingTimer?.invalidate()
            self.processingTimer = nil
            
            // Process frequently but not more than once per runloop
            let timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: false) { [weak self] _ in
                self?.drainMessageQueue()
            }
            self.processingTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }
    
    private func drainMessageQueue() {
        let now = Date()
        
        for message in messageQueue {
            switch message.priority {
            case .critical:
                events.send(message.data)
            case .high:
                events.send(message.data)
            case .normal:
                events.send(message.data)
            case .low:
                batchedMessages.append(message.data)
            }
        }
        
        messageQueue.removeAll()
        
        // Flush low-priority batch every 200ms or if large enough
        if now.timeIntervalSince(lastBatchProcessTime) > 0.2 || batchedMessages.count > 10 {
            for messageData in batchedMessages {
                events.send(messageData)
            }
            batchedMessages.removeAll(keepingCapacity: true)
            lastBatchProcessTime = now
        }
    }

    // URLSessionWebSocketDelegate
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) { 
        DispatchQueue.main.async { self.isConnected = true }
        backoffStep = 0
        startPing()
    }
    
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) { 
        DispatchQueue.main.async { self.isConnected = false }
        invalidatePing()
        scheduleReconnect()
    }
    
    // MARK: - Phase A: Resilience helpers
    private func startPing() {
        DispatchQueue.main.async {
            self.pingTimer?.invalidate(); self.pingTimer = nil
            // Send WebSocket ping every 10 seconds to keep connection alive
            // This works in conjunction with presence pings (15s) for dual-layer keep-alive
            let t = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
                guard let self = self, let task = self.task else { return }
                task.sendPing { [weak self] error in
                    if error != nil {
                        self?.scheduleReconnect()
                    }
                }
            }
            self.pingTimer = t
            RunLoop.main.add(t, forMode: .common)
        }
    }
    
    private func invalidatePing() {
        DispatchQueue.main.async {
            self.pingTimer?.invalidate(); self.pingTimer = nil
        }
    }
    
    private func scheduleReconnect() {
        guard !reconnectScheduled else { return }
        reconnectScheduled = true
        let delay = backoffDelay(step: backoffStep)
        backoffStep = min(backoffStep + 1, maxBackoffStep)
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.openSocket()
        }
        reconnectWorkItem?.cancel()
        reconnectWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }
    
    private func cancelReconnect() {
        reconnectWorkItem?.cancel(); reconnectWorkItem = nil; reconnectScheduled = false
    }
    
    private func backoffDelay(step: Int) -> TimeInterval {
        // 0, 0.3, 0.7, 1.5, 3.0, 5.0 (cap), with ±25% jitter
        let table: [TimeInterval] = [0.0, 0.3, 0.7, 1.5, 3.0, 5.0]
        let base = table[min(step, table.count - 1)]
        let jitter = base * 0.25
        let r = Double.random(in: -jitter...jitter)
        return max(0.0, base + r)
    }
}

// MARK: - Keychain helpers (very small)

private func getKeychain(_ key: String) -> String? {
    let query: [String:Any] = [kSecClass as String: kSecClassGenericPassword,
                               kSecAttrService as String: "OrderTechCore",
                               kSecAttrAccount as String: key,
                               kSecReturnData as String: true]
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    guard status == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}

private func setKeychain(_ value: String?, key: String) {
    let base: [String:Any] = [kSecClass as String: kSecClassGenericPassword,
                              kSecAttrService as String: "OrderTechCore",
                              kSecAttrAccount as String: key]
    SecItemDelete(base as CFDictionary)
    guard let value else { return }
    var toAdd = base; toAdd[kSecValueData as String] = Data(value.utf8)
    SecItemAdd(toAdd as CFDictionary, nil)
}
