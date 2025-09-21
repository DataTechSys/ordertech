import SwiftUI

struct FloatingVideoBubble: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var session: SessionStore

    // Smaller PiP with 16:9 aspect (no button underneath)
    private let width: CGFloat = 96
    private var height: CGFloat { width * 16.0 / 9.0 } // portrait 9:16
    private var bubbleHeight: CGFloat { height }

    // Drag state
    @State private var pos: CGPoint? = nil
    @State private var dragStart: CGPoint? = nil
    // Controls overlay
    @State private var showControls: Bool = false
    @State private var controlsAutoHideTask: Task<Void, Never>? = nil

    var body: some View {
        GeometryReader { proxy in
            let W = proxy.size.width
            let H = proxy.size.height
            let margin: CGFloat = 8
            let topPad: CGFloat = 56
            let TL = CGPoint(x: margin + width/2, y: topPad + bubbleHeight/2)
            let TR = CGPoint(x: W - margin - width/2, y: topPad + bubbleHeight/2)
            let BL = CGPoint(x: margin + width/2, y: H - margin - bubbleHeight/2)
            let BR = CGPoint(x: W - margin - width/2, y: H - margin - bubbleHeight/2)
            let defaultPos = BL

            VStack(spacing: 6) {
                ZStack(alignment: .topTrailing) {
                    VideoPanelView(brandLogoURL: nil, provider: session.providerTag, bars: session.signalBars, compact: true)
                        .environmentObject(env)
                        .environmentObject(session)
                        .frame(width: width, height: height)
                        .background(DT.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(DT.line, lineWidth: 1))
                        .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)

                    if showControls {
                        controlsPanel
                            .padding(6)
                            .transition(.opacity.combined(with: .scale))
                    }
                }
            }
            .position(pos ?? defaultPos)
.onLongPressGesture(minimumDuration: 0.4) {
                let newState = !showControls
                withAnimation(.easeInOut(duration: 0.2)) { showControls = newState }
                if newState { scheduleAutoHideControls() } else { controlsAutoHideTask?.cancel() }
            }
            .gesture(
                DragGesture()
                    .onChanged { value in
                        let start = dragStart ?? (pos ?? defaultPos)
                        dragStart = start
                        let nx = start.x + value.translation.width
                        let ny = start.y + value.translation.height
                        let clampedX = min(max(margin + width/2, nx), W - margin - width/2)
                        let clampedY = min(max(topPad + bubbleHeight/2, ny), H - margin - bubbleHeight/2)
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.82)) {
                            pos = CGPoint(x: clampedX, y: clampedY)
                        }
                    }
                    .onEnded { _ in
                        let cur = pos ?? defaultPos
                        // Snap to nearest corner
                        let corners = [TL, TR, BL, BR]
                        let nearest = corners.min(by: { a, b in
                            let da = hypot(cur.x - a.x, cur.y - a.y)
                            let db = hypot(cur.x - b.x, cur.y - b.y)
                            return da < db
                        }) ?? defaultPos
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
                            pos = nearest
                        }
                        dragStart = pos
                    }
            )
        }
    }

    private func connectOrHang() async {
        if session.signalBars > 0 {
            await session.stopRTC(env: env)
        } else {
            #if canImport(WebRTC)
            await session.connectRTC(env: env, webRTCService: nil)
            #else
            await session.connectRTC(env: env)
            #endif
        }
    }

    private func scheduleAutoHideControls() {
        controlsAutoHideTask?.cancel()
        controlsAutoHideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            withAnimation(.easeOut(duration: 0.2)) { showControls = false }
        }
    }

    private var controlsPanel: some View {
        HStack(spacing: 6) {
            Button(action: { session.toggleMute() }) {
                HStack(spacing: 4) {
                    Image(systemName: session.micMuted ? "mic.slash.fill" : "mic.fill")
                    Text(session.micMuted ? "Unmute" : "Mute")
                }
                .font(.system(size: 11, weight: .semibold))
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(Capsule().fill(Color.white))
            }
            Button(action: { Task { await session.stopRTC(env: env) }; withAnimation { showControls = false } }) {
                HStack(spacing: 4) {
                    Image(systemName: "phone.down.fill")
                    Text("Hang Up")
                }
                .font(.system(size: 11, weight: .semibold))
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(Capsule().fill(Color.white))
            }
            .disabled(session.signalBars == 0)
        }
        .foregroundColor(.black)
        .overlay(
            Capsule().stroke(DT.line, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.12), radius: 3, x: 0, y: 1)
    }
}
