import SwiftUI
#if canImport(WebRTC)
import WebRTC
import UIKit

struct RTCRemoteVideoView: UIViewRepresentable {
    let track: RTCVideoTrack?
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let v = RTCMTLVideoView(frame: .zero)
        v.videoContentMode = .scaleAspectFill
        return v
    }
    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        context.coordinator.bind(track: track, view: uiView)
    }
    func makeCoordinator() -> Coord { Coord() }
    final class Coord {
        private var boundTrack: RTCVideoTrack?
        func bind(track: RTCVideoTrack?, view: RTCMTLVideoView) {
            if boundTrack === track { return }
            if let t = boundTrack { t.remove(view) }
            boundTrack = track
            if let t = track { t.add(view) }
        }
    }
}

struct RTCLocalVideoView: UIViewRepresentable {
    let track: RTCVideoTrack?
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let v = RTCMTLVideoView(frame: .zero)
        // Mirror the local (front camera) preview by flipping horizontally
        v.transform = CGAffineTransform(scaleX: -1, y: 1)
        v.videoContentMode = .scaleAspectFill
        return v
    }
    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        context.coordinator.bind(track: track, view: uiView)
    }
    func makeCoordinator() -> RTCRemoteVideoView.Coord { RTCRemoteVideoView.Coord() }
}
#else
struct RTCRemoteVideoView: View { var body: some View { Color.black } }
struct RTCLocalVideoView: View { var body: some View { Color.clear } }
#endif
