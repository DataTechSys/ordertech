import Foundation
import SwiftUI

// Details persisted after activation to show company/branch/device assignment
struct ActivationDetails: Codable {
    let tenantId: String
    let companyName: String?
    let branchName: String?
    let deviceName: String?
    let shortId: String?
}

// MARK: - Subscription types (co-located to ensure target inclusion)

enum SubscriptionState: String {
    case active
    case grace
    case expired
    case suspended
    case unknown

    var isBlocking: Bool { self == .expired || self == .suspended }
    var isGrace: Bool { self == .grace }
}

@MainActor
final class SubscriptionManager: ObservableObject {
    @Published private(set) var state: SubscriptionState = .unknown
    @Published private(set) var message: String? = nil
    @Published private(set) var expiresAt: Date? = nil
    @Published private(set) var graceUntil: Date? = nil
    private var lastCheckedAt: Date? = nil

    func refresh(env: EnvironmentStore) async {
        guard (env.tenantId ?? "").isEmpty == false, (env.deviceToken ?? "").isEmpty == false else {
            state = .unknown; message = nil; expiresAt = nil; graceUntil = nil; return
        }
        do {
            let info = try await HttpClient(env: env).fetchSubscription()
            apply(resp: info)
            lastCheckedAt = Date()
        } catch {
            // Keep previous state
        }
    }

    func clear() { state = .unknown; message = nil; expiresAt = nil; graceUntil = nil }

    private func apply(resp: SubscriptionResponse) {
        let st = (resp.state ?? "").lowercased()
        switch st {
        case "active": state = .active
        case "grace": state = .grace
        case "expired": state = .expired
        case "suspended": state = .suspended
        default: state = .unknown
        }
        message = resp.message
        expiresAt = parseISO(resp.expires_at)
        graceUntil = parseISO(resp.grace_until)
    }
}

private func parseISO(_ s: String?) -> Date? {
    guard let s = s, !s.isEmpty else { return nil }
    let iso1 = ISO8601DateFormatter(); iso1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = iso1.date(from: s) { return d }
    let iso2 = ISO8601DateFormatter(); iso2.formatOptions = [.withInternetDateTime]
    if let d = iso2.date(from: s) { return d }
    let fmt = DateFormatter(); fmt.locale = Locale(identifier: "en_US_POSIX"); fmt.dateFormat = "yyyy-MM-dd"
    return fmt.date(from: s)
}

@MainActor
final class EnvironmentStore: ObservableObject {
    @Published var environment: AppEnvironment = .staging {
        didSet { updateBaseURL(); persist() }
    }
    @Published var customBaseURLString: String = "" {
        didSet { updateBaseURL(); persist() }
    }
    @Published private(set) var baseURL: URL = AppEnvironment.production.defaultBaseURL
    @Published var tenantId: String? = nil {
        didSet { persist() }
    }
    @Published var deviceToken: String? = nil {
        didSet { KeychainStore.standard.set(deviceToken, key: Keys.deviceToken) }
    }
    @Published var requireActivation: Bool = true {
        didSet { persist() }
    }
    // Manual reload trigger for views to observe
    @Published var reloadCounter: Int = 0

    private struct Keys {
        static let environment = "Env.environment"
        static let customBaseURL = "Env.customBaseURL"
        static let tenantId = "Env.tenantId"
        static let deviceToken = "Env.deviceToken"
        static let requireActivation = "Env.requireActivation"
        static let tenantHost = "Env.tenantHost"
        static let activationInfo = "Env.activationInfo"
    }

    @Published var tenantHost: String? = nil {
        didSet { updateBaseURL(); persist() }
    }

    @Published var activationInfo: ActivationDetails? = nil {
        didSet { persist() }
    }

    init() {
        let raw = UserDefaults.standard.string(forKey: Keys.environment) ?? AppEnvironment.production.rawValue
        self.environment = AppEnvironment(rawValue: raw) ?? .production
        self.customBaseURLString = UserDefaults.standard.string(forKey: Keys.customBaseURL) ?? ""
        self.tenantId = UserDefaults.standard.string(forKey: Keys.tenantId)
        // No default tenant; tenant will be assigned by activation
        self.deviceToken = KeychainStore.standard.string(forKey: Keys.deviceToken)
        // Require activation by default for unactivated installs; otherwise honor stored setting or default true
        let storedRequire = UserDefaults.standard.object(forKey: Keys.requireActivation) as? Bool
        if (self.deviceToken ?? "").isEmpty {
            self.requireActivation = true
        } else {
            self.requireActivation = storedRequire ?? true
        }
        self.tenantHost = UserDefaults.standard.string(forKey: Keys.tenantHost)
        if let data = UserDefaults.standard.data(forKey: Keys.activationInfo) {
            self.activationInfo = try? JSONDecoder().decode(ActivationDetails.self, from: data)
        }
        self.baseURL = EnvironmentStore.computeBaseURL(env: self.environment, custom: self.customBaseURLString, tenantHost: self.tenantHost)
    }

    private func updateBaseURL() {
        baseURL = Self.computeBaseURL(env: environment, custom: customBaseURLString, tenantHost: tenantHost)
    }

    private static func computeBaseURL(env: AppEnvironment, custom: String, tenantHost: String?) -> URL {
        if let host = tenantHost?.trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty, let url = URL(string: "https://\(host)") {
            return url
        }
        if env == .custom, let url = URL(string: custom), !custom.isEmpty {
            return url
        }
        return env.defaultBaseURL
    }

    func reloadAppData() {
        reloadCounter &+= 1
    }

    func clearActivation() {
        // Require activation again and clear credentials
        requireActivation = true
        deviceToken = nil
        tenantId = nil
        tenantHost = nil
        activationInfo = nil
        persist()
        updateBaseURL()
        reloadAppData()
    }

    private func persist() {
        UserDefaults.standard.set(environment.rawValue, forKey: Keys.environment)
        UserDefaults.standard.set(customBaseURLString, forKey: Keys.customBaseURL)
        UserDefaults.standard.set(tenantId, forKey: Keys.tenantId)
        UserDefaults.standard.set(requireActivation, forKey: Keys.requireActivation)
        UserDefaults.standard.set(tenantHost, forKey: Keys.tenantHost)
        if let info = activationInfo, let data = try? JSONEncoder().encode(info) {
            UserDefaults.standard.set(data, forKey: Keys.activationInfo)
        } else {
            UserDefaults.standard.removeObject(forKey: Keys.activationInfo)
        }
    }
}

