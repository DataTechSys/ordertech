import Foundation

// MARK: - Backend DTOs

struct AssociationResponse: Decodable {
    let device_id: String?
    let id: String?
    let branch_id: String?
    let branch: String?
    let tenant_id: String?
}

struct DisplayPresenceItem: Decodable, Identifiable {
    let id: String
    let name: String?
    let branch_id: String?
    let branch: String?
    let online: Bool?
    let connected: Bool?
    let session_id: String?
    let busy: Bool?
    let last_seen: String?
}

struct PresenceList: Decodable { let items: [DisplayPresenceItem]? }

struct ICECredential: Decodable {
    let urls: [String]
    let username: String?
    let credential: String?
}

struct SFUConfig: Decodable {
    let enabled: Bool?
    let defaultProvider: String?
    let fallbackOrder: [String]?
}

struct RTCConfig: Decodable {
    let iceServers: [ICECredential]?
    let twilioServers: [ICECredential]?
    let selfServers: [ICECredential]?
    let sfu: SFUConfig?
}

struct RTCAuthToken: Decodable { let token: String?; let url: String? }
struct AnswerResponse: Decodable { let sdp: String? }
struct CandidatesResponse: Decodable { let items: [RTCIceCandidateJSON]? }

struct RTCIceCandidateJSON: Codable {
    let candidate: String?
    let sdpMid: String?
    let sdpMLineIndex: Int?
}

// MARK: - Subscription
struct SubscriptionResponse: Decodable { let state: String?; let expires_at: String?; let grace_until: String?; let message: String? }

// MARK: - Device pairing (activation)

// Activation for Cashier now uses ActivationAPI (fixed host) instead of generic HttpClient.
struct DevicePairCodeResponse: Decodable { let code: String; let expires_at: String? }
struct DevicePairStatus: Decodable { let status: String; let device_token: String?; let tenant_id: String? }

// MARK: - HttpClient Endpoints

// MARK: - Fixed-host Activation API (app.ordertech.me)
struct ActivationAPI {
    struct CodeResponse: Decodable { let code: String; let expires_at: String? }
    struct StatusResponse: Decodable { let status: String?; let device_token: String?; let tenant_id: String?; let role: String? }
    struct BrandResponse: Decodable { let display_name: String?; let logo_url: String? }
    static let base = URL(string: "https://app.ordertech.me")!

    // Optional legacy generator (not used in Cashier now)
    static func createPairCode() async throws -> CodeResponse {
        let url = URL(string: base.absoluteString + "/device/pair/new")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(message: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)")
        }
        return try JSONDecoder().decode(CodeResponse.self, from: data)
    }

    // Claim/register on app host. Returns token/tenantId if server responds directly.
    static func claimOrRegister(companyId: String, code: String, role: String) async throws -> (token: String, tenantId: String)? {
        let paths = [
            "/device/pair/register",
            "/api/device/pair/register",
            "/device/pair/activate",
            "/api/device/pair/activate"
        ]
        for path in paths {
            guard let url = URL(string: base.absoluteString + path) else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json", forHTTPHeaderField: "accept")
            // For /register use tenant_id only in body (server returns 500 if header is present)
            if path.hasSuffix("/register") == false {
                req.setValue(companyId, forHTTPHeaderField: "x-tenant-id")
            }
            struct ActivateReq: Encodable { let code: String; let role: String }
            struct RegisterReq: Encodable { let code: String; let role: String; let tenant_id: String }
            if path.hasSuffix("/register") {
                req.httpBody = try? JSONEncoder().encode(RegisterReq(code: code, role: role, tenant_id: companyId))
            } else {
                req.httpBody = try? JSONEncoder().encode(ActivateReq(code: code, role: role))
            }
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                if let http = resp as? HTTPURLResponse {
                    #if DEBUG
                    let snippet = String(data: data.prefix(160), encoding: .utf8) ?? "<non-utf8>"
                    print("[Activation][claim] path=\(path) status=\(http.statusCode) body=\(snippet)")
                    #endif
                    if (200..<300).contains(http.statusCode) {
                        if let obj = try? JSONDecoder().decode(StatusResponse.self, from: data),
                           let tok = obj.device_token, !tok.isEmpty,
                           let tid = obj.tenant_id, !tid.isEmpty {
                            return (tok, tid)
                        }
                    }
                }
            } catch {
                #if DEBUG
                print("[Activation][claim] path=\(path) error=\(error.localizedDescription)")
                #endif
                // try next variant
            }
        }
        return nil
    }

    // Poll status on app host with x-tenant-id header
    static func pairStatus(code: String, companyId: String) async throws -> StatusResponse {
        let cleanedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let paths = ["/device/pair/\(cleanedCode)/status", "/api/device/pair/\(cleanedCode)/status"]
        // First try with x-tenant-id header
        for path in paths {
            guard let url = URL(string: base.absoluteString + path) else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue(companyId, forHTTPHeaderField: "x-tenant-id")
            req.setValue("application/json", forHTTPHeaderField: "accept")
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                if let http = resp as? HTTPURLResponse {
                    #if DEBUG
                    let snippet = String(data: data.prefix(160), encoding: .utf8) ?? "<non-utf8>"
                    print("[Activation][status+tenant] path=\(path) status=\(http.statusCode) body=\(snippet)")
                    #endif
                    if (200..<300).contains(http.statusCode) {
                        if let obj = try? JSONDecoder().decode(StatusResponse.self, from: data) { return obj }
                    }
                }
            } catch {
                #if DEBUG
                print("[Activation][status+tenant] path=\(path) error=\(error.localizedDescription)")
                #endif
                // try next
            }
        }
        // Fallback: try without x-tenant-id header
        for path in paths {
            guard let url = URL(string: base.absoluteString + path) else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue("application/json", forHTTPHeaderField: "accept")
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                if let http = resp as? HTTPURLResponse {
                    #if DEBUG
                    let snippet = String(data: data.prefix(160), encoding: .utf8) ?? "<non-utf8>"
                    print("[Activation][status] path=\(path) status=\(http.statusCode) body=\(snippet)")
                    #endif
                    if (200..<300).contains(http.statusCode) {
                        if let obj = try? JSONDecoder().decode(StatusResponse.self, from: data) { return obj }
                    }
                }
            } catch {
                #if DEBUG
                print("[Activation][status] path=\(path) error=\(error.localizedDescription)")
                #endif
                // try next
            }
        }
        throw APIError(message: "activation_status_unreachable")
    }

    // Pre-activation brand fetch using tenant short ID (Company ID) on fixed host
    static func fetchBrand(companyId: String) async throws -> BrandResponse {
        let clean = companyId.filter { $0.isNumber }
        guard let url = URL(string: base.absoluteString + "/brand") else { throw APIError(message: "invalid_url") }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue(clean, forHTTPHeaderField: "x-tenant-id")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(message: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)")
        }
        return try JSONDecoder().decode(BrandResponse.self, from: data)
    }
}

// MARK: - Post-claim flow: resolve domain and import manifest
struct ActivationFlow {
    static func postClaim(env: EnvironmentStore, tenantId: String?) async {
        guard let tid = tenantId, !tid.isEmpty else { return }
        // Resolve tenant host
        let currentHost = await env.tenantHost
        if (currentHost ?? "").isEmpty {
            if let host = await resolveHostByTenantId(tenantId: tid) {
                await MainActor.run { env.tenantHost = host }
                try? await Task.sleep(nanoseconds: 150_000_000)
            }
        }
        // Fetch manifest and persist details
        await importManifest(env: env)
        await MainActor.run { env.reloadAppData() }
    }
    private static func resolveHostByTenantId(tenantId: String) async -> String? {
        guard let url = URL(string: "https://app.ordertech.me/tenant/\(tenantId)/domain") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "accept")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            struct DomainResp: Decodable { let host: String?; let suggestion: String? }
            if let d = try? JSONDecoder().decode(DomainResp.self, from: data) {
                return (d.host ?? d.suggestion)
            }
            return nil
        } catch {
            return nil
        }
    }
    private static func importManifest(env: EnvironmentStore) async {
        let client = HttpClient(env: env)
        do {
            let (data, _) = try await client.getRaw("/manifest", fresh: true)
            let parsed = try? JSONSerialization.jsonObject(with: data, options: [])
            let details = extractDetails(from: parsed)
            let tid = await env.tenantId ?? ""
            let info = ActivationDetails(
                tenantId: tid,
                companyName: details.companyName,
                branchName: details.branchName,
                deviceName: details.displayName,
                shortId: details.shortId
            )
            await MainActor.run { env.activationInfo = info }
        } catch {
            // Non-fatal
        }
    }
    private static func extractDetails(from obj: Any?) -> (companyName: String?, displayName: String?, branchName: String?, shortId: String?) {
        guard let dict = obj as? [String: Any] else { return (nil, nil, nil, nil) }
        let profile = dict["profile"] as? [String: Any]
        let brand = dict["brand"] as? [String: Any]
        func nonEmpty(_ s: Any?) -> String? {
            guard let s = s as? String else { return nil }
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        func onlyDigits6(_ s: String?) -> String? {
            guard let s = s else { return nil }
            let d = s.filter { $0.isNumber }
            return d.count == 6 ? d : nil
        }
        let companyName = nonEmpty(profile?["tenant_name"]) ?? nonEmpty(brand?["display_name"]) ?? nonEmpty(brand?["name"]) ?? nonEmpty(dict["tenant_name"]) ?? nil
        let displayName = nonEmpty(profile?["display_name"]) ?? nonEmpty(dict["display_name"]) ?? nil
        let branchName = nonEmpty(profile?["branch"]) ?? nonEmpty(dict["branch"]) ?? nil
        let shortId = onlyDigits6(nonEmpty(profile?["short_code"]) ?? nonEmpty(brand?["short_code"]) ?? nonEmpty(brand?["code"]))
        return (companyName, displayName, branchName, shortId)
    }
}

extension HttpClient {
    // Association and presence
    func associate() async throws -> AssociationResponse { try await request("/ws/associate", method: "POST") }
    func presenceDisplays() async throws -> [DisplayPresenceItem] {
        let list: PresenceList = try await request("/presence/displays")
        return list.items ?? []
    }

    // Device pairing moved to ActivationAPI

    // Session actions
    @discardableResult
    func sessionStart(pairId: String) async throws -> Empty {
        try await request("/session/start?pairId=\(pairId)", method: "POST", decode: Empty.self)
    }

    @discardableResult
    func sessionReset(pairId: String) async throws -> Empty {
        try await request("/session/reset?pairId=\(pairId)", method: "POST", decode: Empty.self)
    }

    @discardableResult
    func sessionPay(pairId: String) async throws -> Empty {
        try await request("/session/pay?pairId=\(pairId)", method: "POST", decode: Empty.self)
    }

    // Poster
    @discardableResult
    func posterStart(pairId: String) async throws -> Empty {
        try await request("/poster/start?pairId=\(pairId)", method: "POST", decode: Empty.self)
    }

    @discardableResult
    func posterStop(pairId: String) async throws -> Empty {
        try await request("/poster/stop?pairId=\(pairId)", method: "POST", decode: Empty.self)
    }

    // WebRTC config and signaling
    func getWebRTCConfig() async throws -> RTCConfig { try await request("/webrtc/config") }

    @discardableResult
    func postOffer(pairId: String, sdp: String) async throws -> Empty {
        struct Body: Encodable { let pairId: String; let sdp: String }
        let body = try JSONEncoder().encode(Body(pairId: pairId, sdp: sdp))
        return try await request("/webrtc/offer", method: "POST", body: body, decode: Empty.self)
    }

    func getAnswer(pairId: String) async throws -> AnswerResponse { try await request("/webrtc/answer?pairId=\(pairId)") }

    @discardableResult
    func postCandidate(pairId: String, role: String, candidate: RTCIceCandidateJSON) async throws -> Empty {
        struct Body: Encodable { let pairId: String; let role: String; let candidate: RTCIceCandidateJSON }
        let body = try JSONEncoder().encode(Body(pairId: pairId, role: role, candidate: candidate))
        return try await request("/webrtc/candidate", method: "POST", body: body, decode: Empty.self)
    }

    func getCandidates(pairId: String, role: String) async throws -> CandidatesResponse {
        try await request("/webrtc/candidates?pairId=\(pairId)&role=\(role)")
    }

    // Subscription status
    func fetchSubscription() async throws -> SubscriptionResponse {
        let tid = await env.tenantId ?? ""
        return try await request("/tenant/\(tid)/subscription")
    }

    // SFU tokens
    func deleteRTCSession(pairId: String, reason: String? = nil) async throws -> Empty {
        let suffix = (reason?.isEmpty == false) ? "?reason=\(reason!)" : ""
        return try await request("/webrtc/session/\(pairId)\(suffix)", method: "DELETE", decode: Empty.self)
    }

    // SFU tokens
    func rtcToken(provider: String, basketId: String, role: String) async throws -> RTCAuthToken {
        struct Body: Encodable { let provider: String; let basketId: String; let role: String }
        let body = try JSONEncoder().encode(Body(provider: provider, basketId: basketId, role: role))
        return try await request("/rtc/token", method: "POST", body: body)
    }
}

