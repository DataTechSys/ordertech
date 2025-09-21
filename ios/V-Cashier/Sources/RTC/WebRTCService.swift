import Foundation
#if canImport(WebRTC)
import WebRTC
#endif

#if canImport(WebRTC)
@MainActor
final class WebRTCService: NSObject, ObservableObject {
    // Expose a shared PeerConnection factory for RTC modules
    let factory: RTCPeerConnectionFactory

    // Renderers the UI provides (we only keep weak-ish references through RTCVideoRenderer)
    private var remoteRenderer: RTCVideoRenderer?
    private var localRenderer: RTCVideoRenderer?

    // Tracks bound by the RTC provider
    @Published var remoteVideoTrack: RTCVideoTrack? {
        didSet { if let r = remoteRenderer, let t = remoteVideoTrack { t.add(r) } }
    }
    @Published var localVideoTrack: RTCVideoTrack? {
        didSet { if let r = localRenderer, let t = localVideoTrack { t.add(r) } }
    }

    override init() {
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        let decoderFactory = RTCDefaultVideoDecoderFactory()
        self.factory = RTCPeerConnectionFactory(encoderFactory: encoderFactory, decoderFactory: decoderFactory)
        super.init()
    }

    deinit { RTCCleanupSSL() }

    func set(remoteRenderer: RTCVideoRenderer) {
        self.remoteRenderer = remoteRenderer
        if let t = remoteVideoTrack { t.add(remoteRenderer) }
    }

    func set(localRenderer: RTCVideoRenderer) {
        self.localRenderer = localRenderer
        if let t = localVideoTrack { t.add(localRenderer) }
    }

    func stop() {
        if let r = remoteRenderer, let t = remoteVideoTrack { t.remove(r) }
        if let r = localRenderer, let t = localVideoTrack { t.remove(r) }
        remoteVideoTrack = nil
        localVideoTrack = nil
    }
}
#endif

