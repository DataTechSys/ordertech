import SwiftUI
import OrderTechCore
import UIKit
import Combine

@main
struct DisplayApp: App {
    @StateObject private var env = EnvironmentStore()
    @StateObject private var appModel = AppModel()
    @StateObject private var activationManager = ActivationManager()
    @StateObject private var orientation = OrientationModel()
    @StateObject private var externalDisplayManager = ExternalDisplayManager()
    @StateObject private var localMode = LocalModeManager()
    
 
    init() {
        // Enable a modest shared URL cache to improve image loading and prefetching
        let mem = 32 * 1024 * 1024 // 32 MB
        let disk = 200 * 1024 * 1024 // 200 MB
        URLCache.shared = URLCache(memoryCapacity: mem, diskCapacity: disk, diskPath: nil)
    }
    

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(env)
                .environmentObject(appModel)
                .environmentObject(activationManager)
                .environmentObject(orientation)
                .environmentObject(externalDisplayManager)
                .environmentObject(localMode)
                .onAppear {
                    // Start orientation tracking
                    orientation.start()
                    
                    // Update with current window scene if available
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                        orientation.update(using: windowScene)
                    }
                }
                .onDisappear {
                    // Stop orientation tracking when app is dismissed
                    orientation.stop()
                }
                .statusBar(hidden: UIDevice.current.userInterfaceIdiom == .phone)
        }
    }
}

final class AppModel: ObservableObject {
    @Published var deviceId: String = DeviceIdStore.shared.deviceId
    @Published var friendlyName: String = UserDefaults.standard.string(forKey: "OT.display.friendlyName") ?? "Drive‑Thru"
    @Published var branchName: String = UserDefaults.standard.string(forKey: "OT.display.branchName") ?? ""
    
    
    init() {
        // App model initialization - AI removed
    }
}

enum DeviceIdStore {
    static let shared = DeviceIdStoreImpl()
}

final class DeviceIdStoreImpl {
    private let key = "OT.display.deviceId"
    private let service = "OrderTechCore"
    var deviceId: String {
        if let existing = getKey(key) { return existing }
        let id = UUID().uuidString
        setKey(key, value: id)
        return id
    }
    private func getKey(_ account: String) -> String? {
        let query: [String:Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: account,
                                   kSecReturnData as String: true]
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func setKey(_ account: String, value: String) {
        let base: [String:Any] = [kSecClass as String: kSecClassGenericPassword,
                                  kSecAttrService as String: service,
                                  kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var toAdd = base; toAdd[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(toAdd as CFDictionary, nil)
    }
}

// MARK: - OrientationModel
/// Observable object that tracks interface orientation and provides convenient computed properties
@MainActor
final class OrientationModel: ObservableObject {
    @Published var interfaceOrientation: UIInterfaceOrientation = .portrait
    
    // Computed properties for convenience
    var isLandscape: Bool {
        interfaceOrientation.isLandscape
    }
    
    var isPortrait: Bool {
        interfaceOrientation.isPortrait
    }
    
    var isLandscapeLeft: Bool {
        interfaceOrientation == .landscapeLeft
    }
    
    var isLandscapeRight: Bool {
        interfaceOrientation == .landscapeRight
    }
    
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        // Start with current orientation if available
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            interfaceOrientation = windowScene.interfaceOrientation
        }
    }
    
    /// Start observing orientation changes
    func start() {
        // Subscribe to device orientation change notifications
        NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.updateOrientation()
                }
            }
            .store(in: &cancellables)
        
        // Also observe when the app becomes active in case orientation changed while backgrounded
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.updateOrientation()
                }
            }
            .store(in: &cancellables)
    }
    
    /// Update orientation immediately with the current window scene
    func update(using windowScene: UIWindowScene) {
        interfaceOrientation = windowScene.interfaceOrientation
    }
    
    /// Internal method to update orientation from current window scene
    private func updateOrientation() {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene else {
            return
        }
        interfaceOrientation = windowScene.interfaceOrientation
    }
    
    /// Stop observing orientation changes
    func stop() {
        cancellables.removeAll()
    }
}

