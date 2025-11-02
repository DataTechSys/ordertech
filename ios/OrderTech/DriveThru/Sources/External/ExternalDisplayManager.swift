import SwiftUI
import UIKit
import Combine
import OrderTechCore

/// Manages external display connection and presentation
@MainActor
final class ExternalDisplayManager: ObservableObject {
    @Published var isExternalDisplayConnected = false
    @Published var externalScreen: UIScreen?
    
    private var externalWindow: UIWindow?
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        startMonitoring()
    }
    
    deinit {
        Task { @MainActor in
            stopMonitoring()
        }
    }
    
    /// Start monitoring for external display connections
    func startMonitoring() {
        // Check if external screen is already connected
        updateExternalScreenState()
        
        // Monitor screen connection/disconnection
        NotificationCenter.default.publisher(for: UIScreen.didConnectNotification)
            .sink { [weak self] notification in
                Task { @MainActor in
                    self?.handleScreenConnected(notification)
                }
            }
            .store(in: &cancellables)
        
        NotificationCenter.default.publisher(for: UIScreen.didDisconnectNotification)
            .sink { [weak self] notification in
                Task { @MainActor in
                    self?.handleScreenDisconnected(notification)
                }
            }
            .store(in: &cancellables)
    }
    
    /// Stop monitoring external displays
    func stopMonitoring() {
        cancellables.removeAll()
        disconnectExternalDisplay()
    }
    
    /// Present content on external display using the external UIWindowScene
    func presentOnExternalDisplay(
        content: AnyView,
        orientationModel: OrientationModel
    ) {
        // Find an external display UIWindowScene created by the system
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let extScene = scenes.first(where: { $0.session.role.rawValue == "UIWindowSceneSessionRoleExternalDisplay" }) ??
                       scenes.first(where: { $0.screen != UIScreen.main })

        // Close existing external window (if any) to avoid duplicates when re-presenting
        if let existing = self.externalWindow {
            existing.isHidden = true
            self.externalWindow = nil
        }

        if let windowScene = extScene {
            print("[ExternalDisplayManager] External UIWindowScene ready — role: \(windowScene.session.role.rawValue), activationState: \(windowScene.activationState)")
            print("[ExternalDisplayManager] External screen bounds: \(windowScene.screen.bounds), traitCollection: \(windowScene.traitCollection)")

            // Create a window on the external scene
            let window = UIWindow(windowScene: windowScene)
            window.frame = windowScene.screen.bounds
            window.backgroundColor = UIColor.black
            window.windowLevel = UIWindow.Level.normal

            // Build external display SwiftUI view (rotate/scale at the UIView layer)
            let contentView = ExternalDisplayContentView(
                content: content,
                orientationModel: orientationModel,
                externalScreenBounds: windowScene.screen.bounds
            )
            .environmentObject(orientationModel)
            .environment(\.isExternalContext, true)

            let hosting = UIHostingController(rootView: contentView)
            hosting.view.backgroundColor = UIColor.black
            // Render at iPhone portrait size, then rotate + scale at the view layer
            let deviceSize = UIScreen.main.bounds.size
            hosting.view.bounds = CGRect(origin: .zero, size: deviceSize)
            hosting.view.center = CGPoint(x: windowScene.screen.bounds.midX, y: windowScene.screen.bounds.midY)

            applyTransform(hostingView: hosting.view, externalBounds: windowScene.screen.bounds)

            window.rootViewController = hosting
            window.isHidden = false
            window.makeKeyAndVisible()
            self.externalWindow = window
            print("[ExternalDisplayManager] Presented content on external scene: \(windowScene.screen.bounds)")
            return
        }

        // Fallback: create a classic UIWindow attached directly to the external UIScreen (iPadOS 16.x compatibility)
        guard let screen = self.externalScreen ?? UIScreen.screens.first(where: { $0 != UIScreen.main }) else {
            print("[ExternalDisplayManager] No external UIWindowScene and no UIScreen found — cannot present.")
            return
        }
        print("[ExternalDisplayManager] Falling back to UIScreen-based external window. Screen: \(screen.bounds)")

        let window = UIWindow(frame: screen.bounds)
        window.screen = screen
        window.backgroundColor = UIColor.black
        window.windowLevel = UIWindow.Level.normal

        let contentView = ExternalDisplayContentView(
            content: content,
            orientationModel: orientationModel,
            externalScreenBounds: screen.bounds
        )
        .environmentObject(orientationModel)
        .environment(\.isExternalContext, true)

        let hosting = UIHostingController(rootView: contentView)
        hosting.view.backgroundColor = UIColor.black
        let deviceSize = UIScreen.main.bounds.size
        hosting.view.bounds = CGRect(origin: .zero, size: deviceSize)
        hosting.view.center = CGPoint(x: screen.bounds.midX, y: screen.bounds.midY)

        applyTransform(hostingView: hosting.view, externalBounds: screen.bounds)

        window.rootViewController = hosting
        window.isHidden = false
        window.makeKeyAndVisible()
        self.externalWindow = window
        print("[ExternalDisplayManager] Presented content using UIScreen fallback: \(screen.bounds)")
    }

    private func applyTransform(hostingView: UIView, externalBounds: CGRect) {
        // Rotation setting from AppStorage/UserDefaults
        let rotationRaw = UserDefaults.standard.string(forKey: "OT.display.externalRotation") ?? "none"

        // Determine rotated device dimensions and rotation angle based on setting
        let devW = UIScreen.main.bounds.width
        let devH = UIScreen.main.bounds.height
        let extW = externalBounds.width
        let extH = externalBounds.height
        var rotatedDevW = devW
        var rotatedDevH = devH
        var angle: CGFloat = 0
        switch rotationRaw {
        case "cw90":
            rotatedDevW = devH
            rotatedDevH = devW
            angle = .pi / 2
        case "ccw90":
            rotatedDevW = devH
            rotatedDevH = devW
            angle = -.pi / 2
        case "auto":
            // Keep content upright by default; do not rotate
            break
        default:
            break
        }

        // Calculate dynamic scale to fit content into the external screen
        let baseFit = min(extW / rotatedDevW, extH / rotatedDevH)

        // Slightly smaller for crisper typography and quantize to avoid fractional pixel blur
        let proposed = baseFit * 0.96
        let step: CGFloat = 0.125 // snap to 1/8th scale steps
        let quantized = max(step, floor(proposed / step) * step)
        let finalScale = quantized

        // Apply rotation (if any) then scale to fit
        var transform = CGAffineTransform.identity
        if angle != 0 { transform = transform.rotated(by: angle) }
        transform = transform.scaledBy(x: finalScale, y: finalScale)
        hostingView.transform = transform

        print("[ExternalDisplayManager] Transform — dev: \(Int(devW))x\(Int(devH)), ext: \(Int(extW))x\(Int(extH)), rotation: \(rotationRaw), baseFit: \(String(format: "%.3f", baseFit)), quantizedScale: \(String(format: "%.3f", finalScale))")
    }
    
    /// Disconnect from external display
    func disconnectExternalDisplay() {
        externalWindow?.isHidden = true
        externalWindow = nil
        print("[ExternalDisplayManager] Disconnected from external display")
    }
    
    /// Update external screen availability
    private func updateExternalScreenState() {
        let externalScreens = UIScreen.screens.filter { $0 != UIScreen.main }
        
        if let screen = externalScreens.first {
            externalScreen = screen
            isExternalDisplayConnected = true
            print("[ExternalDisplayManager] External screen detected: \(screen.bounds)")
        } else {
            externalScreen = nil
            isExternalDisplayConnected = false
            disconnectExternalDisplay()
            print("[ExternalDisplayManager] No external screen detected")
        }
    }
    
    /// Handle screen connection
    private func handleScreenConnected(_ notification: Notification) {
        guard let screen = notification.object as? UIScreen,
              screen != UIScreen.main else { return }
        
        externalScreen = screen
        isExternalDisplayConnected = true
        print("[ExternalDisplayManager] External screen connected: \(screen.bounds)")
    }
    
    /// Handle screen disconnection
    private func handleScreenDisconnected(_ notification: Notification) {
        guard let screen = notification.object as? UIScreen,
              screen == externalScreen else { return }
        
        externalScreen = nil
        isExternalDisplayConnected = false
        disconnectExternalDisplay()
        print("[ExternalDisplayManager] External screen disconnected")
    }
}

// MARK: - External Display Scene (UIScene-based)

final class ExternalDisplaySceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // Do not create or present any UI here. The app will present the main UI via ExternalDisplayManager
        // to ensure it mirrors the iPhone screen with identical overlays/popups.
        print("[ExternalDisplay] willConnectTo — (no UI from delegate). screen: \(windowScene.screen.bounds), activationState: \(windowScene.activationState)")
    }
    
    func sceneDidBecomeActive(_ scene: UIScene) {
        if let ws = scene as? UIWindowScene {
            print("[ExternalDisplay] sceneDidBecomeActive — screen: \(ws.screen.bounds), activationState: \(ws.activationState)")
        } else {
            print("[ExternalDisplay] sceneDidBecomeActive")
        }
    }
    
    func sceneWillResignActive(_ scene: UIScene) {
        if let ws = scene as? UIWindowScene {
            print("[ExternalDisplay] sceneWillResignActive — screen: \(ws.screen.bounds), activationState: \(ws.activationState)")
        } else {
            print("[ExternalDisplay] sceneWillResignActive")
        }
    }
    
    func sceneWillEnterForeground(_ scene: UIScene) {
        if let ws = scene as? UIWindowScene {
            print("[ExternalDisplay] sceneWillEnterForeground — screen: \(ws.screen.bounds), activationState: \(ws.activationState)")
        } else {
            print("[ExternalDisplay] sceneWillEnterForeground")
        }
    }
    
    func sceneDidEnterBackground(_ scene: UIScene) {
        if let ws = scene as? UIWindowScene {
            print("[ExternalDisplay] sceneDidEnterBackground — screen: \(ws.screen.bounds), activationState: \(ws.activationState)")
        } else {
            print("[ExternalDisplay] sceneDidEnterBackground")
        }
    }
    
    func sceneDidDisconnect(_ scene: UIScene) {
        if let ws = scene as? UIWindowScene {
            print("[ExternalDisplay] sceneDidDisconnect — screen: \(ws.screen.bounds))")
        } else {
            print("[ExternalDisplay] sceneDidDisconnect")
        }
    }
}

/// Content view for the external display scene. Renders the full portrait UI rotated 90° and scaled to 25%.
struct ExternalDisplayRootView: View {
    @StateObject private var env = EnvironmentStore()
    @StateObject private var appModel = AppModel()
    @StateObject private var activationManager = ActivationManager()
    @StateObject private var orientationModel = OrientationModel()
    @StateObject private var sessionHolder = SessionHolder()
    
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            content
        }
        .overlay(alignment: .topLeading) {
            Text("EXTERNAL DISPLAY")
                .font(.system(size: 28, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
                .padding(10)
                .background(Color.red.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(12)
        }
        .onAppear {
            // Start services just like main app does
            activationManager.start(env: env, app: appModel)
            sessionHolder.ensure(env: env, app: appModel)
        }
        .onChange(of: env.deviceToken) { token in
            activationManager.tokenChanged(env: env, app: appModel)
            sessionHolder.tokenChanged(env: env, app: appModel)
        }
    }
    
    @ViewBuilder
    private var content: some View {
        if let s = sessionHolder.store, env.deviceToken != nil {
            let displayHomeView = Group {
                #if canImport(WebRTC)
                DisplayHomeView(store: s)
                    .environmentObject(s)
                    .environmentObject(s.webRTCService)
                #else
                DisplayHomeView(store: s).environmentObject(s)
                #endif
            }
            displayHomeView
                .environmentObject(env)
                .environmentObject(appModel)
                .environmentObject(activationManager)
                .environmentObject(orientationModel)
                // No SwiftUI rotation/scale; applied at UIView layer for precise layout
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .background(Color.black)
        } else {
            VStack(spacing: 12) {
                ProgressView("Preparing external display…")
                Text("Waiting for activation/session…")
                    .foregroundColor(.secondary)
            }
            // No SwiftUI rotation/scale; applied at UIView layer for precise layout
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            .background(Color.black)
        }
    }
}

/// Content view specifically designed for external display
struct ExternalDisplayContentView: View {
    let content: AnyView
    @ObservedObject var orientationModel: OrientationModel
    let externalScreenBounds: CGRect
    
    // Fixed zoom at 25% for optimal display
    private let fixedZoomLevel: Double = 0.25
    
    var body: some View {
        GeometryReader { geometry in
            
            // Render content without SwiftUI rotation/scale; UIView layer handles transform
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    content
                    Spacer()
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black)
            .allowsHitTesting(true)
            .contentShape(Rectangle())
            .id(orientationModel.interfaceOrientation)
        }
        .ignoresSafeArea(.all)
        .background(Color.black)
        .onAppear {
            print("[ExternalDisplay] External display content appeared - Scale-to-fit with configurable rotation")
        }
        .onChange(of: orientationModel.interfaceOrientation) { _ in
            print("[ExternalDisplay] External display updating with main screen changes")
        }
    }
    
    /// Calculate transform to force external display as 1080x1920 with 25% zoom
    private func calculateTransform(screenSize: CGSize) -> (scale: CGFloat, rotation: Double) {
        // Get device screen dimensions
        let deviceBounds = UIScreen.main.bounds
        let deviceWidth = deviceBounds.width
        let deviceHeight = deviceBounds.height
        
        // External display physical dimensions
        let externalWidth = screenSize.width
        let externalHeight = screenSize.height
        
        // Force rotation to make 1920x1080 display appear as 1080x1920
        let rotation: Double = 90.0
        
        // After 90° rotation: width becomes height, height becomes width
        let targetWidth = externalHeight  // 1080 (was height)
        let targetHeight = externalWidth   // 1920 (was width)
        
        // Calculate scale to fit device content into rotated external display (1080x1920)
        // Use min to maintain aspect ratio and avoid width issues
        let scaleX = targetWidth / deviceWidth
        let scaleY = targetHeight / deviceHeight
        let baseScale = min(scaleX, scaleY)
        
        // Apply fixed 25% zoom
        let finalScale = baseScale * fixedZoomLevel
        
        print("[ExternalDisplay] TRANSFORM: Physical \(externalWidth)x\(externalHeight) -> Rotated \(targetWidth)x\(targetHeight)")
        print("[ExternalDisplay] TRANSFORM: Device \(deviceWidth)x\(deviceHeight), Base scale \(baseScale)")
        print("[ExternalDisplay] TRANSFORM: Fixed zoom 25%, Final scale \(finalScale), Rotation 90°")
        
        return (scale: finalScale, rotation: rotation)
    }
}

/// Extension to update orientation from external display manager
extension OrientationModel {
    func updateOrientationForExternalDisplay() {
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first else { return }
        
        interfaceOrientation = windowScene.interfaceOrientation
    }
}