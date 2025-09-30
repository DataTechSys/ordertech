import Foundation
import SwiftUI
import OrderTechCore

struct ActivationInfo: Codable {
    let tenantId: String
    let companyName: String?
    let branchName: String?
    let displayName: String?
    let tenantShortId: String?
    let activatedAt: Date
    let expiresAt: Date
}

@MainActor
final class ActivationManager: ObservableObject {
    @Published private(set) var info: ActivationInfo? = nil
    private var expiryTimer: Timer?

    private let activationFilename = "activation.json"

    func start(env: EnvironmentStore, app: AppModel) {
        // Load cached activation info
        if let loaded: ActivationInfo = try? LocalCache.loadJSON(ActivationInfo.self, from: activationFilename) {
            self.info = loaded
        }
        // Refresh from server first, then enforce expiry using fresh data
        Task {
            await self.updateFromManifest(env: env, app: app)
            await MainActor.run { self.checkAndEnforceExpiry(env: env) }
        }
        // Ensure daily check if token exists
        if env.deviceToken != nil { scheduleDailyExpiryCheck(env: env, app: app) }
    }

    func stop() {
        expiryTimer?.invalidate(); expiryTimer = nil
    }

    func tokenChanged(env: EnvironmentStore, app: AppModel) {
        if env.deviceToken == nil {
            // On deactivation, stop timers and clear cached activation/tenant info so UI stays empty until admin import
            stop()
            _ = try? LocalCache.delete("activation.json")
            _ = try? LocalCache.delete("tenant.json")
            self.info = nil
        } else {
            // Treat as a fresh activation: drop any stale cached info to avoid carrying old expiry
            _ = try? LocalCache.delete("activation.json")
            self.info = nil
            Task { await updateFromManifest(env: env, app: app) }
            scheduleDailyExpiryCheck(env: env, app: app)
        }
    }

    func updateAfterActivation(env: EnvironmentStore, app: AppModel) async {
        // Called immediately after activation claim
        await updateFromManifest(env: env, app: app)
        scheduleDailyExpiryCheck(env: env, app: app)
    }

    private func scheduleDailyExpiryCheck(env: EnvironmentStore, app: AppModel) {
        expiryTimer?.invalidate(); expiryTimer = nil
        let t = Timer.scheduledTimer(withTimeInterval: 24 * 60 * 60, repeats: true) { [weak self] _ in
            Task {
                guard let self = self else { return }
                // Refresh details from Admin in case expiry was extended/shortened
                await self.updateFromManifest(env: env, app: app)
                await MainActor.run { self.checkAndEnforceExpiry(env: env) }
            }
        }
        expiryTimer = t
        RunLoop.main.add(t, forMode: .common)
    }

    private func checkAndEnforceExpiry(env: EnvironmentStore) {
        guard let i = info else { return }
        let now = Date()
        if now >= i.expiresAt {
            print("[Activation] Activation expired on \(i.expiresAt); clearing token")
            env.deviceToken = nil
        }
    }

    func updateFromManifest(env: EnvironmentStore, app: AppModel) async {
        do {
            let http = HttpClient(env: env)
            // Ensure tenant association if missing and token present
            if (env.tenantId ?? "").isEmpty, (env.deviceToken ?? "").isEmpty == false {
                struct Assoc: Decodable { let tenant_id: String? }
                // Try API host first
                if let assoc: Assoc = try? await http.request("/ws/associate", method: "POST"), let tid = assoc.tenant_id, !tid.isEmpty {
                    env.setTenantId(tid)
                } else {
                    // Fallback to WS host over HTTPS
if let tid = await self.associateViaWSHost(env: env) { env.setTenantId(tid) }
                }
            }

            let data: Data
            do {
                let tuple = try await http.getRaw("/manifest", fresh: true)
                data = tuple.0
            } catch {
                data = try await getManifestManual(env: env)
            }
            let parsed = try? JSONSerialization.jsonObject(with: data, options: [])
            let base = extractDetails(from: parsed)
            // Start with manifest-provided values
            var companyName = base.companyName
            var displayName = base.displayName
            var branchName = base.branchName
            var shortId = base.shortId
            var expiresFromServer = base.expiresAt

            // Fallback: if display name missing, fetch /device/profile
            if displayName == nil || displayName!.isEmpty {
                if let prof: DeviceProfile = try? await http.fetchDeviceProfile() {
                    if let dn = prof.display_name?.trimmingCharacters(in: .whitespacesAndNewlines), !dn.isEmpty { displayName = dn }
                    if (branchName == nil || branchName!.isEmpty), let br = prof.branch?.trimmingCharacters(in: .whitespacesAndNewlines), !br.isEmpty { branchName = br }
                    if shortId == nil, let sc = prof.short_code?.trimmingCharacters(in: .whitespacesAndNewlines) {
                        let digits = sc.filter { $0.isNumber }; if digits.count == 6 { shortId = digits }
                    }
                }
            }

            // Resolve tenant host from short code if we don't have one yet
            if (env.tenantHostOverride ?? "").isEmpty, let short = shortId, !short.isEmpty {
                struct DomainResp: Decodable { let host: String?; let suggestion: String? }
                if let mapping: DomainResp = try? await http.request("/tenant/by-code/\(short)/domain", fresh: true) {
                    let host = (mapping.host ?? mapping.suggestion)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    // Ignore localhost/.local suggestions to avoid unreachable hosts in production builds
                    let lower = host.lowercased()
                    let isInvalid = lower.contains("localhost") || lower.hasSuffix(".local") || lower == "127.0.0.1"
                    if !host.isEmpty && !isInvalid { env.setTenantHostOverride(host) }
                }
            }

            // Use current time as activation date whenever info is missing (fresh activation) or token just changed.
            let activatedAt = Date()
            // Default expiry is 1 week from now if server doesn't provide one
            let defaultExpiry = Calendar.current.date(byAdding: .day, value: 7, to: activatedAt) ?? activatedAt.addingTimeInterval(7*24*60*60)
            // If Admin provides an explicit expiry, honor it; otherwise default to 7 days from now
            let expiresAt = expiresFromServer ?? defaultExpiry

            let tenantId = env.tenantId ?? ""
            let info = ActivationInfo(
                tenantId: tenantId,
                companyName: companyName,
                branchName: branchName,
                displayName: displayName,
                tenantShortId: shortId,
                activatedAt: activatedAt,
                expiresAt: expiresAt
            )
            self.info = info
            _ = try? LocalCache.saveJSON(info, to: activationFilename)

            // Update AppModel local fields for UI consistency
            if let dn = displayName, !dn.isEmpty { app.friendlyName = dn; UserDefaults.standard.set(dn, forKey: "OT.display.friendlyName") }
            if let br = branchName, !br.isEmpty { app.branchName = br; UserDefaults.standard.set(br, forKey: "OT.display.branchName") }

            // Persist minimal tenant.json for quick access elsewhere
            if !tenantId.isEmpty {
                // Persist only server-provided display name; keep it empty until data is imported post-activation
let tinfo = TenantInfo(tenant_id: tenantId, branch: (branchName ?? app.branchName), display_name: displayName)
                _ = try? LocalCache.saveJSON(tinfo, to: "tenant.json")
            }
        } catch {
            print("[Activation] updateFromManifest failed: \(error.localizedDescription)")
            // On failure do not persist tenant defaults; keep empty
        }
    }

    private func extractDetails(from obj: Any?) -> (companyName: String?, displayName: String?, branchName: String?, shortId: String?, expiresAt: Date?) {
        guard let dict = obj as? [String: Any] else { return (nil, nil, nil, nil, nil) }
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
        // Prefer device name from Admin profile; accept common variants
        // Break up complex nil-coalescing chain to help the compiler
        let displayName: String? = {
            let candidates: [String?] = [
                nonEmpty(profile?["display_name"]),
                nonEmpty(profile?["name"]),
                nonEmpty(profile?["device_name"]),
                nonEmpty(profile?["deviceName"]),
                nonEmpty(dict["display_name"]),
                nonEmpty(dict["name"]),
                nonEmpty(dict["device_name"]),
                nonEmpty(dict["deviceName"])
            ]
            return candidates.compactMap { $0 }.first
        }()
        let branchName = nonEmpty(profile?["branch"]) ?? nil
        let shortId = onlyDigits6(nonEmpty(profile?["short_code"]) ?? nonEmpty(brand?["short_code"]) ?? nonEmpty(brand?["code"]))

        // Try to find an expiry in common fields
        let expiryCandidates: [Any?] = [
            profile?["activation_expires_at"], profile?["activationExpiry"], profile?["expires_at"], profile?["expiry"], dict["activation_expires_at"], dict["expires_at"], brand?["activation_expires_at"], brand?["expires_at"]
        ]
        var expiresAt: Date? = nil
        for c in expiryCandidates {
            if let d = parseDate(c) { expiresAt = d; break }
        }
        return (companyName, displayName, branchName, shortId, expiresAt)
    }

    private func parseDate(_ any: Any?) -> Date? {
        if let s = any as? String {
            // Try multiple formats
            let iso1 = ISO8601DateFormatter()
            iso1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let d = iso1.date(from: s) { return d }
            let iso2 = ISO8601DateFormatter()
            iso2.formatOptions = [.withInternetDateTime]
            if let d = iso2.date(from: s) { return d }
            // Try simple yyyy-MM-dd
            let fmt = DateFormatter()
            fmt.locale = Locale(identifier: "en_US_POSIX")
            fmt.dateFormat = "yyyy-MM-dd"
            if let d = fmt.date(from: s) { return d }
        } else if let n = any as? NSNumber {
            let t = n.doubleValue
            if t > 10_000_000 { return Date(timeIntervalSince1970: t) }
        } else if let d = any as? Double {
            if d > 10_000_000 { return Date(timeIntervalSince1970: d) }
        } else if let i = any as? Int {
            if i > 10_000_000 { return Date(timeIntervalSince1970: Double(i)) }
        }
        return nil
    }

    private func getManifestManual(env: EnvironmentStore) async throws -> Data {
        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.path = "/manifest"
        guard let url = comps.url else { throw APIError(message: "invalid_url") }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if let tid = env.tenantId { req.setValue(tid, forHTTPHeaderField: "x-tenant-id") }
        if let tok = env.deviceToken {
            req.setValue(tok, forHTTPHeaderField: "x-device-token")
            req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
            req.setValue(tok, forHTTPHeaderField: "x-display-token")
        }
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)") }
        return data
    }

    private func associateViaWSHost(env: EnvironmentStore) async -> String? {
        // Force using app host for now to avoid TLS issues on console
        guard let url = URL(string: "https://app.ordertech.me/ws/associate") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token = env.deviceToken { req.setValue(token, forHTTPHeaderField: "x-device-token") }
        req.setValue("application/json", forHTTPHeaderField: "accept")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            struct Assoc: Decodable { let tenant_id: String? }
            if let assoc = try? JSONDecoder().decode(Assoc.self, from: data),
               let tid = assoc.tenant_id,
               !tid.isEmpty {
                return tid
            }
            return nil
        } catch {
            return nil
        }
    }
}
