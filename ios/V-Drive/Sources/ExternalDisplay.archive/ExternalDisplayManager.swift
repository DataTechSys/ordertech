import UIKit
import SwiftUI
import OrderTechCore

/// Manages external display connections and handles rotation/scaling functionality.
///
/// This manager:
/// - Detects when external displays are connected/disconnected via HDMI
/// - Creates custom windows on external screens when rotation is enabled
/// - Falls back to system mirroring when rotation is disabled
/// - Handles screen mode changes and app lifecycle transitions
/// - Provides debug logging for troubleshooting
final class ExternalDisplayManager: ObservableObject {
    
    /// Shared singleton instance
    static let shared = ExternalDisplayManager()
    
    // MARK: - Published Properties
    @Published private(set) var isConnected = false
    @Published private(set) var shouldRotate = false
    
    // MARK: - Private Properties
    private var externalWindow: UIWindow?
    private var externalScreen: UIScreen?
    private var hostingController: UIHostingController<AnyView>?
    
    // Environment objects for creating content
    private var env: EnvironmentStore?
    private var appModel: AppModel?
    private var activationManager: ActivationManager?
    
    // Device size captured at launch in portrait
    private lazy var baseDeviceSize: CGSize = {
        UIScreen.main.bounds.size
    }()
    
    private init() {}
    
    // MARK: - Public Methods
    
    /// Set up the manager with environment objects and start monitoring external screens
    func setup(env: EnvironmentStore, appModel: AppModel, activationManager: ActivationManager) {
        print("[ExternalDisplayManager] Setting up - will rotate all external displays to portrait")
        
        // Store environment objects for content creation
        self.env = env
        self.appModel = appModel
        self.activationManager = activationManager
        
        // Register for screen notifications
        registerNotifications()
        
        // Check for already connected screens
        checkForExistingScreens()
        
        print("[ExternalDisplayManager] Setup complete")
    }
    
    /// Debug method to manually check for external screens
    func debugCheckScreens() {
        print("[ExternalDisplayManager] DEBUG: Manual screen check")
        checkForExistingScreens()
    }
    
    
    // MARK: - Private Methods
    
    /// Register for UIScreen notifications
    private func registerNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenDidConnect),
            name: UIScreen.didConnectNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenDidDisconnect),
            name: UIScreen.didDisconnectNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenModeDidChange),
            name: UIScreen.modeDidChangeNotification,
            object: nil
        )
        
        // Monitor app lifecycle for external window management
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }
    
    /// Check if any external screens are already connected at startup
    private func checkForExistingScreens() {
        let allScreens = UIScreen.screens
        let externalScreens = allScreens.filter { $0 != UIScreen.main }
        
        print("[ExternalDisplayManager] Screen detection check:")
        print("  - Total screens: \(allScreens.count)")
        print("  - Main screen bounds: \(UIScreen.main.bounds)")
        print("  - External screens found: \(externalScreens.count)")
        
        for (index, screen) in externalScreens.enumerated() {
            print("  - External screen \(index): \(screen.bounds)")
        }
        
        if let screen = externalScreens.first {
            print("[ExternalDisplayManager] Found existing external screen: \(screen.bounds)")
            handleScreenConnect(screen)
        } else {
            print("[ExternalDisplayManager] No external screens detected at startup")
        }
    }
    
    /// Handle external screen connection
    @objc private func screenDidConnect(_ notification: Notification) {
        guard let screen = notification.object as? UIScreen else { return }
        print("[ExternalDisplayManager] External screen connected: \(screen.bounds)")
        handleScreenConnect(screen)
    }
    
    /// Handle external screen disconnection  
    @objc private func screenDidDisconnect(_ notification: Notification) {
        guard let screen = notification.object as? UIScreen else { return }
        print("[ExternalDisplayManager] External screen disconnected")
        handleScreenDisconnect(screen)
    }
    
    /// Handle screen mode changes (resolution/refresh rate)
    @objc private func screenModeDidChange(_ notification: Notification) {
        print("[ExternalDisplayManager] Screen mode changed - recreating external window")
        
        // If we have an external window, recreate it with new screen bounds
        if externalWindow != nil && externalScreen != nil {
            DispatchQueue.main.async {
                self.createExternalWindow()
            }
        }
    }
    
    /// Handle app coming to foreground
    @objc private func appWillEnterForeground() {
        // Ensure external window is visible
        if let window = externalWindow, isConnected {
            DispatchQueue.main.async {
                window.isHidden = false
            }
        }
    }
    
    /// Handle screen connection logic
    private func handleScreenConnect(_ screen: UIScreen) {
        externalScreen = screen
        isConnected = true
        shouldRotate = true
        
        // Set overscan compensation to avoid TV clipping
        screen.overscanCompensation = .scale
        
        // Log all available screen modes
        print("[ExternalDisplayManager] Available screen modes:")
        for (index, mode) in screen.availableModes.enumerated() {
            let pixels = Int(mode.size.width * mode.size.height)
            print("  - Mode \(index): \(Int(mode.size.width))x\(Int(mode.size.height)) (\(pixels) pixels)")
        }
        print("  - Current mode: \(Int(screen.currentMode?.size.width ?? 0))x\(Int(screen.currentMode?.size.height ?? 0))")
        
        // Set the screen to use the highest available resolution
        if let highestMode = screen.availableModes.max(by: { mode1, mode2 in
            let pixels1 = mode1.size.width * mode1.size.height
            let pixels2 = mode2.size.width * mode2.size.height
            return pixels1 < pixels2
        }) {
            screen.currentMode = highestMode
            print("[ExternalDisplayManager] Set screen to highest resolution: \(Int(highestMode.size.width))x\(Int(highestMode.size.height))")
        }
        
        print("[ExternalDisplayManager] External screen connected: \(screen.bounds) -> will rotate to portrait")
        
        // Always create rotated external window
        createExternalWindow()
    }
    
    /// Handle screen disconnection logic
    private func handleScreenDisconnect(_ screen: UIScreen) {
        tearDownExternalWindow()
        externalScreen = nil
        isConnected = false
        shouldRotate = false
        
        // Notify main app that external display was disconnected
        NotificationCenter.default.post(name: .externalDisplayDisconnected, object: nil)
        
        print("[ExternalDisplayManager] Tore down external display")
    }
    
    
    /// Create external window with custom content - always rotated to portrait
    private func createExternalWindow() {
        guard let screen = externalScreen,
              let env = env,
              let appModel = appModel,
              let activationManager = activationManager else {
            print("[ExternalDisplayManager] Cannot create external window - missing dependencies")
            return
        }
        
        print("[ExternalDisplayManager] Creating external window for screen: \(screen.bounds)")
        
        // Tear down existing window first
        tearDownExternalWindow()
        
        // Create content for external display
        let content = createExternalContent(env: env, appModel: appModel, activationManager: activationManager)
        
        // Wrap content in rotation view
        let rotatedContent = ExternalDisplayRootView(
            rotationEnabled: true,
            baseDeviceSize: baseDeviceSize
        ) {
            content
        }
        
        // Create hosting controller
        hostingController = UIHostingController(rootView: AnyView(rotatedContent))
        
        // Try to find an appropriate window scene for the external screen
        var targetWindowScene: UIWindowScene?
        
        // Look for existing window scene on this screen
        for scene in UIApplication.shared.connectedScenes {
            if let windowScene = scene as? UIWindowScene,
               windowScene.screen == screen {
                targetWindowScene = windowScene
                print("[ExternalDisplayManager] Found existing window scene for external screen")
                break
            }
        }
        
        if let windowScene = targetWindowScene {
            // Create window using the existing window scene
            externalWindow = UIWindow(windowScene: windowScene)
            print("[ExternalDisplayManager] Created window using existing window scene")
        } else {
            // Fallback: create window with legacy method
            print("[ExternalDisplayManager] No window scene found, using legacy window creation")
            externalWindow = UIWindow(frame: screen.bounds)
            externalWindow?.screen = screen
        }
        
        // Configure the window
        externalWindow?.rootViewController = hostingController
        externalWindow?.windowLevel = UIWindow.Level.normal
        externalWindow?.backgroundColor = UIColor.black
        
        // Make sure this window can present modals/sheets
        hostingController?.modalPresentationStyle = .fullScreen
        
        externalWindow?.isHidden = false
        
        print("[ExternalDisplayManager] External window created and configured")
        print("  - Window bounds: \(externalWindow?.bounds ?? .zero)")
        print("  - Screen bounds: \(screen.bounds)")
        
        self.shouldRotate = true
    }
    
    
    /// Tear down external window and return to system mirroring
    private func tearDownExternalWindow() {
        let wasVisible = externalWindow != nil
        print("[ExternalDisplayManager] tearDownExternalWindow called - had window: \(wasVisible)")
        
        externalWindow?.isHidden = true
        externalWindow?.rootViewController = nil
        externalWindow = nil
        hostingController = nil
        print("[ExternalDisplayManager] External window torn down")
    }
    
    /// Create the content to display on external screen (mirrors main app)
    private func createExternalContent(
        env: EnvironmentStore,
        appModel: AppModel, 
        activationManager: ActivationManager
    ) -> some View {
        // Just show the main app content
        RootView()
            .environmentObject(env)
            .environmentObject(appModel)
            .environmentObject(activationManager)
    }
    
    // MARK: - Deinit
    deinit {
        NotificationCenter.default.removeObserver(self)
        tearDownExternalWindow()
    }
}

// MARK: - Notifications
extension Notification.Name {
    static let externalDisplayConnected = Notification.Name("ExternalDisplayConnected")
    static let externalDisplayDisconnected = Notification.Name("ExternalDisplayDisconnected")
}
