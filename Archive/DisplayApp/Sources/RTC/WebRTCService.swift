import Foundation
import SwiftUI
#if canImport(WebRTC)
import WebRTC
#endif

#if canImport(WebRTC)
@MainActor
final class WebRTCService: NSObject, ObservableObject {
    let factory: RTCPeerConnectionFactory

    @Published var localVideoTrack: RTCVideoTrack?
    @Published var remoteVideoTrack: RTCVideoTrack?

    override init() {
        RTCInitializeSSL()
        self.factory = RTCPeerConnectionFactory()
        super.init()
    }

    deinit {
        RTCCleanupSSL()
    }
}
#else
@MainActor
final class WebRTCService: NSObject, ObservableObject { }
#endif