import Foundation
import Combine
import OrderTechCore

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

    private let env: EnvironmentStore
    private let http: HttpClient
    private let ws: WebSocketManager
    private var bag = Set<AnyCancellable>()
    private var presenceTimer: Timer?

    #if canImport(WebRTC)
    @Published var webRTCService = WebRTCService()
    #endif
    private var p2p: RTCProvider? = nil

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
                    // Reset hello sentinel when disconnected
                    self.didSendHello = false
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
            await MainActor.run {
                // WS connect
                print("[Display] WS connect → base=\(self.env.baseURL.absoluteString) wsBase=\(self.env.wsBaseURL.absoluteString)")
                self.ws.connect()
                // Presence heartbeat only after HTTP is ready
                self.reschedulePresenceTimer()
            }
        }
    }

    private func ensureTenantIfPossible() async {
        guard (env.deviceToken ?? "").isEmpty == false else { return }
        struct Assoc: Decodable { let tenant_id: String? }

        // Preferred: try on API host first (proxy/local aware)
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
                if (200..<300).contains(httpResp.statusCode) {
                    if let assoc = try? JSONDecoder().decode(Assoc.self, from: data), let tid = assoc.tenant_id, !tid.isEmpty {
                        await MainActor.run { env.setTenantId(tid) }
                        print("[Display] ensure-tenant(api1): associated tenant_id=\(tid)")
                        return
                    } else {
                        print("[Display] ensure-tenant(api1): no tenant_id returned")
                    }
                } else if httpResp.statusCode == 404 {
                    print("[Display] ensure-tenant(api1): 404 — endpoint missing; will try WS host")
                } else if httpResp.statusCode == 401 || httpResp.statusCode == 403 {
                    print("[Display] ensure-tenant(api1): unauthorized (\(httpResp.statusCode)) — will validate via /manifest (no clear)")
                } else {
                    print("[Display] ensure-tenant(api1): HTTP \(httpResp.statusCode)")
                }
            }
        } catch {
            // ignore; proceed to WS host fallback
        }

        // Fallback: app host (console). Do NOT clear token on 401 for local/proxy tokens.
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
                        } else {
                            print("[Display] ensure-tenant(app): no tenant_id returned")
                        }
                    } else if httpResp.statusCode == 401 || httpResp.statusCode == 403 {
                        print("[Display] ensure-tenant(app): unauthorized (\(httpResp.statusCode)) — ignoring for local/proxy tokens")
                    } else {
                        print("[Display] ensure-tenant(app): HTTP \(httpResp.statusCode)")
                    }
                }
            }
        } catch {
            // ignore
        }

        // Fallback: try on WS base URL (variants). No destructive clears.
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
        presenceTimer?.invalidate(); presenceTimer = nil
        ws.disconnect()
        p2p?.stop(); p2p = nil
    }

    private func onWSOpen() {
        // subscribe + hello(role=display)
        print("[Display] onWSOpen: subscribe + hello; basketId=\(deviceId) name=\(friendlyName)")
        ws.send(json: ["type": "subscribe", "basketId": deviceId])
        var hello: [String: Any] = ["type": "hello", "basketId": deviceId, "role": "display", "name": friendlyName]
        hello["device_id"] = deviceId
        if let tok = env.deviceToken, !tok.isEmpty { hello["token"] = tok }
        ws.send(json: hello)
    }

    private func handle(event: [String: Any]) {
        let type = (event["type"] as? String) ?? ""
        print("[Display] WS event: \(type)")
        switch type {
        case "peer:status":
            let status = (event["status"] as? String) ?? ""
            peersConnected = (status == "connected")
        case "rtc:status":
            lastRtcStatusAt = Date()
        case "rtc:provider":
            handleRTCProvider(event)
        case "rtc:stopped":
            p2p?.stop(); p2p = nil
        case "basket:sync", "basket:update":
            applyBasket(event)
        case "session:started":
            // new session clears basket/preview
            basketLines = []
            basketTotals = .zero
            preview = nil
        case "session:paid", "session:ended":
            // show poster: thank you / please drive forward — leave totals briefly (handled in UI later)
            break
        case "ui:showPreview":
            applyPreview(event)
        case "ui:selectCategory", "ui:showOptions":
            // Optional: could add subtle UI hints
            break
        case "poster:start":
            applyPoster(event, start: true)
        case "poster:stop":
            applyPoster(event, start: false)
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
        guard httpReady else { return }
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
                let id = (raw["id"] as? String)
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
                lines.append(BasketLineUI(id: id, name: name, qty: qty, lineTotal: total, options: options))
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

    private func handleRTCProvider(_ ev: [String: Any]) {
        let provider = (ev["provider"] as? String)?.lowercased() ?? ""
        let id = deviceId
        switch provider {
        case "p2p":
            #if canImport(WebRTC)
            if p2p == nil {
                p2p = P2PRTC(pairId: id, http: http, webRTCService: webRTCService)
            }
            Task { try? await p2p?.start(pairId: id) }
            #else
            break
            #endif
        case "off", "stopped":
            p2p?.stop(); p2p = nil
        default:
            break
        }
    }
}
