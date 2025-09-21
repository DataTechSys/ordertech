import Foundation

protocol RTCProvider {
    var providerName: String { get }
    func start() async throws
    func stop()
    var signalBars: Int { get }
}

