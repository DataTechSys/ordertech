import Foundation
#if canImport(WebRTC)
@preconcurrency import WebRTC
import AVFoundation
import UIKit
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

    // Adaptive capture state
    private var currentCaptureDevice: AVCaptureDevice?
    private var currentCaptureFormat: AVCaptureDevice.Format?
    private var currentCaptureFps: Int = 24
    private var pausedDueToThermal: Bool = false

    // Observers & timers
    private var answerPollTimer: Timer?
    private var candidatesTimer: Timer?
    private var statsTimer: Timer?
    private var adaptDebounceTimer: Timer?
    private var thermalObserver: NSObjectProtocol?
    private var powerObserver: NSObjectProtocol?
    private var batteryLevelObserver: NSObjectProtocol?
    private var batteryStateObserver: NSObjectProtocol?

    private var lastBytes: (aIn:Int64,aOut:Int64,vIn:Int64,vOut:Int64) = (0,0,0,0)
    private var stopped = false
    private var candidatesBurstLeft: Int = 0
    private var started = false
    private var isApplyingOffer: Bool = false
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
        if started { print("[P2P(Display)] start() ignored — already started"); return }
        print("[P2P(Display)] start for pairId=\(pairId)")
        // As the answerer, do not preclear or start a session — the offerer (Cashier) controls session lifecycle.
        do {
            try await startRTC()
            started = true
        } catch {
            started = false
            throw error
        }
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
            self.adaptDebounceTimer?.invalidate(); self.adaptDebounceTimer = nil
        }
        teardownThermalAndPowerMonitoring()
        capturer?.stopCapture(); capturer = nil
        audioTrack = nil
        videoTrack = nil
        pc?.close(); pc = nil
        Task { @MainActor in
            service?.localVideoTrack = nil
            service?.remoteVideoTrack = nil
        }
        started = false
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
        // Tag as preclear so peers don't bounce back to default subscription
        _ = try? await http.request("/webrtc/session/\(pairId)?reason=preclear", method: "DELETE", decode: HttpClient.Empty.self)
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

        guard let factory = await service?.factory else { print("[P2P(Display)] factory missing"); throw APIError(message: "webrtc_factory_missing") }

        let cfg = RTCConfiguration()
        cfg.sdpSemantics = .unifiedPlan
        // Use basic Google STUN; your server can expose TURN via /webrtc/config in the future if needed
        cfg.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement":"true"])
        guard let pc = factory.peerConnection(with: cfg, constraints: constraints, delegate: nil) as RTCPeerConnection? else {
            throw APIError(message: "pc_create_failed")
        }
        self.pc = pc
        print("[P2P(Display)] pc created; starting media & timers")

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

        // Do not add local tracks or transceivers up front. As the answerer,
        // let the remote offer define the receivers/transceivers, then create an answer.

        // Wait for cashier offer then create & post answer
        print("[P2P(Display)] answer polling begin")
        startAnswerPolling()
        print("[P2P(Display)] candidates polling begin (burst)")
        startCandidatesPolling(initialBurst: true)
        // Stats collection temporarily disabled to avoid strict-concurrency warnings
    }

    private func startAnswerPolling() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.answerPollTimer?.invalidate()
            // Fast burst for ~3s, then back off to reduce offer→answer latency
            let fastInterval: TimeInterval = 0.25
            let slowInterval: TimeInterval = 1.5
            var burstsLeft = 12 // ~3s total
            let t = Timer.scheduledTimer(withTimeInterval: fastInterval, repeats: true) { [weak self] timer in
                guard let self = self else { timer.invalidate(); return }
                // Do not poll if WS offer is being applied
                if self.isApplyingOffer { return }
                self.onAnswerPollTimer(timer)
                burstsLeft -= 1
                if burstsLeft <= 0 {
                    timer.invalidate()
                    let slow = Timer.scheduledTimer(timeInterval: slowInterval, target: self, selector: #selector(self.onAnswerPollTimer), userInfo: nil, repeats: true)
                    self.answerPollTimer = slow
                    RunLoop.main.add(slow, forMode: .common)
                }
            }
            self.answerPollTimer = t
            RunLoop.main.add(t, forMode: .common)
        }
    }

    @objc private func onAnswerPollTimer(_ timer: Timer) {
        guard let pc = self.pc, !self.stopped else { return }
        Task {
            do {
                // Skip polling work if we are applying a WS offer already
                if self.isApplyingOffer { return }
                struct Offer: Decodable { let sdp: String? }
                let o: Offer = try await self.http.request("/webrtc/offer?pairId=\(self.pairId)")
                if self.isApplyingOffer { return }
                if let sdp = o.sdp, pc.remoteDescription == nil {
                    print("[P2P(Display)] polled offer; applying; len=\(sdp.count)")
                    do {
                        let remote = RTCSessionDescription(type: .offer, sdp: sdp)
                        
                        // Use async/await for better error handling
                        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                            pc.setRemoteDescription(remote) { error in
                                if let error = error {
                                    print("[P2P(Display)] setRemoteDescription(poll) error: \(error.localizedDescription)")
                                    continuation.resume(throwing: error)
                                } else {
                                    continuation.resume()
                                }
                            }
                        }
                        
                        let cons = RTCMediaConstraints(mandatoryConstraints: [
                            kRTCMediaConstraintsOfferToReceiveAudio: kRTCMediaConstraintsValueTrue,
                            kRTCMediaConstraintsOfferToReceiveVideo: kRTCMediaConstraintsValueTrue
                        ], optionalConstraints: nil)
                        
                        let answerSdp = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RTCSessionDescription, Error>) in
                            pc.answer(for: cons) { sdp, error in
                                if let error = error {
                                    print("[P2P(Display)] answer(poll) error: \(error.localizedDescription)")
                                    continuation.resume(throwing: error)
                                } else if let sdp = sdp {
                                    continuation.resume(returning: sdp)
                                } else {
                                    print("[P2P(Display)] answer(poll) returned nil SDP")
                                    continuation.resume(throwing: APIError(message: "answer_nil"))
                                }
                            }
                        }
                        
                        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                            pc.setLocalDescription(answerSdp) { error in
                                if let error = error {
                                    print("[P2P(Display)] setLocalDescription(poll) error: \(error.localizedDescription)")
                                    continuation.resume(throwing: error)
                                } else {
                                    continuation.resume()
                                }
                            }
                        }
                        
                        // Post answer to server
                        let data = try JSONSerialization.data(withJSONObject: ["pairId": self.pairId, "sdp": answerSdp.sdp])
                        _ = try await self.http.request("/webrtc/answer", method: "POST", headers: [:], body: data, decode: HttpClient.Empty.self)
                        print("[P2P(Display)] posted answer via poll; len=\(answerSdp.sdp.count)")
                        
                    } catch {
                        print("[P2P(Display)] poll offer handling failed: \(error.localizedDescription)")
                    }
                    self.answerPollTimer?.invalidate(); self.answerPollTimer = nil
                }
            } catch { /* keep polling */ }
        }
    }

    // Handle offer delivered over WebSocket: set remote, create answer, post via HTTP, and ensure candidates polling is active.
    func handleOfferFromWS(sdp offerSDP: String) {
        #if canImport(WebRTC)
        Task { [weak self] in
            guard let self = self else { return }
            // Cancel polling immediately to avoid duplicate apply
            DispatchQueue.main.async { [weak self] in self?.answerPollTimer?.invalidate(); self?.answerPollTimer = nil }
            // Ensure PC exists
            if self.pc == nil {
                try? await self.startRTC()
            }
            guard let pc = self.pc else { return }
            if self.isApplyingOffer { print("[P2P(Display)] WS offer ignored — already applying"); return }
            if pc.remoteDescription != nil { print("[P2P(Display)] WS offer ignored — remote already set"); return }
            self.isApplyingOffer = true
            let remote = RTCSessionDescription(type: .offer, sdp: offerSDP)
            print("[P2P(Display)] WS offer received; applying; len=\(offerSDP.count)")
            
            do {
                // Use async/await for better error handling and sequencing
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    pc.setRemoteDescription(remote) { error in
                        if let error = error {
                            print("[P2P(Display)] setRemoteDescription error: \(error.localizedDescription)")
                            continuation.resume(throwing: error)
                        } else {
                            print("[P2P(Display)] setRemoteDescription ok")
                            continuation.resume()
                        }
                    }
                }
                
                let cons = RTCMediaConstraints(mandatoryConstraints: [
                    kRTCMediaConstraintsOfferToReceiveAudio: kRTCMediaConstraintsValueTrue,
                    kRTCMediaConstraintsOfferToReceiveVideo: kRTCMediaConstraintsValueTrue
                ], optionalConstraints: nil)
                
                let answerSdp = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RTCSessionDescription, Error>) in
                    pc.answer(for: cons) { sdp, error in
                        if let error = error {
                            print("[P2P(Display)] answer() error: \(error.localizedDescription)")
                            continuation.resume(throwing: error)
                        } else if let sdp = sdp {
                            print("[P2P(Display)] answer created; len=\(sdp.sdp.count)")
                            continuation.resume(returning: sdp)
                        } else {
                            print("[P2P(Display)] answer() returned nil SDP")
                            continuation.resume(throwing: APIError(message: "answer_nil"))
                        }
                    }
                }
                
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    pc.setLocalDescription(answerSdp) { error in
                        if let error = error {
                            print("[P2P(Display)] setLocalDescription error: \(error.localizedDescription)")
                            continuation.resume(throwing: error)
                        } else {
                            print("[P2P(Display)] setLocalDescription ok")
                            continuation.resume()
                        }
                    }
                }
                
                // Post answer to server
                let data = try JSONSerialization.data(withJSONObject: ["pairId": self.pairId, "sdp": answerSdp.sdp])
                _ = try await self.http.request("/webrtc/answer", method: "POST", headers: [:], body: data, decode: HttpClient.Empty.self)
                print("[P2P(Display)] posted answer via WS; len=\(answerSdp.sdp.count)")
                
                // Stop polling since we handled the offer
                DispatchQueue.main.async { [weak self] in
                    self?.answerPollTimer?.invalidate(); self?.answerPollTimer = nil
                }
                
            } catch {
                print("[P2P(Display)] handleOfferFromWS failed: \(error.localizedDescription)")
            }
            
            self.isApplyingOffer = false
            
            // Ensure candidates polling is active
            DispatchQueue.main.async { [weak self] in
                self?.startCandidatesPolling(initialBurst: true)
            }
        }
        #endif
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

    // MARK: - Adaptive capture

    private enum CaptureProfile {
        case paused
        case active(width: Int, height: Int, fps: Int)
    }

    private func setupThermalAndPowerMonitoring() {
        let nc = NotificationCenter.default
        thermalObserver = nc.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.onThermalOrPowerChanged()
        }
        powerObserver = nc.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
            self?.onThermalOrPowerChanged()
        }
        UIDevice.current.isBatteryMonitoringEnabled = true
        batteryLevelObserver = nc.addObserver(forName: UIDevice.batteryLevelDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.onThermalOrPowerChanged()
        }
        batteryStateObserver = nc.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.onThermalOrPowerChanged()
        }
        // Apply once at startup
        onThermalOrPowerChanged()
    }

    private func teardownThermalAndPowerMonitoring() {
        let nc = NotificationCenter.default
        if let o = thermalObserver { nc.removeObserver(o) }
        if let o = powerObserver { nc.removeObserver(o) }
        if let o = batteryLevelObserver { nc.removeObserver(o) }
        if let o = batteryStateObserver { nc.removeObserver(o) }
        thermalObserver = nil
        powerObserver = nil
        batteryLevelObserver = nil
        batteryStateObserver = nil
        UIDevice.current.isBatteryMonitoringEnabled = false
    }

    private func onThermalOrPowerChanged() {
        adaptDebounceTimer?.invalidate()
        adaptDebounceTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            let profile = self.computeCaptureProfile()
            self.applyCaptureProfile(profile)
        }
        if let t = adaptDebounceTimer { RunLoop.main.add(t, forMode: .common) }
    }

    private func computeCaptureProfile() -> CaptureProfile {
        let thermal = ProcessInfo.processInfo.thermalState
        // Base profile by thermal state
        var profile: CaptureProfile
        switch thermal {
        case .critical:
            profile = .paused
        case .serious:
            profile = .active(width: 640, height: 360, fps: 15)
        case .fair:
            profile = .active(width: 960, height: 540, fps: 24)
        default: // .nominal and future unknown values
            profile = .active(width: 1280, height: 720, fps: 24)
        }
        // Degrade one step if Low Power Mode or very low battery
        let lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        let level = UIDevice.current.batteryLevel // -1.0 if not available
        let batteryLow = (level >= 0 && level < 0.20)
        if lowPower || batteryLow {
            profile = degrade(profile)
        }
        return profile
    }

    private func degrade(_ profile: CaptureProfile) -> CaptureProfile {
        switch profile {
        case .paused:
            return .paused
        case .active(let w, let h, let fps):
            // Map to next lower tier
            if w >= 1280 || h >= 720 { return .active(width: 960, height: 540, fps: min(fps, 24)) }
            if w >= 960 || h >= 540 { return .active(width: 640, height: 360, fps: 15) }
            return .paused
        }
    }

    private func applyCaptureProfile(_ profile: CaptureProfile) {
        guard let capturer = self.capturer else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            switch profile {
            case .paused:
                if !self.pausedDueToThermal {
                    capturer.stopCapture()
                    self.pausedDueToThermal = true
                }
            case .active(let w, let h, var fps):
                guard let device = self.currentCaptureDevice ?? (RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front }) ?? RTCCameraVideoCapturer.captureDevices().first) else {
                    return
                }
                self.currentCaptureDevice = device
                // Choose the best matching format for the target size
                guard let fmt = self.bestFormat(for: device, targetWidth: w, targetHeight: h, desiredFps: fps) else { return }
                // Clamp fps to format capability
                let ranges = fmt.videoSupportedFrameRateRanges
                if let max = ranges.map({ $0.maxFrameRate }).max() { fps = min(Int(max), fps) }
                if let minF = ranges.map({ $0.minFrameRate }).min() { fps = max(Int(minF), fps) }

                let shouldRestart = self.pausedDueToThermal || (self.currentCaptureFormat?.formatDescription != fmt.formatDescription) || (self.currentCaptureFps != fps)
                if shouldRestart {
                    capturer.stopCapture()
                    capturer.startCapture(with: device, format: fmt, fps: fps, completionHandler: { _ in })
                    self.currentCaptureFormat = fmt
                    self.currentCaptureFps = fps
                    self.pausedDueToThermal = false
                }
            }
        }
    }

    private func bestFormat(for device: AVCaptureDevice, targetWidth: Int, targetHeight: Int, desiredFps: Int) -> AVCaptureDevice.Format? {
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        var best: AVCaptureDevice.Format?
        var bestScore = Int.max
        for f in formats {
            let desc = f.formatDescription
            let dims = CMVideoFormatDescriptionGetDimensions(desc)
            let w = Int(dims.width)
            let h = Int(dims.height)
            // Score: absolute difference in area + bias towards NV12 (420f)
            let areaDiff = abs(w * h - targetWidth * targetHeight)
            let subtype = CMFormatDescriptionGetMediaSubType(desc)
            let isNV12 = subtype == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || subtype == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            let fpsOk = f.videoSupportedFrameRateRanges.contains { r in
                Double(desiredFps) <= r.maxFrameRate && Double(desiredFps) >= r.minFrameRate
            }
            let penalty = (isNV12 ? 0 : 5_000) + (fpsOk ? 0 : 1_000)
            let score = areaDiff + penalty
            if score < bestScore {
                bestScore = score
                best = f
            }
        }
        return best ?? formats.first
    }

    #endif
}
