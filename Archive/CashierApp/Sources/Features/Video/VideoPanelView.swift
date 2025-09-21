import SwiftUI
#if canImport(WebRTC)
import WebRTC
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif

struct VideoPanelView: View {
    var brandLogoURL: URL? = nil
    var provider: String = "P2P"
    var bars: Int = 0
    var compact: Bool = false

    @EnvironmentObject private var env: EnvironmentStore
    @EnvironmentObject private var session: SessionStore

    @State private var isConnected = false
    @State private var liveDotPulse: Bool = false
    #if canImport(AVFoundation)
    @StateObject private var prePreview = PreconnectCameraController()
    #endif
    #if canImport(LiveKit)
    private var livekitHelper: LiveKitRTC? {
        session.providerTag == "Live" ? session.currentLiveKit : nil
    }
    private var livekitActuallyConnected: Bool {
        if let lk = livekitHelper, let room = lk.room {
            return room.connectionState == .connected
        }
        return false
    }
    #else
    private var livekitActuallyConnected: Bool { false }
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                // Remote video surface
                Rectangle().fill(Color.black)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(
                        Group {
                            #if canImport(LiveKit)
                            if let lk = livekitHelper {
                                LiveKitRemoteView(livekit: lk)
                            } else {
                                #if canImport(WebRTC)
                                RemoteVideoView(service: session.webRTCService)
                                #else
                                Text(currentConnected ? "Connected — awaiting remote video" : "Not connected").foregroundColor(.white.opacity(0.7))
                                #endif
                            }
                            #else
                                #if canImport(WebRTC)
                                RemoteVideoView(service: session.webRTCService)
                                #else
                                Text(currentConnected ? "Connected — awaiting remote video" : "Not connected").foregroundColor(.white.opacity(0.7))
                                #endif
                            #endif
                        }
                    )
                    .clipped()
                // Brand + live dot overlay (top-left)
                HStack(spacing: 6) {
                    if let url = brandLogoURL {
                        AsyncImage(url: url) { img in
                            img.resizable().scaledToFit()
                        } placeholder: { Color.clear }
                        .frame(height: compact ? 20 : 28)
                    }
                    if currentConnected {
                        Circle()
                            .fill(session.micMuted ? Color.orange : Color.green)
                            .frame(width: compact ? 8 : 10, height: compact ? 8 : 10)
                            .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 1))
                            .scaleEffect(liveDotPulse ? 1.15 : 0.9)
                            .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: liveDotPulse)
                            .onAppear { liveDotPulse = true }
                            .onDisappear { liveDotPulse = false }
                            .accessibilityLabel(session.micMuted ? "Local video live (mic muted)" : "Local video live")
                        if !remoteAttached {
                            Circle()
                                .fill(Color.red)
                                .frame(width: compact ? 8 : 10, height: compact ? 8 : 10)
                                .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 1))
                                .accessibilityLabel("Remote video pending")
                        }
                    }
                }
                .padding(8)
                // Controls (top-right) — hidden in compact PiP
                if !compact {
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 8) {
                            Button(currentConnected ? "Hang Up" : "Connect") {
                                if currentConnected { onHangup() } else { onConnect() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(currentConnected ? .red : .green)

                            Button(session.micMuted ? "Unmute" : "Mute") {
                                session.toggleMute()
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topTrailing)
                    .padding(8)
                }

                // Local PiP (bottom-right)
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Group {
                            // Show pre-connect AVFoundation preview until connected
                            #if canImport(AVFoundation)
                            if !currentConnected {
                                PreconnectLocalPreview(controller: prePreview)
                            } else {
                                #if canImport(LiveKit)
                                if let lk = livekitHelper {
                                    LiveKitLocalView(livekit: lk)
                                } else {
                                    #if canImport(WebRTC)
                                    LocalRTCView(service: session.webRTCService)
                                    #else
                                    Text("Preview").foregroundColor(.white)
                                    #endif
                                }
                                #else
                                    #if canImport(WebRTC)
                                    LocalRTCView(service: session.webRTCService)
                                    #else
                                    Text("Preview").foregroundColor(.white)
                                    #endif
                                #endif
                            }
                            #else
                                #if canImport(LiveKit)
                                if let lk = livekitHelper {
                                    LiveKitLocalView(livekit: lk)
                                } else {
                                    #if canImport(WebRTC)
                                    LocalRTCView(service: session.webRTCService)
                                    #else
                                    Text("Preview").foregroundColor(.white)
                                    #endif
                                }
                                #else
                                    #if canImport(WebRTC)
                                    LocalRTCView(service: session.webRTCService)
                                    #else
                                    Text("Preview").foregroundColor(.white)
                                    #endif
                                #endif
                            #endif
                        }
                        .frame(width: compact ? 56 : 140, height: compact ? 36 : 88)
                        .clipShape(RoundedRectangle(cornerRadius: compact ? 6 : 8))
                        .overlay(RoundedRectangle(cornerRadius: compact ? 6 : 8).stroke(Color.white.opacity(0.5), lineWidth: 1))
                        .shadow(radius: 3)
                        .padding(compact ? 4 : 8)
                    }
                }
            }
        }
        .onAppear {
            #if canImport(AVFoundation)
            prePreview.start()
            #endif
        }
    }

    private var currentConnected: Bool {
        #if canImport(LiveKit)
        return isConnected || livekitActuallyConnected
        #else
        return isConnected
        #endif
    }

    private var remoteAttached: Bool {
        #if canImport(LiveKit)
        if let lk = livekitHelper { return lk.remoteVideoAttached }
        #endif
        #if canImport(WebRTC)
        return session.webRTCService.remoteVideoTrack != nil
        #else
        return false
        #endif
    }

    private func onConnect() {
        #if canImport(AVFoundation)
        prePreview.stop()
        #endif
        Task { @MainActor in
            let s = session
            let e = env
            #if canImport(WebRTC)
            await s.connectRTC(env: e, webRTCService: s.webRTCService)
            #else
            await s.connectRTC(env: e)
            #endif
            isConnected = true
        }
    }

    private func onHangup() {
        Task { @MainActor in
            let s = session
            let e = env
            await s.stopRTC(env: e)
            isConnected = false
            #if canImport(AVFoundation)
            prePreview.start()
            #endif
        }
    }
}

