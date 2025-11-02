import UIKit
import SwiftUI
import OrderTechCore

class SceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        
        // Create environment objects
        let env = EnvironmentStore()
        let appModel = AppModel()
        let activationManager = ActivationManager()
        
        // Create the SwiftUI root view with environment objects
        let rootView = RootView()
            .environmentObject(env)
            .environmentObject(appModel)
            .environmentObject(activationManager)
        
        // Wrap in portrait-locked hosting controller
        let hostingController = PortraitHostingController(rootView: rootView)
        
        // Create and configure the window
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = hostingController
        window?.makeKeyAndVisible()
        
    }
}

/// Custom UIHostingController that locks orientation to portrait on the main device
class PortraitHostingController<Content: View>: UIHostingController<Content> {
    
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return .portrait
    }
    
    override var shouldAutorotate: Bool {
        return false
    }
    
    override var prefersStatusBarHidden: Bool {
        #if canImport(UIKit)
        return UIDevice.current.userInterfaceIdiom == .phone
        #else
        return false
        #endif
    }
}