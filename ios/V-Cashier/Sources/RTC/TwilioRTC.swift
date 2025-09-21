import Foundation
#if canImport(TwilioVideo)
import TwilioVideo
#endif

final class TwilioRTC: RTCProvider {
    var providerName: String { "Twilio" }
    private(set) var signalBars: Int = 0
    func start() async throws {
        // TODO: Integrate Twilio Video via SPM when resolved.
        signalBars = 2
    }
    func stop() {
        signalBars = 0
    }
}

