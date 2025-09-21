import Foundation
#if canImport(WebRTC)
@preconcurrency import WebRTC
import AVFoundation
#endif
import OrderTechCore

final class P2PRTC: RTCProvider {
    let providerName: String = "P2P"
    private(set) var signalBars: Int = 0

    private let http: HttpClient
    private let pairId: String
    #if canImport(WebRTC)
    private weak var service: WebRTCService?
    private var pc: RTCPeerConnection?
    private var pcDelegateStrong: RTCPeerConnectionDelegate? // keep strong ref, RTCPeerConnection holds weak
    private var audioTrack: RTCAudioTrack?
    private var videoTrack: RTCVideoTrack?
    private var capturer: RTCCameraVideoCapturer?
    private var answerPollTimer: Timer?
    private var candidatesTimer: Timer?
    private var statsTimer: Timer?
    private var lastBytes: (aIn:Int64,aOut:Int64,vIn:Int64,vOut:Int64) = (0,0,0,0)
    private var stopped = false
    private var candidatesBurstLeft: Int = 0
    #endif

    init(pairId: String, http: HttpClient, webRTCService: Any?) {
        self.pairId = pairId
        self.http = http
        #if canImport(WebRTC)
        self.service = webRTCService as? WebRTCService
        #endif
    }

    func start(pairId: String) async throws {
        #if canImport(WebRTC)
        try await preclear()
        try await ensureSession()
        try await startRTC()
        #else
        self.signalBars = 1
        #endif
    }

    func stop() {
        #if canImport(WebRTC)
        stopped = true
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.answerPollTimer?.invalidate(); self.answerPollTimer = nil
            self.candidatesTimer?.invalidate(); self.candidatesTimer = nil
            self.statsTimer?.invalidate(); self.statsTimer = nil
        }
        capturer?.stopCapture(); capturer = nil
        audioTrack = nil
        videoTrack = nil
        pc?.close(); pc = nil
        Task { @MainActor in
            service?.localVideoTrack = nil
            service?.remoteVideoTrack = nil
        }
        #endif
        signalBars = 0
    }

    func setMicMuted(_ muted: Bool) {
        #if canImport(WebRTC)
        audioTrack?.isEnabled = !muted
        #endif
    }

    // MARK: - Internal
    #if canImport(WebRTC)
    private func preclear() async throws {
        _ = try? await http.request("/webrtc/session/\(pairId)", method: "DELETE", decode: HttpClient.Empty.self)
    }
    private func ensureSession() async throws {
        _ = try? await http.request("/session/start?pairId=\(pairId)", method: "POST", decode: HttpClient.Empty.self)
    }

    private func startRTC() async throws {
        let audio = RTCAudioSession.sharedInstance()
        audio.lockForConfiguration()
        do {
            try audio.setCategory(AVAudioSession.Category.playAndRecord.rawValue, with: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
            try audio.setMode(AVAudioSession.Mode.voiceChat.rawValue)
            try audio.setActive(true)
        } catch {}
        audio.unlockForConfiguration()

        guard let factory = await service?.factory else { throw APIError(message: "webrtc_factory_missing") }

        let cfg = RTCConfiguration()
        cfg.sdpSemantics = .unifiedPlan
        // Use basic Google STUN; your server can expose TURN via /webrtc/config in the future if needed
        cfg.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement":"true"])
        guard let pc = factory.peerConnection(with: cfg, constraints: constraints, delegate: nil) as RTCPeerConnection? else {
            throw APIError(message: "pc_create_failed")
        }
        self.pc = pc

        // Delegates for tracks & ICE
        class Delegate: NSObject, RTCPeerConnectionDelegate {
            weak var owner: P2PRTC?
            init(owner: P2PRTC) { self.owner = owner }
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
            func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
                guard let selfOwner = owner else { return }
                let pid = selfOwner.pairId
                let http = selfOwner.http
                Task {
                    let json: [String: Any] = [
                        "candidate": candidate.sdp,
                        "sdpMid": candidate.sdpMid as Any,
                        "sdpMLineIndex": Int(candidate.sdpMLineIndex)
                    ]
                    let data = try JSONSerialization.data(withJSONObject: [
                        "pairId": pid,
                        "role": "display",
                        "candidate": json
                    ])
                    _ = try? await http.request("/webrtc/candidate", method: "POST", headers: [:], body: data, decode: HttpClient.Empty.self)
                }
            }
            func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
            func peerConnection(_ peerConnection: RTCPeerConnection, didStartReceivingOn transceiver: RTCRtpTransceiver) {
                if let track = transceiver.receiver.track as? RTCVideoTrack, let svc = owner?.service {
                    let t = track
                    Task { @MainActor in svc.remoteVideoTrack = t }
                }
            }
            func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
                if let track = rtpReceiver.track as? RTCVideoTrack, let svc = owner?.service {
                    let t = track
                    Task { @MainActor in svc.remoteVideoTrack = t }
                }
            }
        }
        let delegate = Delegate(owner: self)
        pcDelegateStrong = delegate
        pc.delegate = delegate

        // Media
        let audioSource = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")
        self.audioTrack = audioTrack
        _ = pc.add(audioTrack, streamIds: ["stream0"])

        let videoSource = factory.videoSource()
        let capturer = RTCCameraVideoCapturer(delegate: videoSource)
        self.capturer = capturer
        let videoTrack = factory.videoTrack(with: videoSource, trackId: "video0")
        self.videoTrack = videoTrack
        Task { @MainActor in
            self.service?.localVideoTrack = videoTrack
        }

        if let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front }) ?? RTCCameraVideoCapturer.captureDevices().first {
            let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
            let chosen = formats.first ?? formats.last!
            capturer.startCapture(with: device, format: chosen, fps: 24, completionHandler: { _ in })
        }

        // Wait for cashier offer then create & post answer
        startAnswerPolling()
        startCandidatesPolling(initialBurst: true)
        // Stats collection temporarily disabled to avoid strict-concurrency warnings
    }

    private func startAnswerPolling() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.answerPollTimer?.invalidate()
            let t = Timer.scheduledTimer(timeInterval: 1.2, target: self, selector: #selector(self.onAnswerPollTimer), userInfo: nil, repeats: true)
            self.answerPollTimer = t
            RunLoop.main.add(t, forMode: .common)
        }
    }

    @objc private func onAnswerPollTimer(_ timer: Timer) {
        guard let pc = self.pc, !self.stopped else { return }
        Task {
            do {
                struct Offer: Decodable { let sdp: String? }
                let o: Offer = try await self.http.request("/webrtc/offer?pairId=\(self.pairId)")
                if let sdp = o.sdp, pc.remoteDescription == nil {
                    pc.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { _ in
                        let cons = RTCMediaConstraints(mandatoryConstraints: [
                            kRTCMediaConstraintsOfferToReceiveAudio: kRTCMediaConstraintsValueTrue,
                            kRTCMediaConstraintsOfferToReceiveVideo: kRTCMediaConstraintsValueTrue
                        ], optionalConstraints: nil)
                        pc.answer(for: cons) { [weak self] sdp, _ in
                            guard let self = self, let sdp = sdp else { return }
                            pc.setLocalDescription(sdp) { _ in
                                Task { [pairId = self.pairId] in
                                    let data = try JSONSerialization.data(withJSONObject: ["pairId": pairId, "sdp": sdp.sdp])
                                    _ = try? await self.http.request("/webrtc/answer", method: "POST", headers: [:], body: data, decode: HttpClient.Empty.self)
                                }
                            }
                        }
                    }
                    self.answerPollTimer?.invalidate(); self.answerPollTimer = nil
                }
            } catch { /* keep polling */ }
        }
    }

    private func startCandidatesPolling(initialBurst: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.candidatesTimer?.invalidate()
            self.candidatesBurstLeft = initialBurst ? 6 : 0
            let interval: TimeInterval = initialBurst ? 0.3 : 1.5
            let t = Timer.scheduledTimer(timeInterval: interval, target: self, selector: #selector(self.onCandidatesPollTimer), userInfo: nil, repeats: true)
            self.candidatesTimer = t
            RunLoop.main.add(t, forMode: .common)
        }
    }

    @objc private func onCandidatesPollTimer(_ timer: Timer) {
        guard let pc = self.pc, !self.stopped else { timer.invalidate(); return }
        Task {
            do {
                struct CandResp: Decodable { let items: [RTCIceCandidateJSON]? }
                struct RTCIceCandidateJSON: Decodable { let candidate: String?; let sdpMid: String?; let sdpMLineIndex: Int? }
                let resp: CandResp = try await self.http.request("/webrtc/candidates?pairId=\(self.pairId)&role=display")
                let items = resp.items ?? []
                for c in items {
                    guard let sdp = c.candidate, let mid = c.sdpMid, let idx = c.sdpMLineIndex else { continue }
                    let ic = RTCIceCandidate(sdp: sdp, sdpMLineIndex: Int32(idx), sdpMid: mid)
                    pc.add(ic, completionHandler: { _ in })
                }
            } catch { /* ignore */ }
        }
        if candidatesBurstLeft > 0 {
            candidatesBurstLeft -= 1
            if candidatesBurstLeft == 0 {
                timer.invalidate()
                // switch to slower interval
                startCandidatesPolling(initialBurst: false)
            }
        }
    }

    private func startStatsTimer() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.statsTimer?.invalidate()
            let t = Timer.scheduledTimer(timeInterval: 2.0, target: self, selector: #selector(self.onStatsTimer), userInfo: nil, repeats: true)
            self.statsTimer = t
            RunLoop.main.add(t, forMode: .common)
        }
    }

    @objc private func onStatsTimer(_ timer: Timer) {
        guard let pc = self.pc else { return }
        pc.statistics { [weak self] report in
            guard let self = self else { return }
            var aIn:Int64=0,aOut:Int64=0,vIn:Int64=0,vOut:Int64=0
            for (_, s) in report.statistics {
                let t = s.type
                let v = s.values
                if t == "inbound-rtp" {
                    let media = (v["mediaType"] as? NSString) as String? ?? (v["kind"] as? NSString) as String? ?? ""
                    let bytes = (v["bytesReceived"] as? NSNumber)?.int64Value ?? 0
                    if media == "audio" { aIn += bytes } else if media == "video" { vIn += bytes }
                } else if t == "outbound-rtp" {
                    let media = (v["mediaType"] as? NSString) as String? ?? (v["kind"] as? NSString) as String? ?? ""
                    let bytes = (v["bytesSent"] as? NSNumber)?.int64Value ?? 0
                    if media == "audio" { aOut += bytes } else if media == "video" { vOut += bytes }
                }
            }
            let dAIn = max(0, aIn - self.lastBytes.aIn)
            let dAOut = max(0, aOut - self.lastBytes.aOut)
            let dVIn = max(0, vIn - self.lastBytes.vIn)
            let dVOut = max(0, vOut - self.lastBytes.vOut)
            self.lastBytes = (aIn,aOut,vIn,vOut)
            let audioOk = (dAIn*8 > 6_000*2) && (dAOut*8 > 6_000*2)
            let videoOk = (dVIn*8 > 100_000*2) && (dVOut*8 > 100_000*2)
            var bars = 0
            if audioOk { bars = videoOk ? 3 : 2 } else if (dAIn*8 > 2_000 || dAOut*8 > 2_000) { bars = 1 }
            if bars != self.signalBars { self.signalBars = bars }
        }
    }
    #endif
}