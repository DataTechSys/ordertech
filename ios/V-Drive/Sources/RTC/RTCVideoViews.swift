import SwiftUI
import AVKit
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

// MARK: - Looping video placeholder
/// A simple SwiftUI view that loops a bundled video asset by name.
/// Usage: Place an MP4 in the app bundle (e.g., "cam_placeholder.mp4") and pass resourceName: "cam_placeholder".
struct LoopingVideoView: View {
    let resourceName: String
    let resourceExtension: String

    @State private var player: AVQueuePlayer? = nil
    @State private var looper: AVPlayerLooper? = nil

    init(resourceName: String, resourceExtension: String = "mp4") {
        self.resourceName = resourceName
        self.resourceExtension = resourceExtension
    }

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
                    .onAppear { player.play() }
            } else {
                // Fallback if the asset is missing
                Color.black
                    .overlay(
                        VStack(spacing: 8) {
                            Image(systemName: "video.slash").foregroundColor(.white)
                            Text("Waiting for cashier…").foregroundColor(.white).font(.subheadline)
                        }
                    )
            }
        }
        .onAppear { setup() }
        .onDisappear { teardown() }
        .accessibilityLabel(Text("Camera placeholder"))
    }

    private func setup() {
        var url: URL? = Bundle.main.url(forResource: resourceName, withExtension: resourceExtension)
        if url == nil {
            // Fallback: pick the first video file in the bundle with common extensions
            let exts = ["mp4","mov","m4v","MP4","MOV","M4V"]
            for ext in exts {
                if let urls = Bundle.main.urls(forResourcesWithExtension: ext, subdirectory: nil), let first = urls.first {
                    url = first
                    break
                }
            }
        }
        guard let url else { return }
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        let queue = AVQueuePlayer()
        // Keep a strong reference to the looper, otherwise looping stops
        let loop = AVPlayerLooper(player: queue, templateItem: item)
        self.player = queue
        self.looper = loop
        queue.play()
    }

    private func teardown() {
        player?.pause()
        looper?.disableLooping()
        looper = nil
        player = nil
    }
}
