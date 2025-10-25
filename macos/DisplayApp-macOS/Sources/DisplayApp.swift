import SwiftUI
import OrderTechCore

struct DisplayApp: App {
    @StateObject private var env = EnvironmentStore()
    @StateObject private var appModel = AppModel()
    @StateObject private var externalDisplayManager = ExternalDisplayManager()

    init() {
        // Configure URL cache for better image loading
        let memoryCapacity = 32 * 1024 * 1024  // 32MB
        let diskCapacity = 200 * 1024 * 1024   // 200MB
        URLCache.shared = URLCache(memoryCapacity: memoryCapacity, diskCapacity: diskCapacity)
    }

    var body: some Scene {
        WindowGroup("OrderTech Display") {
            RootView()
                .environmentObject(env)
                .environmentObject(appModel)
                .environmentObject(externalDisplayManager)
                .frame(minWidth: 800, minHeight: 600)
                .onAppear {
                    setupExternalDisplayManager()
                }
        }
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Display") {
                Button("Rotate External Display") {
                    externalDisplayManager.toggleRotation()
                }
                .keyboardShortcut("r", modifiers: .command)
                
                Divider()
                
                Button("Debug: Check Screens") {
                    externalDisplayManager.debugCheckScreens()
                }
            }
        }
        
        // Settings window
        Settings {
            SettingsView()
                .environmentObject(env)
                .environmentObject(appModel)
                .environmentObject(externalDisplayManager)
        }
    }
    
    private func setupExternalDisplayManager() {
        print("[DisplayApp] Setting up external display manager for macOS")
        externalDisplayManager.setup(env: env, appModel: appModel)
    }
}

// MARK: - App Model
final class AppModel: ObservableObject {
    @Published var deviceId: String = DeviceIdStore.shared.deviceId
    @Published var friendlyName: String = UserDefaults.standard.string(forKey: "OT.display.friendlyName") ?? "macOS Display"
    @Published var branchName: String = UserDefaults.standard.string(forKey: "OT.display.branchName") ?? ""
}

// MARK: - Device ID Store
enum DeviceIdStore {
    static let shared = DeviceIdStoreImpl()
}

final class DeviceIdStoreImpl {
    private let key = "OT.display.deviceId"
    var deviceId: String {
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty {
            return existing
        }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }
}