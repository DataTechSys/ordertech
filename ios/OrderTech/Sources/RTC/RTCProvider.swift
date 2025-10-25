import Foundation

protocol RTCProvider {
    var providerName: String { get }
    var signalBars: Int { get }
    func start(pairId: String) async throws
    func stop()
    func setMicMuted(_ muted: Bool)
}

extension RTCProvider {
    func setMicMuted(_ muted: Bool) {}
}