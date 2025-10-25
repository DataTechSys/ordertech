import SwiftUI
#if canImport(LiveKit)
import LiveKit
#endif

#if canImport(LiveKit)
private final class LKDisplayHostView: UIView {
    let videoView = VideoView()
    weak var lk: LiveKitRTC?
    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        clipsToBounds = false
        videoView.contentMode = .scaleAspectFill
        videoView.layer.isOpaque = true
        videoView.isUserInteractionEnabled = false
        videoView.translatesAutoresizingMaskIntoConstraints = true
        videoView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        videoView.contentScaleFactor = UIScreen.main.scale
        addSubview(videoView)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configure(with lk: LiveKitRTC?) {
        print("[LKDisplayHostView] configure called with lk: \(lk != nil ? "not nil" : "nil")")
        self.lk = lk
        videoView.frame = bounds
        // Attach once; VideoView handles resizing internally
        if let lk = lk {
            print("[LKDisplayHostView] Configuring with LiveKit instance: \(lk)")
            print("[LKDisplayHostView] Calling setRemoteVideoView on LiveKit instance")
            lk.setRemoteVideoView(videoView)
            print("[LKDisplayHostView] setRemoteVideoView completed")
        } else {
            print("[LKDisplayHostView] No LiveKit instance available yet")
        }
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        videoView.frame = bounds
        // Avoid re-attaching renderer on every layout to reduce overhead
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.configure(with: self.lk)
        }
    }
}

struct LKRemoteVideoView: UIViewRepresentable {
    @EnvironmentObject var store: DisplaySessionStore
    var cornerRadius: CGFloat = 0
    var masksToBounds: Bool = false
    func makeUIView(context: Context) -> UIView {
        let currentLiveKit = store.currentLiveKit
        print("[LKRemoteVideoView] makeUIView called, currentLiveKit: \(currentLiveKit != nil ? "not nil" : "nil")")
        if let lk = currentLiveKit {
            print("[LKRemoteVideoView] LiveKit instance available: \(lk)")
        }
        let host = LKDisplayHostView()
        host.isUserInteractionEnabled = false
        host.clipsToBounds = false
        host.layer.cornerRadius = cornerRadius
        host.layer.masksToBounds = masksToBounds
        // Also round the actual video layer to prevent Metal spill
        host.videoView.layer.cornerRadius = cornerRadius
        host.videoView.layer.masksToBounds = masksToBounds
        print("[LKRemoteVideoView] About to call configure in makeUIView with: \(currentLiveKit != nil ? "valid LiveKit" : "nil")")
        host.configure(with: currentLiveKit)
        print("[LKRemoteVideoView] makeUIView completed")
        return host
    }
    func updateUIView(_ uiView: UIView, context: Context) {
        if let host = uiView as? LKDisplayHostView {
            let currentLiveKit = store.currentLiveKit
            host.layer.cornerRadius = cornerRadius
            host.layer.masksToBounds = masksToBounds
            host.videoView.layer.cornerRadius = cornerRadius
            host.videoView.layer.masksToBounds = masksToBounds
            print("[LKRemoteVideoView] updateUIView called with currentLiveKit: \(currentLiveKit != nil ? "available" : "nil")")
            if let lk = currentLiveKit {
                print("[LKRemoteVideoView] LiveKit instance available in updateUIView: \(lk)")
            }
            print("[LKRemoteVideoView] About to call configure in updateUIView")
            host.configure(with: currentLiveKit)
            print("[LKRemoteVideoView] updateUIView completed")
        } else {
            print("[LKRemoteVideoView] updateUIView: could not cast to LKDisplayHostView")
        }
    }
}

struct LKLocalVideoView: UIViewRepresentable {
    @EnvironmentObject var store: DisplaySessionStore
    func makeUIView(context: Context) -> VideoView {
        let v = VideoView()
        v.contentMode = .scaleAspectFill
        return v
    }
    func updateUIView(_ uiView: VideoView, context: Context) {
        store.currentLiveKit?.setLocalVideoView(uiView)
    }
}
#else
struct LKRemoteVideoView: View { var body: some View { Color.black } }
struct LKLocalVideoView: View { var body: some View { Color.clear } }
#endif
