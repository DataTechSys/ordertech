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
    @AppStorage("OT.display.externalRotation") private var externalRotationRaw: String = ExternalRotationMode.none.rawValue

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
                    Picker("Import From", selection: Binding(
                        get: { CatalogStore().dataSource },
                        set: { newValue in
                            var store = CatalogStore()
                            store.dataSource = newValue
                        }
                    )) {
                        ForEach(CatalogStore.DataSource.allCases, id: \.self) { source in
                            Text(source.rawValue).tag(source)
                        }
                    }
                    .pickerStyle(.segmented)
                    
                    // Foodics token field
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Foodics API Token")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        SecureField("Enter Foodics token", text: Binding(
                            get: { env.foodicsToken ?? "" },
                            set: { env.foodicsToken = $0.isEmpty ? nil : $0 }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        Text("Required for 'Foodics Direct' import")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                    
                    Button("Sync catalog & prefetch images") { Task { await syncData() } }
                }
                
                Section("External Display") {
                    Picker("Rotation", selection: $externalRotationRaw) {
                        ForEach(ExternalRotationMode.allCases) { mode in
                            Text(mode.title).tag(mode.rawValue)
                        }
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func syncData() async {
        let client = CatalogStore()
        await client.syncAll(env: env)
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

enum ExternalRotationMode: String, CaseIterable, Identifiable {
    case none = "none"
    case cw90 = "cw90"
    case ccw90 = "ccw90"
    case auto = "auto"
    
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: return "None"
        case .cw90: return "90° CW"
        case .ccw90: return "90° CCW"
        case .auto: return "Auto"
        }
    }
}
