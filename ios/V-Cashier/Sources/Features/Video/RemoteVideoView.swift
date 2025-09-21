import SwiftUI
#if canImport(WebRTC)
import WebRTC
#endif

#if canImport(WebRTC)
struct RemoteVideoView: UIViewRepresentable {
    let service: WebRTCService

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let v = RTCMTLVideoView()
        v.videoContentMode = .scaleAspectFill
        service.set(remoteRenderer: v)
        return v
    }

    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        // Renderers already attached by P2P service
    }
}
#endif

#if canImport(LiveKit)
import LiveKit
struct LiveKitRemoteView: UIViewRepresentable {
    let livekit: LiveKitRTC
    func makeUIView(context: Context) -> VideoView {
        let v = VideoView()
        v.contentMode = .scaleAspectFill
        livekit.setRemoteVideoView(v)
        return v
    }
    func updateUIView(_ uiView: VideoView, context: Context) { }
}
#endif

