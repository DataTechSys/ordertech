import Foundation
import SwiftUI

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

    func clear() {
        state = .unknown; message = nil; expiresAt = nil; graceUntil = nil
    }

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
