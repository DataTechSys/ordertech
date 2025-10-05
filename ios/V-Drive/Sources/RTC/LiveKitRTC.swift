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
    private var _videoView: VideoView?
    var videoView: VideoView {
        if let view = _videoView {
            return view
        }
        // Ensure VideoView is created on main thread
        if Thread.isMainThread {
            let view = VideoView()
            configureVideoView(view)
            _videoView = view
            return view
        } else {
            var view: VideoView!
            DispatchQueue.main.sync {
                view = VideoView()
                self.configureVideoView(view)
            }
            _videoView = view
            return view
        }
    }
    
    // Simplified debouncing to prevent attachment loops
    private var lastAttachTime: Date = Date.distantPast
    private let attachDebounceInterval: TimeInterval = 1.0 // Increased to 1 second debounce
    private var attachTimer: Timer?
    private var currentLiveKit: LiveKitRTC?
    
    init() {
        // VideoView creation is now deferred until first access and guaranteed on main thread
    }
    
    private func configureVideoView(_ videoView: VideoView) {
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
        
        // Set up simplified retry for connection issues
        scheduleRetryAttach(livekit: livekit, delay: 0.5, maxRetries: 3, currentRetry: 0)
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
            
            // Simplified linear delay progression
            let nextDelay: TimeInterval = min(delay + 0.5, 2.0) // Linear increase, cap at 2 seconds
            
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
        
        // Clear video view track on main thread
        if let view = _videoView {
            if Thread.isMainThread {
                view.track = nil
            } else {
                DispatchQueue.main.async {
                    view.track = nil
                }
            }
        }
        
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

// MARK: - Server-based LiveKit Token Response
struct RtcTokenResponse: Decodable {
    let provider: String
    let room: String
    let token: String
    let url: String
}

// MARK: - LiveKit Token Fetching
struct LiveKitTokenFetcher {
    static func fetchLiveKitToken(basketId: String, role: String) async throws -> RtcTokenResponse {
        var req = URLRequest(url: URL(string: "https://ordertech-715493130630.me-central1.run.app/rtc/token")!)
        req.httpMethod = "POST"
        req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody = [
            "provider": "livekit",
            "basketId": basketId,
            "role": role
        ]
        
        req.httpBody = try JSONEncoder().encode(requestBody)
        let (data, resp) = try await URLSession.shared.data(for: req)
        
        guard let httpResponse = resp as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            print("[LiveKitTokenFetcher] HTTP error: \((resp as? HTTPURLResponse)?.statusCode ?? -1)")
            throw URLError(.badServerResponse)
        }
        
        return try JSONDecoder().decode(RtcTokenResponse.self, from: data)
    }
}

// All LiveKit configuration now comes from server-based token fetching
// No hardcoded credentials needed - everything is managed by the backend

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
        case stopping
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
            case .stopping: return "Stopping…"
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
    
    // State management for preventing concurrent operations - using actor-safe approach
    @MainActor private var isStarting: Bool = false
    @MainActor private var isStopping: Bool = false
    
    // Debouncing for attachIfAvailable to reduce excessive calls
    private var lastAttachTime: Date = Date.distantPast
    private let attachDebounceInterval: TimeInterval = 0.5 // 500ms debounce

    init(pairId: String, http: HttpClient) { self.pairId = pairId; self.http = http }

    func start() async throws {
        // Prevent concurrent start operations using MainActor
        let currentStarting = await MainActor.run { self.isStarting }
        let currentStopping = await MainActor.run { self.isStopping }
        
        guard !currentStarting && !currentStopping else {
            let currentState = currentStarting ? "starting" : "stopping"
            print("[LiveKitRTC] start(): already \(currentState), ignoring duplicate request")
            throw APIError(message: "LiveKit is already \(currentState)")
        }
        
        guard linkStatus == .idle || linkStatus == .error("*") else {
            print("[LiveKitRTC] start(): invalid state \(linkStatus), must be idle or error")
            throw APIError(message: "LiveKit not in idle state for starting")
        }
        
        await MainActor.run { self.isStarting = true }
        
        defer { 
            Task {
                await MainActor.run {
                    self.isStarting = false
                }
            }
        }
        
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
        
        print("[LiveKitRTC] start() for pairId=\(pairId): fetching token from server…")
        await MainActor.run { self.linkStatus = .tokenRequested }
        
        // Fetch LiveKit token from server
        let tokenResponse: RtcTokenResponse
        do {
            tokenResponse = try await LiveKitTokenFetcher.fetchLiveKitToken(
                basketId: pairId,
                role: "display"
            )
        } catch {
            print("[LiveKitRTC] Failed to fetch token: \(error)")
            await MainActor.run { self.linkStatus = .error("Token fetch failed") }
            throw APIError(message: "livekit_token_fetch_failed")
        }
        
        let token = tokenResponse.token
        let baseURL = tokenResponse.url
        
        print("[Display][LiveKit] Server token received for room: \(tokenResponse.room)")
        await MainActor.run { self.linkStatus = .tokenReceived }
        
        // Always create a fresh room for clean state - no reuse to avoid stale connection issues
        let room = Room()
        
        // Clear any existing room reference to prevent conflicts
        if let existingRoom = self.room {
            print("[LiveKitRTC] Clearing existing room reference for fresh start")
            // Don't await disconnect here to avoid blocking - just clear reference
            self.room = nil
        }
        
        self.room = room
        room.add(delegate: self)
        
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
            if !granted { 
                print("[Display][LiveKit] ERROR: Camera access denied")
                await MainActor.run { self.linkStatus = .error("Camera access denied") }
                throw APIError(message: "Camera access required for video streaming")
            }
        } else if status == .denied {
            print("[Display][LiveKit] ERROR: Camera access previously denied")
            await MainActor.run { self.linkStatus = .error("Camera access denied") }
            throw APIError(message: "Camera access required for video streaming")
        }
        #endif
        #if canImport(LiveKit)
        // Display role: enable local video/audio so Cashier can see Display
        await MainActor.run { self.linkStatus = .localPublishing }
        
        // Reduced delay for faster initial connection - only wait for room to stabilize
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 second delay
        
        // Validate camera availability before attempting to initialize
        #if canImport(AVFoundation)
        let frontCamera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        let backCamera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        
        guard frontCamera != nil || backCamera != nil else {
            print("[Display][LiveKit] ERROR: No camera devices available")
            await MainActor.run { self.linkStatus = .error("No camera available") }
            throw APIError(message: "No camera capture devices available")
        }
        
        print("[Display][LiveKit] Camera availability validated - front: \(frontCamera != nil), back: \(backCamera != nil)")
        #endif
        
        // CRITICAL: Display app must ALWAYS use front camera for PiP consistency
        // Never fall back to back camera as this causes the PiP issue reported
        let preferredPosition: AVCaptureDevice.Position = .front
        
        // Only proceed with front camera if it's available
        guard frontCamera != nil else {
            print("[Display][LiveKit] ERROR: Front camera not available - this is required for Display role")
            await MainActor.run { self.linkStatus = .error("Front camera required") }
            throw APIError(message: "Display app requires front camera for PiP functionality")
        }
        
        let cam = CameraCaptureOptions(position: preferredPosition, dimensions: .h720_169, fps: 30)
        
        do {
            let cameraResult = try await lp.setCamera(enabled: true, captureOptions: cam)
            print("[Display][LiveKit] Camera enabled successfully with front camera: \(cameraResult)")
        } catch {
            print("[Display][LiveKit] ERROR: Failed to enable front camera: \(error.localizedDescription)")
            await MainActor.run { self.linkStatus = .error("Failed to enable front camera") }
            throw error
        }
        
        do {
            let micResult = try await lp.setMicrophone(enabled: true)
            print("[Display][LiveKit] Microphone enabled successfully: \(micResult)")
        } catch {
            print("[Display][LiveKit] ERROR: Failed to enable microphone: \(error.localizedDescription)")
            // Continue without microphone - not critical for display role
        }
        print("[Display][LiveKit] local publishing enabled for Display role")
        #endif
        await MainActor.run { self.linkStatus = .remotePending }
        
        // Phase A: Aggressive track subscription for faster remote video (non-blocking)
        Task {
            await subscribeAllRemoteVideosAggressive()
            attachIfAvailable()
        }
        
        print("[LiveKitRTC] start() completed successfully - enhanced provider should now be in connected state")
    }

    func stop() {
        // Prevent concurrent stop operations using MainActor (non-async version)
        Task {
            let currentStopping = await MainActor.run { self.isStopping }
            guard !currentStopping else {
                print("[LiveKitRTC] stop(): already stopping, ignoring duplicate request")
                return
            }
            
            let currentStarting = await MainActor.run { self.isStarting }
            if currentStarting {
                print("[LiveKitRTC] stop(): start in progress, marking for stop after completion")
                await MainActor.run { self.isStopping = true }
                return
            }
            
            await MainActor.run { self.isStopping = true }
            await performStopCleanup()
        }
    }
    
    private func performStopCleanup() async {
        
        print("[LiveKitRTC] stop(): begin")
        DispatchQueue.main.async {
            self.linkStatus = .stopping
        }
        
        #if canImport(LiveKit)
        // Clear any UI bindings immediately on main thread
        if Thread.isMainThread {
            // Clear all video view tracks
            self.localView?.track = nil
            self.remoteView?.track = nil
            for weakView in self.remoteViews {
                weakView.view?.track = nil
            }
            print("[LiveKitRTC] stop(): cleared all VideoView tracks (main thread)")
        } else {
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
        
        // Reset stopping flag
        await MainActor.run { self.isStopping = false }
        
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
                
                // Disable local tracks more aggressively
                let lp = room.localParticipant
                print("[Display][LiveKit] Disabling local camera and microphone...")
                try? await lp.setCamera(enabled: false)
                try? await lp.setMicrophone(enabled: false)
                
                // Note: Local tracks are automatically unpublished when camera/mic are disabled
                
                // Wait longer for tracks to clean up properly
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second delay
                
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
        print("[LiveKitRTC] setRemoteVideoView: view = \(view), current remoteViews count: \(remoteViews.count)")
        
        // Ensure view manipulation happens on main thread
        if Thread.isMainThread {
            self.remoteView = view
            remoteViews = remoteViews.filter { $0.view != nil }
            if !remoteViews.contains(where: { $0.view === view }) {
                remoteViews.append(WeakVideoView(view))
            }
            
            // Immediately attach if we have a cached remote track
            if let track = remoteTrack {
                view.track = track
                print("[LiveKitRTC] Immediately attached cached remote track to new view")
            }
            
            // Check if we have an inconsistent state (track available but status is remotePending)
            if remoteTrack != nil && linkStatus == .remotePending {
                print("[LiveKitRTC] hasRemoteVideo inconsistency: hasTrack=true linkStatus=\(linkStatus)")
                // Force state update to remoteAttached since we clearly have a track
                self.linkStatus = .remoteAttached
            }
        } else {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.remoteView = view
                self.remoteViews = self.remoteViews.filter { $0.view != nil }
                if !self.remoteViews.contains(where: { $0.view === view }) {
                    self.remoteViews.append(WeakVideoView(view))
                }
                
                // Immediately attach if we have a cached remote track
                if let track = self.remoteTrack {
                    view.track = track
                    print("[LiveKitRTC] Immediately attached cached remote track to new view")
                }
                
                // Check if we have an inconsistent state (track available but status is remotePending)
                if self.remoteTrack != nil && self.linkStatus == .remotePending {
                    print("[LiveKitRTC] hasRemoteVideo inconsistency: hasTrack=true linkStatus=\(self.linkStatus)")
                    // Force state update to remoteAttached since we clearly have a track
                    self.linkStatus = .remoteAttached
                }
            }
        }
        
        // Always call attachIfAvailable to scan for any available tracks
        attachIfAvailable()
    }
    func setLocalVideoView(_ view: VideoView) { self.localView = view; attachIfAvailable() }
    
    /// Public method to force video attachment refresh for diagnostic purposes
    func refreshVideoAttachment() {
        print("[LiveKitRTC] refreshVideoAttachment called - forcing video track re-attachment")
        attachIfAvailable()
    }

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
        
        // Subscribe to existing remote participants immediately with timeout
        let subscriptionTasks = r.remoteParticipants.compactMap { (_, rp) in
            Task {
                for pub in rp.videoTracks {
                    if let p = pub as? RemoteTrackPublication {
                        do {
                            // Add timeout to individual subscription to prevent hanging
                            try await withTimeout(seconds: 5.0) {
                                try await p.set(subscribed: true)
                            }
                            print("[Display][LiveKit] Aggressively subscribed to video track from \(rp.identity?.stringValue ?? "unknown")")
                        } catch {
                            print("[Display][LiveKit] Failed to subscribe to video track: \(error)")
                        }
                    }
                }
                // Also subscribe to audio for better sync with timeout
                for pub in rp.audioTracks {
                    if let p = pub as? RemoteTrackPublication {
                        do {
                            try await withTimeout(seconds: 3.0) {
                                try await p.set(subscribed: true)
                            }
                        } catch {
                            // Ignore audio subscription failures
                        }
                    }
                }
            }
        }
        
        // Wait for all subscriptions to complete with overall timeout
        do {
            try await withTimeout(seconds: 8.0) {
                for task in subscriptionTasks {
                    await task.value
                }
            }
            print("[Display][LiveKit] All remote track subscriptions completed successfully")
        } catch {
            print("[Display][LiveKit] Remote track subscription timeout - continuing anyway: \(error)")
            // Don't throw - continue with connection even if some subscriptions timeout
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
        print("[Display][LiveKit] *** LOCAL TRACK PUBLISHED ***")
        print("[Display][LiveKit] Track kind: \(track.kind)")
        print("[Display][LiveKit] Publication SID: \(publication.sid)")
        
        if track.kind == .video {
            print("[Display][LiveKit] *** VIDEO TRACK PUBLISHED - This should be visible to Cashier app ***")
        }
        
        guard let ltrack = track as? LocalVideoTrack, let lv = self.localView else {
            if track.kind == .video {
                print("[Display][LiveKit] local video track published but no local view bound yet")
            }
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
        print("[LiveKitRTC] remote participant connected: \(participant.identity?.stringValue ?? "unknown") with \(participant.videoTracks.count) video tracks")
        
        // Subscribe immediately to any existing tracks
        subscribeAllRemoteVideos()
        
        // Multiple retry strategy for better first-connection reliability
        Task {
            // First retry after short delay
            try? await Task.sleep(nanoseconds: 200_000_000) // 0.2 second delay
            print("[LiveKitRTC] performing first delayed subscription retry for \(participant.identity?.stringValue ?? "unknown")")
            
            for pub in participant.videoTracks {
                if let p = pub as? RemoteTrackPublication {
                    do {
                        try await p.set(subscribed: true)
                        print("[LiveKitRTC] first retry subscription successful for video track from \(participant.identity?.stringValue ?? "unknown")")
                        // If successful on first retry, trigger attachment check
                        DispatchQueue.main.async { self.attachIfAvailable() }
                    } catch {
                        print("[LiveKitRTC] first retry subscription failed: \(error)")
                    }
                }
            }
            
            // Second retry after longer delay for any remaining tracks
            try? await Task.sleep(nanoseconds: 500_000_000) // additional 0.5 second delay
            print("[LiveKitRTC] performing second delayed subscription retry for \(participant.identity?.stringValue ?? "unknown")")
            
            for pub in participant.videoTracks {
                if let p = pub as? RemoteTrackPublication {
                    do {
                        try await p.set(subscribed: true)
                        print("[LiveKitRTC] second retry subscription successful for video track from \(participant.identity?.stringValue ?? "unknown")")
                        // Force attachment check after second attempt
                        DispatchQueue.main.async { self.attachIfAvailable() }
                    } catch {
                        print("[LiveKitRTC] second retry subscription failed: \(error)")
                    }
                }
            }
        }
    }
    
    func room(_ room: Room, didDisconnectParticipant participant: RemoteParticipant) {
        print("[Display][LiveKit] remote participant disconnected: \(participant.identity?.stringValue ?? "unknown")")
    }
    
    func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        print("[LiveKitRTC] *** REMOTE TRACK PUBLISHED ***")
        print("[LiveKitRTC] Participant: \(participant.identity?.stringValue ?? "unknown")")
        print("[LiveKitRTC] Track kind: \(publication.kind)")
        print("[LiveKitRTC] Track SID: \(publication.sid)")
        print("[LiveKitRTC] Current linkStatus: \(linkStatus)")
        
        if publication.kind == .video {
            print("[LiveKitRTC] *** VIDEO TRACK PUBLISHED BY REMOTE - Attempting subscription ***")
            Task {
                do {
                    try await publication.set(subscribed: true)
                    print("[LiveKitRTC] *** SUCCESSFULLY SUBSCRIBED TO REMOTE VIDEO ***")
                    print("[LiveKitRTC] Video track should now be available for display")
                    print("[LiveKitRTC] Subscription completed - waiting for didSubscribeTrack callback...")
                } catch {
                    print("[LiveKitRTC] *** FAILED TO SUBSCRIBE TO REMOTE VIDEO: \(error.localizedDescription) ***")
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
