import SwiftUI
import OrderTechCore
import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

struct SettingsView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var activation: ActivationManager
    @AppStorage("OT.display.shareLocation") private var shareLocation: Bool = true

    var body: some View {
        NavigationStack {
            List {
                Section("Device") {
                    HStack { Text("Device ID"); Spacer(); Text(app.deviceId).font(.footnote).foregroundColor(.secondary) }
                    HStack { Text("Branch"); Spacer(); Text(app.branchName).font(.footnote).foregroundColor(.secondary) }
                    HStack {
                        Text("Company ID"); Spacer()
                        Text(companyIdDisplay).font(.footnote).foregroundColor(.secondary).monospacedDigit()
                    }
                    HStack {
                        Text("Friendly Name"); Spacer()
                        Text(activation.info?.displayName ?? app.friendlyName)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    Toggle("Share location", isOn: $shareLocation)
                    Button("Refresh from Admin") { Task { await refreshAdmin() } }
                }
                Section("Activation") {
                    if let token = env.deviceToken, !token.isEmpty {
                        HStack { Text("Status"); Spacer(); Text("Active").foregroundColor(.green) }
                        Button("Deactivate") { env.deviceToken = nil }
                            .foregroundColor(.red)
                    } else {
                        Text("Not activated")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section("Data") {
                    Button("Sync catalog & prefetch images") { Task { await syncData() } }
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func syncData() async {
        let client = CatalogStore()
        await client.syncAll(env: env, deriveCategoriesIfEmpty: true)
        // Notify active catalog views to reload
        NotificationCenter.default.post(name: .catalogDidSync, object: nil)
    }

    private var companyIdDisplay: String {
        if let short = activation.info?.tenantShortId, !short.isEmpty { return short }
        return env.tenantId ?? ""
    }

    private func refreshAdmin() async {
        await activation.updateFromManifest(env: env, app: app)
    }
    
}

extension Notification.Name {
    static let catalogDidSync = Notification.Name("CatalogDidSync")
}
