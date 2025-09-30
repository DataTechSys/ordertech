import Foundation
import OrderTechCore
import CryptoKit
import SwiftUI
#if canImport(LiveKit)
import LiveKit
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(WebRTC)
import WebRTC
#endif

// SharedLiveKitHost implementation moved here to resolve compilation visibility issues
final class SharedLiveKitHost {
    static let shared = SharedLiveKitHost()
    
    private var liveKitHost: SharedLiveKitHostImpl?
    
    private init() {
        #if canImport(LiveKit)
        liveKitHost = SharedLiveKitHostImpl()
        #endif
    }
    
    func clearAttachments() {
        #if canImport(LiveKit)
        liveKitHost?.clearAttachments()
        #endif
    }
}

#if canImport(LiveKit)
final class SharedLiveKitHostImpl {
    let videoView = VideoView()
    
    // Enhanced debouncing to prevent attachment loops
    private var lastAttachTime: Date = Date.distantPast
    private let attachDebounceInterval: TimeInterval = 0.5 // 500ms debounce
    private var attachTimer: Timer?
    private var currentLiveKit: LiveKitRTC?
    
    init() {
        videoView.contentMode = .scaleAspectFill
        videoView.layer.isOpaque = true
        videoView.isUserInteractionEnabled = false
        videoView.translatesAutoresizingMaskIntoConstraints = true
        videoView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        videoView.contentScaleFactor = UIScreen.main.scale
        videoView.clipsToBounds = false
        videoView.backgroundColor = .clear
    }

    func attach(livekit: LiveKitRTC?, into parent: UIView) {
        guard let livekit else { return }
        
        // Debounce multiple rapid attach calls
        let now = Date()
        if now.timeIntervalSince(lastAttachTime) < attachDebounceInterval {
            print("[SharedLiveKitHost] deferred re-attach attempt \(String(format: "%.2f", attachDebounceInterval - now.timeIntervalSince(lastAttachTime)))s - hasRemoteVideo: \(livekit.hasRemoteVideo)")
            return
        }
        lastAttachTime = now
        
        // Move video view to parent if needed
        if videoView.superview !== parent {
            videoView.removeFromSuperview()
            videoView.frame = parent.bounds
            parent.addSubview(videoView)
            print("[SharedLiveKitHost] moved video view to new parent container")
        } else if videoView.frame != parent.bounds {
            videoView.frame = parent.bounds
        }
        
        // Register the view with LiveKit
        print("[SharedLiveKitHost] registering video view with LiveKit - hasRemoteVideo: \(livekit.hasRemoteVideo)")
        livekit.setRemoteVideoView(videoView)
        currentLiveKit = livekit
        
        // Cancel any existing timer
        attachTimer?.invalidate()
        
        // Set up exponential backoff retries for connection issues
        scheduleRetryAttach(livekit: livekit, delay: 0.05, maxRetries: 7, currentRetry: 0)
    }
    
    private func scheduleRetryAttach(livekit: LiveKitRTC, delay: TimeInterval, maxRetries: Int, currentRetry: Int) {
        guard currentRetry < maxRetries else { return }
        
        attachTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            
            // Only retry if we haven't switched to a different LiveKit instance
            guard self.currentLiveKit === livekit else { return }
            
            // Skip retry if we already have a properly attached remote video
            if livekit.hasRemoteVideo && self.videoView.track != nil {
                return
            }
            
            let nextDelay: TimeInterval
            switch currentRetry {
            case 0: nextDelay = 0.15
            case 1: nextDelay = 0.35
            case 2: nextDelay = 0.7
            default: nextDelay = min(delay * 1.5, 2.0) // Cap at 2 seconds
            }
            
            print("[SharedLiveKitHost] deferred re-attach attempt \(String(format: "%.2f", nextDelay))s - hasRemoteVideo: \(livekit.hasRemoteVideo)")
            
            // Re-register with LiveKit
            livekit.setRemoteVideoView(self.videoView)
            
            // Schedule next retry
            self.scheduleRetryAttach(livekit: livekit, delay: nextDelay, maxRetries: maxRetries, currentRetry: currentRetry + 1)
        }
    }
    
    func clearAttachments() {
        attachTimer?.invalidate()
        attachTimer = nil
        currentLiveKit = nil
        videoView.track = nil
        lastAttachTime = Date.distantPast
        print("[SharedLiveKitHost] cleared all attachments and timers")
    }
}
#endif

// Phase A: Timeout helper for faster error handling
func withTimeout<T>(seconds: TimeInterval, operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw APIError(message: "Operation timed out after \(seconds) seconds")
        }
        defer { group.cancelAll() }
        return try await group.next()!
    }
}

#if canImport(LiveKit)
import Combine

// PRODUCTION LiveKit configuration with hardcoded credentials
// This bypasses server token request to avoid HTTP 503 errors
struct LiveKitConfig {
    static let websocketURL = "wss://ordertech-eemfrfsw.livekit.cloud"
    static let apiKey = "APIbYms65fpqX3f"
    static let apiSecret = "Lz3Ye8hHfP1M2qp8FfGSkIaYGeGPVqDaKf1YLymCyZ5C"
    
    static func generateToken(room: String, identity: String) -> String {
        // Define JWT claims according to LiveKit requirements
        let header = ["alg": "HS256", "typ": "JWT"]
        
        // Calculate expiration time (24 hours from now)
        let expirationTime = Int(Date().timeIntervalSince1970) + 86400
        
        // Create claims dictionary
        let claims: [String: Any] = [
            "exp": expirationTime,
            "iss": apiKey,
            "nbf": Int(Date().timeIntervalSince1970),
            "sub": identity,
            "video": ["room": room, "roomJoin": true, "canPublish": true, "canSubscribe": true]
        ]
        
        // Encode header and claims to base64url
        let jsonEncoder = JSONEncoder()
        guard let headerData = try? jsonEncoder.encode(header),
              let claimsData = try? JSONSerialization.data(withJSONObject: claims) else {
            return "" // Return empty string on encoding failure
        }
        
        let base64Header = headerData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        
        let base64Claims = claimsData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        
        // Create the signature input
        let signatureInput = "\(base64Header).\(base64Claims)"
        
        // Create HMAC-SHA256 signature
        let key = SymmetricKey(data: apiSecret.data(using: .utf8)!)
        let signature = HMAC<SHA256>.authenticationCode(for: signatureInput.data(using: .utf8)!, using: key)
        let signatureBase64 = Data(signature).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        
        // Combine to create JWT token
        return "\(signatureInput).\(signatureBase64)"
    }
}

final class LiveKitRTC: ObservableObject {
    enum LinkStatus: Equatable {
        case idle
        case tokenRequested
        case tokenReceived
        case roomConnecting
        case roomConnected
        case localPublishing
        case remotePending
        case remoteAttached
        case error(String)

        var text: String {
            switch self {
            case .idle: return "Idle"
            case .tokenRequested: return "Obtaining token…"
            case .tokenReceived: return "Token received"
            case .roomConnecting: return "Joining room…"
            case .roomConnected: return "Room connected"
            case .localPublishing: return "Publishing local video…"
            case .remotePending: return "Waiting for remote video…"
            case .remoteAttached: return "Connected"
            case .error(let m): return m.isEmpty ? "Connection error" : m
            }
        }
    }
    @Published var linkStatus: LinkStatus = .idle
    private(set) var signalBars: Int = 0
    private let pairId: String
    private let http: HttpClient
    private var room: Room?
    private weak var remoteView: VideoView?
    private weak var localView: VideoView?
    private var remoteTrack: VideoTrack?
    var hasRemoteVideo: Bool { remoteTrack != nil }
    private var remoteViews: [WeakVideoView] = []
    
    // Debouncing for attachIfAvailable to reduce excessive calls
    private var lastAttachTime: Date = Date.distantPast
    private let attachDebounceInterval: TimeInterval = 0.5 // 500ms debounce

    init(pairId: String, http: HttpClient) { self.pairId = pairId; self.http = http }

    func start() async throws {
        // Clear any stale state from previous connections
        print("[LiveKitRTC] start(): cleared all cached video state and debounce tasks")
        self.remoteTrack = nil
        self.remoteViews.removeAll()
        self.lastAttachTime = Date.distantPast
        SharedLiveKitHost.shared.clearAttachments()
        
        // Phase A: Pre-configure audio session early for faster setup
        #if canImport(WebRTC)
        let audio = RTCAudioSession.sharedInstance()
        audio.lockForConfiguration()
        do {
            try audio.setCategory(AVAudioSession.Category.playAndRecord.rawValue,
                                   with: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
            try audio.setMode(AVAudioSession.Mode.voiceChat.rawValue)
            try audio.setActive(true)
        } catch {}
        audio.unlockForConfiguration()
        #endif
        
        print("[LiveKitRTC] start() for pairId=\(pairId): generating local token…")
        await MainActor.run { self.linkStatus = .tokenRequested }
        
        // Generate token locally using hardcoded LiveKit credentials
        // This bypasses server token request to avoid HTTP 503 errors
        let participantName = "display-" + String(UUID().uuidString.prefix(8))
        let token = LiveKitConfig.generateToken(room: pairId, identity: participantName)
        let baseURL = LiveKitConfig.websocketURL
        
        print("[Display][LiveKit] Local token generated for room: \(pairId), participant: \(participantName)")
        await MainActor.run { self.linkStatus = .tokenReceived }
        
        // Phase A: Reuse room if available, otherwise create new
        let room: Room
        if let existingRoom = self.room {
            room = existingRoom
        } else {
            room = Room()
            self.room = room
            room.add(delegate: self)
        }
        
        // Phase A: Optimized connection options for faster setup
        let connectOptions = ConnectOptions(
            autoSubscribe: true
        )
        // Phase A: Optimized room options for stability and speed
        let roomOpts = RoomOptions(
            adaptiveStream: false,  // Stability first
            dynacast: true         // Dynamic broadcasting for efficiency
        )
        
        print("[Display][LiveKit] connecting to \(baseURL)…")
        await MainActor.run { self.linkStatus = .roomConnecting }
        try await room.connect(url: baseURL, token: token, connectOptions: connectOptions, roomOptions: roomOpts)
        print("[Display][LiveKit] room connected")
        await MainActor.run { self.linkStatus = .roomConnected }
        signalBars = 2
        // Enable mic/camera for visibility; admin can disable later (ensure permission + 16:9 capture)
        let lp = room.localParticipant
        #if canImport(AVFoundation)
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            if !granted { /* no camera access */ }
        }
        #endif
        #if canImport(LiveKit)
        // Display role: enable local video/audio so Cashier can see Display
        await MainActor.run { self.linkStatus = .localPublishing }
        let cam = CameraCaptureOptions(position: .front, dimensions: .h360_43, fps: 15)
        _ = try? await lp.setCamera(enabled: true, captureOptions: cam)
        _ = try? await lp.setMicrophone(enabled: true)
        print("[Display][LiveKit] local publishing enabled for Display role")
        #endif
        await MainActor.run { self.linkStatus = .remotePending }
        
        // Phase A: Aggressive track subscription for faster remote video
        await subscribeAllRemoteVideosAggressive()
        attachIfAvailable()
    }

    func stop() {
        print("[LiveKitRTC] stop(): begin")
        #if canImport(LiveKit)
        // Clear any UI bindings immediately on main thread
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // Clear all video view tracks
            self.localView?.track = nil
            self.remoteView?.track = nil
            for weakView in self.remoteViews {
                weakView.view?.track = nil
            }
            print("[LiveKitRTC] stop(): cleared all VideoView tracks (main thread)")
        }
        
        // Clear SharedLiveKitHost state to stop retry loops
        SharedLiveKitHost.shared.clearAttachments()
        
        // Clear all cached state more aggressively
        self.remoteTrack = nil
        self.remoteViews.removeAll()
        self.localView = nil
        self.remoteView = nil
        self.lastAttachTime = Date.distantPast // Reset debounce timer
        self.linkStatus = .idle
        print("[LiveKitRTC] stop(): end")
        
        // Perform async cleanup in background
        Task { [weak self] in
            guard let self = self else { return }
            
            // Capture room reference before clearing
            let roomToDisconnect = self.room
            
            // Clear references immediately to prevent further use
            await MainActor.run {
                self.remoteTrack = nil
                self.remoteViews.removeAll()
                self.room = nil
            }
            
            // Now safely disconnect the captured room
            guard let room = roomToDisconnect else { return }
            
            do {
                // Unsubscribe remote publications
                for (_, rp) in room.remoteParticipants {
                    for pub in rp.audioTracks { 
                        try? await (pub as? RemoteTrackPublication)?.set(subscribed: false) 
                    }
                    for pub in rp.videoTracks { 
                        try? await (pub as? RemoteTrackPublication)?.set(subscribed: false) 
                    }
                }
                
                // Disable local tracks
                let lp = room.localParticipant
                try? await lp.setMicrophone(enabled: false)
                try? await lp.setCamera(enabled: false)
                
                // Wait a bit for tracks to clean up
                try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
                
                // Disconnect room
                try await room.disconnect()
                print("[Display][LiveKit] Room disconnected successfully")
                
            } catch {
                print("[Display][LiveKit] Error during cleanup: \(error)")
                // Force disconnect if graceful cleanup failed
                try? await room.disconnect()
            }
            
            // Deactivate RTCAudioSession
            #if canImport(WebRTC)
            let audio = RTCAudioSession.sharedInstance()
            audio.lockForConfiguration()
            do { 
                try audio.setActive(false) 
                print("[Display][LiveKit] Audio session deactivated")
            } catch {
                print("[Display][LiveKit] Failed to deactivate audio session: \(error)")
            }
            audio.unlockForConfiguration()
            #endif
            
            print("[Display][LiveKit] Cleanup completed")
        }
        
        // Notify UI to refresh
        NotificationCenter.default.post(name: .displayKickVideo, object: nil)
        #endif
        signalBars = 0
    }

    func setMicMuted(_ muted: Bool) {
        #if canImport(LiveKit)
        print("[Display][LiveKit] *** setMicMuted called with muted: \(muted) ***")
        print("[Display][LiveKit] Room available: \(room != nil)")
        
        guard let room = room else {
            print("[Display][LiveKit] ERROR - no room available for setMicMuted")
            return
        }
        
        Task { [weak self] in
            guard let self = self else { return }
            guard let room = self.room else { return }
            
            let lp = room.localParticipant
            print("[Display][LiveKit] setMicMuted: current microphone enabled: \(lp.isMicrophoneEnabled())")
            
            do {
                let result = try await lp.setMicrophone(enabled: !muted)
                print("[Display][LiveKit] setMicMuted: setMicrophone(enabled: \(!muted)) returned: \(result)")
                print("[Display][LiveKit] setMicMuted: new microphone enabled: \(lp.isMicrophoneEnabled())")
                print("[Display][LiveKit] setMicMuted: SUCCESS")
            } catch {
                print("[Display][LiveKit] setMicMuted: ERROR - \(error.localizedDescription)")
            }
        }
        #endif
    }

    func setRemoteVideoView(_ view: VideoView) {
        print("[LiveKitRTC] setRemoteVideoView called, hasRemoteTrack: \(remoteTrack != nil), linkStatus: \(linkStatus)")
        self.remoteView = view
        remoteViews = remoteViews.filter { $0.view != nil }
        if !remoteViews.contains(where: { $0.view === view }) {
            remoteViews.append(WeakVideoView(view))
        }
        
        // Immediately attach if we have a cached remote track
        if let track = remoteTrack {
            DispatchQueue.main.async {
                view.track = track
                print("[LiveKitRTC] Immediately attached cached remote track to new view")
            }
        }
        
        // Check if we have an inconsistent state (track available but status is remotePending)
        if remoteTrack != nil && linkStatus == .remotePending {
            print("[LiveKitRTC] hasRemoteVideo inconsistency: hasTrack=true linkStatus=\(linkStatus)")
            // Force state update to remoteAttached since we clearly have a track
            DispatchQueue.main.async {
                self.linkStatus = .remoteAttached
            }
        }
        
        // Always call attachIfAvailable to scan for any available tracks
        attachIfAvailable()
    }
    func setLocalVideoView(_ view: VideoView) { self.localView = view; attachIfAvailable() }

    private func attachIfAvailable() {
        // Debounce to prevent excessive calls
        let now = Date()
        if now.timeIntervalSince(lastAttachTime) < attachDebounceInterval {
            print("[LiveKitRTC] attachRemoteIfAvailable: skipping due to debounce (last call \(String(format: "%.2f", now.timeIntervalSince(lastAttachTime)))s ago)")
            return
        }
        lastAttachTime = now
        
        guard let r = room else {
            print("[LiveKitRTC] attachRemoteIfAvailable: no room available")
            return
        }
        
        // Handle remote video attachment
        if let rv = remoteView {
            // Prefer cached track if available
            if let t = remoteTrack {
                let all = remoteViews.compactMap { $0.view } + [rv]
                print("[LiveKitRTC] attachRemoteIfAvailable: attaching cached track to \(all.count) views")
                DispatchQueue.main.async { 
                    all.forEach { $0.track = t }
                    print("[LiveKitRTC] attachRemoteIfAvailable: setting track on view VideoView(track: \(t))")
                }
                // Update status if we successfully attached a track
                if linkStatus == .remotePending {
                    DispatchQueue.main.async {
                        self.linkStatus = .remoteAttached
                    }
                }
            } else {
                // Scan for available remote tracks
                print("[LiveKitRTC] attachRemoteIfAvailable: searching \(r.remoteParticipants.count) remote participants")
                for (_, rp) in r.remoteParticipants {
                    print("[LiveKitRTC] attachRemoteIfAvailable: checking participant \(rp.identity?.stringValue ?? "unknown") with \(rp.videoTracks.count) video tracks")
                    for pub in rp.videoTracks {
                        if let track = pub.track as? VideoTrack { 
                            print("[LiveKitRTC] attachRemoteIfAvailable: found subscribed video track, caching and attaching")
                            self.remoteTrack = track
                            let all = self.remoteViews.compactMap { $0.view } + [rv]
                            DispatchQueue.main.async { 
                                all.forEach { $0.track = track }
                                print("[LiveKitRTC] attachRemoteIfAvailable: setting track on view VideoView(track: \(track))")
                                // Update status to indicate successful attachment
                                self.linkStatus = .remoteAttached
                            }
                            return // Found and attached, exit early
                        }
                    }
                }
                print("[LiveKitRTC] attachRemoteIfAvailable: no remote video tracks found")
            }
        }
        
        // Handle local video attachment
        if let lv = localView {
            if let pub = r.localParticipant.localVideoTracks.first, let track = pub.track as? LocalVideoTrack {
                DispatchQueue.main.async {
                    lv.track = track
                    print("[Display][LiveKit] Local video track attached to PiP")
                    NotificationCenter.default.post(name: .displayLocalCameraReady, object: nil)
                }
            }
        }
    }

    // Phase A: Original subscription method (kept for compatibility)
    private func subscribeAllRemoteVideos() {
        guard let r = room else { return }
        Task {
            for (_, rp) in r.remoteParticipants {
                for pub in rp.videoTracks {
                    if let p = pub as? RemoteTrackPublication {
                        _ = try? await p.set(subscribed: true)
                    }
                }
            }
        }
    }
    
    // Phase A: Aggressive subscription for faster remote video attachment
    private func subscribeAllRemoteVideosAggressive() async {
        guard let r = room else { return }
        
        // Subscribe to existing remote participants immediately
        let subscriptionTasks = r.remoteParticipants.compactMap { (_, rp) in
            Task {
                for pub in rp.videoTracks {
                    if let p = pub as? RemoteTrackPublication {
                        do {
                            try await p.set(subscribed: true)
                            print("[Display][LiveKit] Aggressively subscribed to video track from \(rp.identity?.stringValue ?? "unknown")")
                        } catch {
                            print("[Display][LiveKit] Failed to subscribe to video track: \(error)")
                        }
                    }
                }
                // Also subscribe to audio for better sync
                for pub in rp.audioTracks {
                    if let p = pub as? RemoteTrackPublication {
                        _ = try? await p.set(subscribed: true)
                    }
                }
            }
        }
        
        // Wait for all subscriptions to complete
        for task in subscriptionTasks {
            await task.value
        }
    }
}
#endif

#if canImport(LiveKit)
extension LiveKitRTC: RoomDelegate {
    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack track: Track, publication: RemoteTrackPublication) {
        print("[LiveKitRTC] didSubscribeTrack: \(track.kind) from participant \(participant.identity?.stringValue ?? "unknown")")
        if let v = track as? VideoTrack {
            self.remoteTrack = v
            print("[LiveKitRTC] remote video track cached successfully")
            
            // Get all available views
            let views = (remoteViews.compactMap { $0.view }) + (remoteView != nil ? [remoteView!].compactMap{$0} : [])
            
            DispatchQueue.main.async {
                // Update link status to indicate successful track subscription
                if self.linkStatus == .remotePending {
                    self.linkStatus = .remoteAttached
                    print("[LiveKitRTC] connection state updated from remotePending to remoteAttached")
                }
                
                if !views.isEmpty {
                    print("[LiveKitRTC] attaching remote track to \(views.count) video views")
                    views.forEach { view in
                        view.track = v
                        print("[LiveKitRTC] attached track to VideoView: \(view)")
                    }
                } else {
                    print("[LiveKitRTC] remote video track received but no views available yet")
                }
                
                // Clear any retry timers since we now have a successful connection
                SharedLiveKitHost.shared.clearAttachments()
                
                // Always nudge UI to refresh when remote attaches
                NotificationCenter.default.post(name: Notification.Name("OT.Display.KickVideo"), object: nil)
                NotificationCenter.default.post(name: .displayKickVideo, object: nil)
            }
        }
    }
    // Local track published — attach to local PiP
    func room(_ room: Room, localParticipant: LocalParticipant, didPublishTrack track: Track, publication: LocalTrackPublication) {
        print("[Display][LiveKit] local track published: \(track.kind)")
        guard let ltrack = track as? LocalVideoTrack, let lv = self.localView else {
            print("[Display][LiveKit] local video track published but no local view bound yet")
            return
        }
        DispatchQueue.main.async {
            lv.track = ltrack
            print("[Display][LiveKit] local video view updated")
            // Nudge UI to ensure PiP view updates when local publishes
            NotificationCenter.default.post(name: .displayLocalCameraReady, object: nil)
            NotificationCenter.default.post(name: Notification.Name("OT.Display.KickVideo"), object: nil)
        }
    }
    
    func room(_ room: Room, didConnectParticipant participant: RemoteParticipant) {
        print("[Display][LiveKit] remote participant connected: \(participant.identity?.stringValue ?? "unknown") with \(participant.videoTracks.count) video tracks")
        subscribeAllRemoteVideos()
    }
    
    func room(_ room: Room, didDisconnectParticipant participant: RemoteParticipant) {
        print("[Display][LiveKit] remote participant disconnected: \(participant.identity?.stringValue ?? "unknown")")
    }
    
    func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        print("[Display][LiveKit] remote participant \(participant.identity?.stringValue ?? "unknown") published \(publication.kind) track")
        if publication.kind == .video {
            Task {
                do {
                    try await publication.set(subscribed: true)
                    print("[Display][LiveKit] subscribed to remote video track from \(participant.identity?.stringValue ?? "unknown")")
                } catch {
                    print("[Display][LiveKit] failed to subscribe to remote video: \(error.localizedDescription)")
                }
            }
        }
    }
    
    func room(_ room: Room, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication) {
        print("[Display][LiveKit] remote participant \(participant.identity?.stringValue ?? "unknown") unpublished \(publication.kind) track")
    }
}
#endif

#if canImport(LiveKit)
private final class WeakVideoView {
    weak var view: VideoView?
    init(_ v: VideoView) { self.view = v }
}
#endif
