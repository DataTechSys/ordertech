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
    
    // Activation state
    @State private var companyId: String = ""
    @State private var activationCode: String = ""
    @State private var isActivating: Bool = false
    @State private var activationError: String? = nil
    
    // Idle Poster settings
    @AppStorage("OT.display.idlePosterEnabled") private var idlePosterEnabled: Bool = false
    @AppStorage("OT.display.idleTimeout") private var idleTimeout: Double = 15.0
    @AppStorage("OT.display.posterFlipInterval") private var posterFlipInterval: Double = 15.0
    @AppStorage("OT.display.posterMode") private var posterModeRaw: String = "fullscreen"

    var body: some View {
        NavigationStack {
            List {
                // Show activation section if device is not activated
                if env.deviceToken == nil || (env.deviceToken ?? "").isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Company ID (6 digits)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            TextField("123456", text: $companyId)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                                .onChange(of: companyId) { newValue in
                                    companyId = String(newValue.filter { $0.isNumber }.prefix(6))
                                }
                            
                            Text("Activation Code (6 digits)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            TextField("123456", text: $activationCode)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                                .onChange(of: activationCode) { newValue in
                                    activationCode = String(newValue.filter { $0.isNumber }.prefix(6))
                                }
                            
                            if let error = activationError {
                                Text(error)
                                    .font(.caption)
                                    .foregroundColor(.red)
                            }
                            
                            Button(action: { Task { await activateDevice() } }) {
                                HStack {
                                    if isActivating {
                                        ProgressView()
                                            .progressViewStyle(.circular)
                                            .scaleEffect(0.8)
                                    }
                                    Text(isActivating ? "Activating..." : "Activate Device")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(companyId.count != 6 || activationCode.count != 6 || isActivating)
                        }
                        .padding(.vertical, 8)
                    } header: {
                        Text("Device Activation")
                    } footer: {
                        Text("Get your Company ID and Activation Code from the admin dashboard at foodics.ordertech.me")
                    }
                }
                
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
                    // Foodics token status (read-only)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Foodics API Token")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Spacer()
                            if let token = env.foodicsToken, !token.isEmpty {
                                HStack(spacing: 4) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.green)
                                    Text("Active")
                                        .font(.caption)
                                        .foregroundColor(.green)
                                }
                            } else {
                                HStack(spacing: 4) {
                                    Image(systemName: "exclamationmark.circle.fill")
                                        .foregroundColor(.orange)
                                    Text("Not Available")
                                        .font(.caption)
                                        .foregroundColor(.orange)
                                }
                            }
                        }
                        
                        if let token = env.foodicsToken, !token.isEmpty {
                            // Show token preview (first 20 chars)
                            HStack {
                                Text("\(token.prefix(20))...")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            .padding(8)
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(6)
                        } else {
                            Text("Token will be automatically synced from server during device activation")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .padding(8)
                                .background(Color.blue.opacity(0.05))
                                .cornerRadius(6)
                        }
                    }
                    .padding(.vertical, 4)
                    
                    Button("Sync catalog & prefetch images") { Task { await syncData() } }
                        .disabled(env.foodicsToken == nil || env.foodicsToken?.isEmpty == true)
                    
                    Button("Clear Cache & Force Sync", role: .destructive) {
                        Task {
                            await clearCache()
                            await syncData()
                        }
                    }
                } header: {
                    Text("Catalog")
                } footer: {
                    Text("Import menu data from Foodics. Use 'Clear Cache' to force refresh Arabic category names.")
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

    private func clearCache() async {
        // Clear catalog cache
        try? LocalCache.delete("categories.json")
        try? LocalCache.delete("products.json")
        try? LocalCache.delete("modifier_reference_table.json")
        LocalCache.lastSyncDate = nil
        print("[Settings] Cache cleared")
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
    
    private func activateDevice() async {
        guard companyId.count == 6, activationCode.count == 6 else {
            activationError = "Please enter valid 6-digit codes"
            return
        }
        
        isActivating = true
        activationError = nil
        defer { isActivating = false }
        
        do {
            // Try to claim the activation code via Foodics API
            // TEMPORARY: Using ngrok tunnel to local server (localhost:8080) which connects to production cloud database
            // TODO: Once Cloud Run deployment is fixed, change to: https://app.ordertech.me/api/foodics/devices/activate  
            guard let url = URL(string: "https://faa89f54fcf1.ngrok-free.app/api/foodics/devices/activate") else {
                activationError = "Invalid URL"
                return
            }
            
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue("application/json", forHTTPHeaderField: "accept")
            
            let payload: [String: Any] = [
                "company_id": companyId,
                "activation_code": activationCode
            ]
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                activationError = "Invalid response"
                return
            }
            
            print("[Settings] Activation response status: \(httpResponse.statusCode)")
            if let responseString = String(data: data, encoding: .utf8) {
                print("[Settings] Activation response body: \(responseString)")
            }
            
            if httpResponse.statusCode == 200 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let status = json["status"] as? String,
                   status.lowercased() == "claimed",
                   let token = json["device_token"] as? String {
                    print("[Settings] Activation successful - token received")
                    
                    // Extract Foodics token if available
                    let foodicsToken = json["foodics_token"] as? String
                    
                    await MainActor.run {
                        env.tenantId = companyId
                        env.deviceToken = token
                        if let foodicsToken = foodicsToken, !foodicsToken.isEmpty {
                            env.foodicsToken = foodicsToken
                            print("[Settings] Foodics token saved: \(foodicsToken.prefix(20))...")
                        }
                        companyId = ""
                        activationCode = ""
                    }
                    await activation.updateAfterActivation(env: env, app: app)
                    
                    // Auto-sync catalog after activation
                    print("[Settings] Auto-syncing catalog after activation")
                    await syncData()
                    return
                } else {
                    print("[Settings] JSON parsing failed or status != claimed")
                }
            }
            
            activationError = "Activation failed. Please check your codes and try again."
        } catch {
            activationError = "Error: \(error.localizedDescription)"
        }
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
