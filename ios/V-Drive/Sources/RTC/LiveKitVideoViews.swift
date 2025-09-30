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
        self.lk = lk
        videoView.frame = bounds
        // Attach once; VideoView handles resizing internally
        if let lk = lk {
            print("[LKDisplayHostView] Configuring with LiveKit instance: \(lk)")
            lk.setRemoteVideoView(videoView)
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
        let host = LKDisplayHostView()
        host.isUserInteractionEnabled = false
        host.clipsToBounds = false
        host.layer.cornerRadius = cornerRadius
        host.layer.masksToBounds = masksToBounds
        // Also round the actual video layer to prevent Metal spill
        host.videoView.layer.cornerRadius = cornerRadius
        host.videoView.layer.masksToBounds = masksToBounds
        host.configure(with: store.currentLiveKit)
        return host
    }
    func updateUIView(_ uiView: UIView, context: Context) {
        if let host = uiView as? LKDisplayHostView {
            host.layer.cornerRadius = cornerRadius
            host.layer.masksToBounds = masksToBounds
            host.videoView.layer.cornerRadius = cornerRadius
            host.videoView.layer.masksToBounds = masksToBounds
            print("[LKRemoteVideoView] Updating with currentLiveKit: \(store.currentLiveKit != nil ? "available" : "nil")")
            host.configure(with: store.currentLiveKit)
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
