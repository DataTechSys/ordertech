import Foundation
import SwiftUI
import OrderTechCore

@MainActor
final class SessionHolder: ObservableObject {
    @Published var store: DisplaySessionStore? = nil
    private var lastDeviceId: String? = nil

    func ensure(env: EnvironmentStore, app: AppModel) {
        guard store == nil else { 
            // DriveThru local-only mode - no device updates needed
            return 
        }
        createStore(env: env, app: app)
    }

    func tokenChanged(env: EnvironmentStore, app: AppModel) {
        if env.deviceToken == nil {
            stop()
        } else {
            if store == nil {
                createStore(env: env, app: app)
            } else {
                store?.start()
            }
        }
    }

    func stop() {
        store?.stop()
        store = nil
    }

    private func createStore(env: EnvironmentStore, app: AppModel) {
        let deviceId = app.deviceId
        lastDeviceId = deviceId
        let friendly = app.friendlyName.isEmpty ? "Drive‑Thru" : app.friendlyName
        let s = DisplaySessionStore(deviceId: deviceId, friendlyName: friendly)
        self.store = s
        s.start()
    }
}
