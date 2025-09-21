import Foundation
import SwiftUI
import OrderTechCore

@MainActor
final class SessionHolder: ObservableObject {
    @Published var store: DisplaySessionStore? = nil

    func ensure(env: EnvironmentStore, app: AppModel) {
        guard store == nil else { return }
        guard env.deviceToken != nil else { return }
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
        let friendly = app.friendlyName.isEmpty ? "Drive‑Thru" : app.friendlyName
        let branch = app.branchName
        let s = DisplaySessionStore(env: env, deviceId: deviceId, friendlyName: friendly, branch: branch)
        self.store = s
        s.start()
    }
}
