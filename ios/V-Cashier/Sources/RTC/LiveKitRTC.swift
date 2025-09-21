import Foundation
#if canImport(LiveKit)
import LiveKit
#endif
#if canImport(WebRTC)
import WebRTC
#endif

final class LiveKitRTC: NSObject, RTCProvider {
    var providerName: String { "Live" }
    private(set) var signalBars: Int = 0

    #if canImport(LiveKit)
    private(set) var room: Room?
    private weak var remoteView: VideoView?
    private weak var localView: VideoView?
    #endif

    #if canImport(LiveKit)
    var remoteVideoAttached: Bool { (remoteView?.track != nil) }
    #endif

    private let pairId: String
    private let http: HttpClient

    init(pairId: String, http: HttpClient) { self.pairId = pairId; self.http = http }

    func start() async throws {
        #if canImport(LiveKit)
        print("[LiveKitRTC] start() for pairId=\(pairId): requesting token…")
        let tok = try await http.rtcToken(provider: "livekit", basketId: pairId, role: "cashier")
        guard let url = tok.url, let token = tok.token else { throw APIError(message: "livekit_token_missing") }

        let room = Room()
        self.room = room
        room.add(delegate: self)

        let baseURL: String = {
            if let u = URL(string: url), var comps = URLComponents(url: u, resolvingAgainstBaseURL: false) {
                comps.path = ""
                comps.query = nil
                comps.percentEncodedQuery = nil
                return comps.string ?? url
            }
            return url
        }()

        print("[LiveKitRTC] connecting to \(baseURL)…")
        let connectOptions = ConnectOptions(autoSubscribe: true)
        // Re-enable adaptive/dynacast to reduce bandwidth and latency while keeping smoothness
        let roomOpts = RoomOptions(adaptiveStream: true, dynacast: true)
        try await room.connect(url: baseURL, token: token, connectOptions: connectOptions, roomOptions: roomOpts)
        print("[LiveKitRTC] connected, enabling mic/camera…")

        let lp = room.localParticipant
        let cam = CameraCaptureOptions(position: .front, dimensions: .h540_169, fps: 24)
        _ = try? await lp.setCamera(enabled: true, captureOptions: cam)
        _ = try? await lp.setMicrophone(enabled: true)

        signalBars = 2
        print("[LiveKitRTC] local tracks enabled")
        do {
            let payload: [String: Any] = ["tag":"livekit","role":"cashier-ios","basketId": pairId, "msg":"connected_published", "meta":[:]]
            if let data = try? JSONSerialization.data(withJSONObject: payload) {
                _ = try? await http.request("/client-log", method: "POST", headers: ["content-type":"application/json"], body: data, decode: Empty.self)
            }
        } catch { /* ignore */ }
        #else
        signalBars = 2
        #endif
    }

    func stop() {
        print("[LiveKitRTC] stop(): begin")
        // Clear UI bindings immediately to stop rendering
        #if canImport(LiveKit)
        DispatchQueue.main.async { [weak self] in
            self?.localView?.track = nil
            self?.remoteView?.track = nil
            print("[LiveKitRTC] stop(): cleared VideoView tracks")
        }
        Task { [weak self] in
            guard let self = self, let room = self.room else { print("[LiveKitRTC] stop(): no room"); return }
            // Unsubscribe remote tracks first to stop any remote audio quickly
            do {
                for (_, rp) in room.remoteParticipants {
                    let aCount = rp.audioTracks.count
                    let vCount = rp.videoTracks.count
                    print("[LiveKitRTC] stop(): unsubscribing remote participant=\(rp.identity) audio=\(aCount) video=\(vCount)")
                    for pub in rp.audioTracks { try? await (pub as? RemoteTrackPublication)?.set(subscribed: false) }
                    for pub in rp.videoTracks { try? await (pub as? RemoteTrackPublication)?.set(subscribed: false) }
                }
            }
            // Disable local tracks
            do {
                let lp = room.localParticipant
                print("[LiveKitRTC] stop(): disabling local mic/camera")
                _ = try? await lp.setMicrophone(enabled: false)
                _ = try? await lp.setCamera(enabled: false)
            }
            // Disconnect
            print("[LiveKitRTC] stop(): disconnect room…")
            try? await room.disconnect()
            print("[LiveKitRTC] stop(): room disconnected")
            // Deactivate audio session explicitly
            #if canImport(WebRTC)
            let audio = RTCAudioSession.sharedInstance()
            audio.lockForConfiguration()
            do { try audio.setActive(false); print("[LiveKitRTC] stop(): RTCAudioSession setActive(false)") } catch { print("[LiveKitRTC] stop(): RTCAudioSession setActive(false) failed: \(error)") }
            audio.unlockForConfiguration()
            #endif
        }
        room = nil
        #endif
        signalBars = 0
        print("[LiveKitRTC] stop(): end")
    }

    #if canImport(LiveKit)
    func setRemoteVideoView(_ view: VideoView) { self.remoteView = view; attachRemoteIfAvailable() }
    func setLocalVideoView(_ view: VideoView) { self.localView = view; attachLocalIfAvailable() }

    private func attachLocalIfAvailable() {
        guard let v = localView, let lp = room?.localParticipant else { return }
        for pub in lp.localVideoTracks {
            if let t = pub.track as? LocalVideoTrack {
                DispatchQueue.main.async { v.track = t }
                break
            }
        }
    }

    private func attachRemoteIfAvailable() {
        guard let v = remoteView, let r = room else { return }
        for (_, rp) in r.remoteParticipants {
            for pub in rp.videoTracks {
                if let p = pub as? RemoteTrackPublication, let t = p.track as? VideoTrack {
                    DispatchQueue.main.async { v.track = t }
                    return
                }
            }
        }
    }
    #endif

    func setMicMuted(_ muted: Bool) {
        #if canImport(LiveKit)
        Task { [weak self] in
            guard let lp = self?.room?.localParticipant else { return }
            _ = try? await lp.setMicrophone(enabled: !muted)
        }
        #endif
    }
}

#if canImport(LiveKit)
extension LiveKitRTC: RoomDelegate {
    // Remote track subscribed — attach renderer (main thread)
    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack track: Track, publication: RemoteTrackPublication) {
        print("[LiveKitRTC] didSubscribeTrack(remote) participant=\(participant.identity) kind=\(publication.kind) sid=\(publication.sid)")
        guard let vtrack = track as? VideoTrack else { return }
        DispatchQueue.main.async { [weak self] in
            guard let view = self?.remoteView else { return }
            // Use VideoView.track API so the view manages renderer lifecycle
            view.track = vtrack
        }
    }

    // Local track published — attach PiP renderer (main thread)
    func room(_ room: Room, localParticipant: LocalParticipant, didPublishTrack track: Track, publication: LocalTrackPublication) {
        print("[LiveKitRTC] didPublishTrack(local) kind=\(publication.kind) sid=\(publication.sid)")
        guard let ltrack = track as? LocalVideoTrack else { return }
        DispatchQueue.main.async { [weak self] in
            guard let view = self?.localView else { return }
            // Use VideoView.track API so the view manages renderer lifecycle
            view.track = ltrack
        }
    }
}
#endif

