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
    
    // Idle Poster settings
    @AppStorage("OT.display.idlePosterEnabled") private var idlePosterEnabled: Bool = true
    @AppStorage("OT.display.idleTimeout") private var idleTimeout: Double = 15.0
    @AppStorage("OT.display.posterFlipInterval") private var posterFlipInterval: Double = 15.0
    @AppStorage("OT.display.posterMode") private var posterModeRaw: String = "fullscreen"

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
                
                Section {
                    // Foodics token field
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Foodics API Token")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        SecureField("Enter Foodics token from Admin", text: Binding(
                            get: { env.foodicsToken ?? "" },
                            set: { env.foodicsToken = $0.isEmpty ? nil : $0 }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        if let token = env.foodicsToken, !token.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .font(.caption)
                                Text("Token saved")
                                    .font(.caption2)
                                    .foregroundColor(.green)
                            }
                        } else {
                            Text("Get your Foodics API token from the Admin page")
                                .font(.caption2)
                                .foregroundColor(.orange)
                        }
                    }
                    .padding(.vertical, 4)
                    
                    Button("Sync catalog & prefetch images") { Task { await syncData() } }
                        .disabled(env.foodicsToken == nil || env.foodicsToken?.isEmpty == true)
                } header: {
                    Text("Catalog")
                } footer: {
                    Text("Import menu data from Foodics. Token must be configured to sync.")
                }
                
                Section("External Display") {
                    Picker("Rotation", selection: $externalRotationRaw) {
                        ForEach(ExternalRotationMode.allCases) { mode in
                            Text(mode.title).tag(mode.rawValue)
                        }
                    }
                }
                
                Section {
                    Toggle("Enable Idle Poster", isOn: $idlePosterEnabled)
                    
                    if idlePosterEnabled {
                        Picker("Display Mode", selection: $posterModeRaw) {
                            Text("Full-Screen Products").tag("fullscreen")
                            Text("Category Menu Flip").tag("categories")
                        }
                        .pickerStyle(.segmented)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Idle timeout")
                                Spacer()
                                Text("\(Int(idleTimeout))s")
                                    .foregroundColor(.secondary)
                                    .monospacedDigit()
                            }
                            Slider(value: $idleTimeout, in: 5...60, step: 5)
                                .tint(.accentColor)
                        }
                        
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(posterModeRaw == "fullscreen" ? "Page transition" : "Category transition")
                                Spacer()
                                Text("\(Int(posterFlipInterval))s")
                                    .foregroundColor(.secondary)
                                    .monospacedDigit()
                            }
                            Slider(value: $posterFlipInterval, in: 5...30, step: 5)
                                .tint(.accentColor)
                        }
                    }
                } header: {
                    Text("Idle Poster")
                } footer: {
                    if idlePosterEnabled {
                        if posterModeRaw == "fullscreen" {
                            Text("Full-Screen: Shows a shuffled grid of all products, flipping pages at the set interval.")
                        } else {
                            Text("Category Menu: Shows the menu for each category, flipping through categories at the set interval.")
                        }
                    } else {
                        Text("Show rotating product poster when idle. Configure timeout and page transition timing.")
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
    static let localCameraSessionStarted = Notification.Name("LocalCameraSessionStarted")
    static let externalCameraSessionStarted = Notification.Name("ExternalCameraSessionStarted")
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
