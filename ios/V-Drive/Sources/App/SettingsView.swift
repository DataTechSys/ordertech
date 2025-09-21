import SwiftUI
import OrderTechCore
#if canImport(UIKit)
import UIKit
#endif

struct SettingsView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var activation: ActivationManager

    var body: some View {
        NavigationStack {
            List {
                Section("Device") {
                    HStack { Text("Device ID"); Spacer(); Text(app.deviceId).font(.footnote).foregroundColor(.secondary) }
                    HStack { Text("Branch"); Spacer(); Text(app.branchName).font(.footnote).foregroundColor(.secondary) }
                    HStack { Text("Company ID"); Spacer(); Text(env.tenantId ?? "").font(.footnote).foregroundColor(.secondary).monospacedDigit() }
                    HStack {
                        Text("Friendly Name"); Spacer()
                        Text(activation.info?.displayName ?? app.friendlyName)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
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
            }
            .navigationTitle("Settings")
        }
    }
}
