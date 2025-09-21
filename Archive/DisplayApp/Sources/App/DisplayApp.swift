import SwiftUI
import OrderTechCore

@main
struct DisplayApp: App {
    @StateObject private var env = EnvironmentStore()
    @StateObject private var appModel = AppModel()
    @StateObject private var activationManager = ActivationManager()

    init() {
        // Disable shared URL cache globally
        URLCache.shared = URLCache(memoryCapacity: 0, diskCapacity: 0, diskPath: nil)
    }

    var body: some Scene {
        WindowGroup {
RootView()
                .environmentObject(env)
                .environmentObject(appModel)
                .environmentObject(activationManager)
        }
    }
}

final class AppModel: ObservableObject {
    @Published var deviceId: String = DeviceIdStore.shared.deviceId
    @Published var friendlyName: String = UserDefaults.standard.string(forKey: "OT.display.friendlyName") ?? "Drive‑Thru"
    @Published var branchName: String = UserDefaults.standard.string(forKey: "OT.display.branchName") ?? ""
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
