import AppKit
import SwiftUI
import OrderTechCore

/// Manages external displays on macOS with proper rotation support
final class ExternalDisplayManager: ObservableObject {
    @Published private(set) var isConnected = false
    @Published private(set) var shouldRotate = false
    
    private var externalWindow: NSWindow?
    private var externalScreen: NSScreen?
    
    // Environment objects
    private var env: EnvironmentStore?
    private var appModel: AppModel?
    
    // Screen change observer
    private var screenChangeObserver: Any?
    
    init() {
        setupScreenChangeObserver()
    }
    
    deinit {
        if let observer = screenChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        closeExternalWindow()
    }
    
    // MARK: - Public Methods
    
    func setup(env: EnvironmentStore, appModel: AppModel) {
        print("[ExternalDisplayManager] Setting up macOS external display manager")
        
        self.env = env
        self.appModel = appModel
        
        // Check for existing external screens
        checkForExternalScreens()
    }
    
    func toggleRotation() {
        shouldRotate.toggle()
        print("[ExternalDisplayManager] Toggled rotation to: \(shouldRotate)")
        
        // Update external window if connected
        if isConnected {
            updateExternalWindow()
        }
    }
    
    func debugCheckScreens() {
        print("[ExternalDisplayManager] DEBUG: Manual screen check")
        checkForExternalScreens()
    }
    
    // MARK: - Private Methods
    
    private func setupScreenChangeObserver() {
        screenChangeObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            print("[ExternalDisplayManager] Screen configuration changed")
            self?.checkForExternalScreens()
        }
    }
    
    private func checkForExternalScreens() {
        let allScreens = NSScreen.screens
        let mainScreen = NSScreen.main
        let externalScreens = allScreens.filter { $0 != mainScreen }
        
        print("[ExternalDisplayManager] Screen detection:")
        print("  - Total screens: \(allScreens.count)")
        if let main = mainScreen {
            print("  - Main screen: \(Int(main.frame.width))x\(Int(main.frame.height))")
        }
        print("  - External screens: \(externalScreens.count)")
        
        for (index, screen) in externalScreens.enumerated() {
            print("  - External screen \(index): \(Int(screen.frame.width))x\(Int(screen.frame.height))")
        }
        
        // Use the first external screen (usually the best choice)
        if let screen = externalScreens.first {
            handleExternalScreenConnected(screen)
        } else if externalScreen != nil {
            handleExternalScreenDisconnected()
        }
    }
    
    private func handleExternalScreenConnected(_ screen: NSScreen) {
        guard screen != externalScreen else { return } // Already using this screen
        
        externalScreen = screen
        isConnected = true
        
        // Automatically enable rotation for vertical display (portrait)
        shouldRotate = true
        
        print("[ExternalDisplayManager] External screen connected: \(Int(screen.frame.width))x\(Int(screen.frame.height))")
        print("[ExternalDisplayManager] Auto-enabled rotation for vertical display")
        
        createExternalWindow()
    }
    
    private func handleExternalScreenDisconnected() {
        print("[ExternalDisplayManager] External screen disconnected")
        
        closeExternalWindow()
        externalScreen = nil
        isConnected = false
    }
    
    private func createExternalWindow() {
        guard let screen = externalScreen,
              let env = env,
              let appModel = appModel else {
            print("[ExternalDisplayManager] Cannot create external window - missing dependencies")
            return
        }
        
        print("[ExternalDisplayManager] Creating external window on screen: \(Int(screen.frame.width))x\(Int(screen.frame.height))")
        
        // Close existing window
        closeExternalWindow()
        
        // Create the content view
        let contentView = createExternalContent(env: env, appModel: appModel)
        
        // Create the hosting view
        let hostingView = NSHostingView(rootView: contentView)
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        
        // Create the window
        let windowRect = screen.frame
        externalWindow = NSWindow(
            contentRect: windowRect,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false,
            screen: screen
        )
        
        guard let window = externalWindow else { return }
        
        // Configure window
        window.contentView = hostingView
        window.backgroundColor = .black
        window.level = .normal
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.ignoresMouseEvents = false
        
        // Position window to fill the external screen
        window.setFrame(windowRect, display: true, animate: false)
        window.makeKeyAndOrderFront(nil)
        
        print("[ExternalDisplayManager] External window created and displayed")
        print("  - Window frame: \(Int(window.frame.width))x\(Int(window.frame.height))")
        print("  - Rotation enabled: \(shouldRotate)")
    }
    
    private func updateExternalWindow() {
        // Recreate window with updated rotation
        if isConnected {
            createExternalWindow()
        }
    }
    
    private func closeExternalWindow() {
        externalWindow?.close()
        externalWindow = nil
        print("[ExternalDisplayManager] External window closed")
    }
    
    private func createExternalContent(
        env: EnvironmentStore,
        appModel: AppModel
    ) -> some View {
        let content = RootView()
            .environmentObject(env)
            .environmentObject(appModel)
            .environmentObject(self)
        
        if shouldRotate {
            return AnyView(
                content
                    .rotationEffect(Angle.degrees(90))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
                    .clipped()
            )
        } else {
            return AnyView(
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
            )
        }
    }
}