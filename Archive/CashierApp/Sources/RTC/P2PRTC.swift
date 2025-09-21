import Foundation
#if canImport(WebRTC)
import WebRTC
import AVFoundation
#endif

/// Native P2P WebRTC provider for iPad cashier.
/// Manages RTCPeerConnection, local capture, backend signaling, and basic stats.
final class P2PRTC: RTCProvider {
    var providerName: String { "P2P" }
    private(set) var signalBars: Int = 0

    // Dependencies
    private let pairId: String
    private let http: HttpClient
    #if canImport(WebRTC)
    private weak var service: WebRTCService?
    private let queue = DispatchQueue(label: "P2PRTC.queue")

    // WebRTC
    private var pc: RTCPeerConnection?
    private var audioTrack: RTCAudioTrack?
    private var videoTrack: RTCVideoTrack?
    private var capturer: RTCCameraVideoCapturer?

    // Timers
    private var answerTimer: Timer?
    private var candidatesTimer: Timer?
    private var statsTimer: Timer?

    // Stats snapshot
    private var lastBytes: (aIn: Int64, aOut: Int64, vIn: Int64, vOut: Int64) = (0,0,0,0)

    // State
    private var stopped = false
    private var gotAnswer = false
    #endif

    // Callbacks
    private let onBars: (Int) -> Void

    init(pairId: String, http: HttpClient, onBars: @escaping (Int)->Void, webRTCService: Any?) {
        self.pairId = pairId
        self.http = http
        self.onBars = onBars
        #if canImport(WebRTC)
        self.service = (webRTCService as? WebRTCService)
        #endif
    }

    private func clientLog(_ tag: String, _ msg: String, meta: [String: Any] = [:]) {
        let payload: [String: Any] = [
            "tag": tag,
            "role": "cashier-ios",
            "basketId": pairId,
            "msg": msg,
            "meta": meta
        ]
        let data = try? JSONSerialization.data(withJSONObject: payload)
        // Fire-and-forget; avoid blocking non-async contexts
        Task { [http] in
            _ = try? await http.request("/client-log", method: "POST", headers: ["content-type": "application/json"], body: data, decode: Empty.self)
        }
    }

    fileprivate func safeLog(tag: String, msg: String, meta: [String: Any]) {
        clientLog(tag, msg, meta: meta)
    }

    func start() async throws {
        #if canImport(WebRTC)
        stopped = false
        try await preclearAndStartSession()
        clientLog("p2p", "session_precleared", meta: [:])
        let cfg = try await http.getWebRTCConfig()
        try await startRTC(using: cfg)
        #else
        // No WebRTC available (sim/shell build): set minimal bars
        self.signalBars = 1
        self.onBars(self.signalBars)
        #endif
    }

    func stop() {
        #if canImport(WebRTC)
        stopped = true
        invalidateTimers()
        queue.sync { [weak self] in
            guard let self = self else { return }
            do { try RTCAudioSession.sharedInstance().setActive(false) } catch {}
            self.capturer?.stopCapture()
            self.capturer = nil
            self.audioTrack = nil
            self.videoTrack = nil
            self.pc?.close()
            self.pc = nil
            Task { @MainActor in
                self.service?.stop()
            }
        }
        #endif
        self.signalBars = 0
        self.onBars(0)
    }

    // Public control
    func setMicMuted(_ muted: Bool) {
        #if canImport(WebRTC)
        queue.async { [weak self] in
            guard let self = self else { return }
            if let t = self.audioTrack?.source { /* keep source */ }
            self.audioTrack?.isEnabled = !muted
            self.pc?.senders.forEach { s in if s.track?.kind == kRTCMediaStreamTrackKindAudio { s.track?.isEnabled = !muted } }
        }
        #endif
    }

    // MARK: - Internal (WebRTC)
    #if canImport(WebRTC)
    private func preclearAndStartSession() async throws {
        _ = try? await http.deleteRTCSession(pairId: pairId, reason: "preclear")
        _ = try await http.sessionStart(pairId: pairId)
    }

    private func startRTC(using cfg: RTCConfig) async throws {
        // Audio session: voice chat
        let audioSession = RTCAudioSession.sharedInstance()
        audioSession.lockForConfiguration()
        do {
            try audioSession.setCategory(AVAudioSession.Category.playAndRecord.rawValue,
                                         with: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
            try audioSession.setMode(AVAudioSession.Mode.voiceChat.rawValue)
            try audioSession.setActive(true)
        } catch {
            // still proceed
        }
        audioSession.unlockForConfiguration()

        guard let factory = await service?.factory else { throw APIError(message: "WebRTC factory missing") }

        // PeerConnection config
        let rtcCfg = RTCConfiguration()
        rtcCfg.sdpSemantics = .unifiedPlan
        let iceServers = (cfg.iceServers ?? []).map { ice in
            RTCIceServer(urlStrings: ice.urls, username: ice.username, credential: ice.credential)
        }
        rtcCfg.iceServers = iceServers

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil,
                                              optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
        guard let pc = factory.peerConnection(with: rtcCfg, constraints: constraints, delegate: nil) as RTCPeerConnection? else {
            throw APIError(message: "pc_create_failed")
        }
        self.pc = pc
        clientLog("p2p", "pc_created", meta: ["iceServers": (cfg.iceServers ?? []).count])

        // Delegates
        class PCDelegate: NSObject, RTCPeerConnectionDelegate {
            weak var owner: P2PRTC?
            init(owner: P2PRTC) { self.owner = owner }
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
            func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
                // Could add backoff/retry here later
            }
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
                // No-op
            }
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
                guard let selfOwner = owner else { return }
                Task {
                    try? await selfOwner.http.postCandidate(pairId: selfOwner.pairId, role: "cashier", candidate: RTCIceCandidateJSON(candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: Int(candidate.sdpMLineIndex)))
                    selfOwner.safeLog(tag: "p2p", msg: "local_candidate", meta: ["type": candidate.sdp])
                }
            }
            func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didStartReceivingOn transceiver: RTCRtpTransceiver) {
                guard let selfOwner = owner else { return }
                if let track = transceiver.receiver.track as? RTCVideoTrack {
                    DispatchQueue.main.async { selfOwner.service?.remoteVideoTrack = track }
                }
            }
            func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
                guard let selfOwner = owner else { return }
                if let track = rtpReceiver.track as? RTCVideoTrack {
                    DispatchQueue.main.async { selfOwner.service?.remoteVideoTrack = track }
                }
            }
        }
        let delegate = PCDelegate(owner: self)
        pc.delegate = delegate

        // Media: audio
        let audioSource = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")
        self.audioTrack = audioTrack

        // Media: video capture
        let videoSource = factory.videoSource()
        let capturer = RTCCameraVideoCapturer(delegate: videoSource)
        self.capturer = capturer
        let videoTrack = factory.videoTrack(with: videoSource, trackId: "video0")
        self.videoTrack = videoTrack
        DispatchQueue.main.async { self.service?.localVideoTrack = videoTrack }

        // Choose front camera and a good format (720p@30 if available)
        if let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front }) ?? RTCCameraVideoCapturer.captureDevices().first {
            let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
            let targetWidth: Int32 = 1280
            let targetHeight: Int32 = 720
            let chosenFormat = formats.sorted { (a, b) in
                let ad = CMVideoFormatDescriptionGetDimensions(a.formatDescription)
                let bd = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
                func score(_ d: CMVideoDimensions) -> Int { Int(abs(Int32(d.width) - targetWidth) + abs(Int32(d.height) - targetHeight)) }
                return score(ad) < score(bd)
            }.first ?? formats.first!
            let fpsRanges = chosenFormat.videoSupportedFrameRateRanges
            let maxFps = fpsRanges.map { $0.maxFrameRate }.max() ?? 30
            let fps = min(30, Int(maxFps))
            capturer.startCapture(with: device, format: chosenFormat, fps: fps, completionHandler: { _ in })
        }

        // Add tracks
        _ = pc.add(audioTrack, streamIds: ["stream0"])
        _ = pc.add(videoTrack, streamIds: ["stream0"])
        clientLog("p2p", "tracks_added", meta: [:])

        // Offer
        let offerConstraints = RTCMediaConstraints(mandatoryConstraints: [
            kRTCMediaConstraintsOfferToReceiveAudio: kRTCMediaConstraintsValueTrue,
            kRTCMediaConstraintsOfferToReceiveVideo: kRTCMediaConstraintsValueTrue
        ], optionalConstraints: nil)
        pc.offer(for: offerConstraints) { [weak self] sdp, err in
            guard let self = self, let sdp = sdp else { return }
            self.clientLog("p2p", "offer_created", meta: ["len": sdp.sdp.count])
            self.pc?.setLocalDescription(sdp, completionHandler: { _ in
                Task {
                    try? await self.http.postOffer(pairId: self.pairId, sdp: sdp.sdp)
                    self.safeLog(tag: "p2p", msg: "offer_posted", meta: [:])
                }
                self.beginAnswerPolling()
            })
        }

        // Stats and bars
        startStatsTimer()
    }

    private func beginAnswerPolling() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.answerTimer?.invalidate()
            self.answerTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
                guard let self = self, !self.stopped else { return }
                Task {
                    do {
                        let r = try await self.http.getAnswer(pairId: self.pairId)
                        if let sdp = r.sdp, let pc = self.pc, pc.remoteDescription == nil {
                            pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { _ in
                                self.gotAnswer = true
                                self.clientLog("p2p", "answer_applied", meta: [:])
                                self.answerTimer?.invalidate(); self.answerTimer = nil
                                self.beginCandidatesPolling(burst: true)
                            }
                        }
                    } catch { /* keep polling */ }
                }
            }
        }
    }

    private func beginCandidatesPolling(burst: Bool) {
        var burstsLeft = burst ? 6 : 0
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.candidatesTimer?.invalidate()
            self.candidatesTimer = Timer.scheduledTimer(withTimeInterval: burst ? 0.25 : 1.5, repeats: true) { [weak self] t in
                guard let self = self, !self.stopped else { t.invalidate(); return }
                Task {
                    do {
                        let resp = try await self.http.getCandidates(pairId: self.pairId, role: "cashier")
                        let items = resp.items ?? []
                        for c in items {
                            guard let sdp = c.candidate, let mid = c.sdpMid, let index = c.sdpMLineIndex else { continue }
                            let cand = RTCIceCandidate(sdp: sdp, sdpMLineIndex: Int32(index), sdpMid: mid)
                            self.pc?.add(cand, completionHandler: { _ in })
                            self.clientLog("p2p", "remote_candidate_added", meta: [:])
                        }
                    } catch { /* ignore */ }
                }
                if burstsLeft > 0 { burstsLeft -= 1; if burstsLeft == 0 { t.invalidate(); self.beginCandidatesPolling(burst: false) } }
            }
        }
    }

    private func startStatsTimer() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.statsTimer?.invalidate()
            self.statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
                guard let self = self, let pc = self.pc else { return }
                pc.statistics { report in
                    var aIn: Int64 = 0, aOut: Int64 = 0, vIn: Int64 = 0, vOut: Int64 = 0
                    for (_, s) in report.statistics {
                        let type = s.type
                        let values = s.values
                        if type == "inbound-rtp" {
                            let media = (values["mediaType"] as? NSString) as String? ?? (values["kind"] as? NSString) as String? ?? ""
                            let bytes = (values["bytesReceived"] as? NSNumber)?.int64Value ?? 0
                            if media == "audio" { aIn += bytes }
                            else if media == "video" { vIn += bytes }
                        } else if type == "outbound-rtp" {
                            let media = (values["mediaType"] as? NSString) as String? ?? (values["kind"] as? NSString) as String? ?? ""
                            let bytes = (values["bytesSent"] as? NSNumber)?.int64Value ?? 0
                            if media == "audio" { aOut += bytes }
                            else if media == "video" { vOut += bytes }
                        }
                    }
                    let dAIn = max(0, aIn - self.lastBytes.aIn)
                    let dAOut = max(0, aOut - self.lastBytes.aOut)
                    let dVIn = max(0, vIn - self.lastBytes.vIn)
                    let dVOut = max(0, vOut - self.lastBytes.vOut)
                    self.lastBytes = (aIn, aOut, vIn, vOut)
                    // rough bps over ~2s
                    let audioInOk = dAIn * 8 > 6_000 * 2
                    let audioOutOk = dAOut * 8 > 6_000 * 2
                    let videoOk = (dVIn * 8 > 100_000 * 2) && (dVOut * 8 > 100_000 * 2)
                    var bars = 0
                    if audioInOk && audioOutOk { bars = videoOk ? 3 : 2 }
                    else if audioInOk || audioOutOk { bars = 1 }
                    else { bars = 0 }
                    if bars != self.signalBars {
                        self.signalBars = bars
                        DispatchQueue.main.async { self.onBars(bars) }
                    }
                }
            }
        }
    }

    private func invalidateTimers() {
        DispatchQueue.main.async {
            self.answerTimer?.invalidate(); self.answerTimer = nil
            self.candidatesTimer?.invalidate(); self.candidatesTimer = nil
            self.statsTimer?.invalidate(); self.statsTimer = nil
        }
    }
    #endif
}

