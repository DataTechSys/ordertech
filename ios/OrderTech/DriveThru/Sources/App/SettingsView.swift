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
    
    // Deactivation confirmation
    @State private var showDeactivateConfirm = false
    @State private var deactivateConfirmText = ""
    
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
                
                Section("DEVICE") {
                    LabeledContent("Device ID", value: app.deviceId)
                    LabeledContent("Foodics ID", value: companyIdDisplay)
                    LabeledContent("Branch", value: app.branchName)
                    LabeledContent("Device Name", value: activation.info?.displayName ?? app.friendlyName)
                    
                    // Subscription row
                    HStack {
                        Text("Subscription")
                        Spacer()
                        if let subscription = activation.info?.subscription {
                            VStack(alignment: .trailing, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(formatSubscriptionType(subscription.type))
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    Text("/")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    Text(subscription.isExpired ? "Expired" : "Active")
                                        .font(.footnote)
                                        .foregroundColor(subscription.isExpired ? .red : .green)
                                        .fontWeight(.semibold)
                                }
                                if let expiryDate = subscription.expiresAt {
                                    Text(formatDate(expiryDate))
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                } else {
                                    Text("No expiry")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                            }
                        } else {
                            Text("Not set")
                                .font(.footnote)
                                .foregroundColor(.secondary)
                        }
                    }
                    
                    Button(action: { Task { await refreshAdmin() } }) {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
                
                Section("CATALOG") {
                    HStack {
                        Text("Foodics Link")
                        Spacer()
                        if let token = env.foodicsToken, !token.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("Active")
                                    .font(.footnote)
                                    .foregroundColor(.green)
                            }
                        } else {
                            HStack(spacing: 4) {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.red)
                                Text("Not Active")
                                    .font(.footnote)
                                    .foregroundColor(.red)
                            }
                        }
                    }
                    
                    Button(action: { Task { await syncData() } }) {
                        Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(env.foodicsToken == nil || env.foodicsToken?.isEmpty == true || (activation.info?.subscription?.isExpired ?? false))
                }
                
                Section("EXTERNAL DISPLAY") {
                    Picker("Rotation", selection: $externalRotationRaw) {
                        ForEach(ExternalRotationMode.allCases) { mode in
                            Text(mode.title).tag(mode.rawValue)
                        }
                    }
                    
                    Toggle("Poster", isOn: $idlePosterEnabled)
                    
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        showDeactivateConfirm = true
                    }) {
                        Image(systemName: "trash")
                            .foregroundColor(.red)
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        // Close settings (dismiss)
                        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                           let rootVC = windowScene.windows.first?.rootViewController {
                            rootVC.dismiss(animated: true)
                        }
                    }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.primary)
                    }
                }
            }
            .sheet(isPresented: $showDeactivateConfirm) {
                NavigationStack {
                    VStack(spacing: 20) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.orange)
                            .padding(.top, 40)
                        
                        Text("Deactivate Device")
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        Text("This will remove the device token and clear all activation data.")
                            .multilineTextAlignment(.center)
                            .foregroundColor(.secondary)
                            .padding(.horizontal)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Type 'delete' to confirm")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            TextField("", text: $deactivateConfirmText)
                                .textFieldStyle(.roundedBorder)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                        .padding(.horizontal, 40)
                        .padding(.top, 20)
                        
                        Spacer()
                        
                        VStack(spacing: 12) {
                            Button(action: {
                                deactivateDevice()
                                deactivateConfirmText = ""
                                showDeactivateConfirm = false
                            }) {
                                Text("Deactivate")
                                    .fontWeight(.semibold)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(deactivateConfirmText.lowercased() == "delete" ? Color.red : Color.gray)
                                    .foregroundColor(.white)
                                    .cornerRadius(10)
                            }
                            .disabled(deactivateConfirmText.lowercased() != "delete")
                            
                            Button(action: {
                                deactivateConfirmText = ""
                                showDeactivateConfirm = false
                            }) {
                                Text("Cancel")
                                    .fontWeight(.medium)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.gray.opacity(0.2))
                                    .foregroundColor(.primary)
                                    .cornerRadius(10)
                            }
                        }
                        .padding(.horizontal, 40)
                        .padding(.bottom, 40)
                    }
                    .navigationBarTitleDisplayMode(.inline)
                }
                .presentationDetents([.medium])
            }
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
        // Check if subscription is expired
        if let subscription = activation.info?.subscription, subscription.isExpired {
            print("[Settings] Sync blocked - subscription expired")
            return
        }
        
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
    
    private func deactivateDevice() {
        // Clear all environment tokens and IDs
        env.deviceToken = nil
        env.foodicsToken = nil
        env.tenantId = nil
        env.tenantHostOverride = nil
        
        // Clear all cached data
        try? LocalCache.delete("activation.json")
        try? LocalCache.delete("tenant.json")
        try? LocalCache.delete("categories.json")
        try? LocalCache.delete("products.json")
        try? LocalCache.delete("modifier_reference_table.json")
        LocalCache.lastSyncDate = nil
        
        // Clear AppModel state
        app.friendlyName = "OrderTech Device"
        app.branchName = "No Branch"
        UserDefaults.standard.removeObject(forKey: "OT.display.friendlyName")
        UserDefaults.standard.removeObject(forKey: "OT.display.branchName")
        
        // Notify activation manager to clear its state
        activation.tokenChanged(env: env, app: app)
        
        print("[Settings] Device deactivated - all data cleared")
    }
    
    private func formatSubscriptionType(_ type: String) -> String {
        let lowercased = type.lowercased()
        switch lowercased {
        case "ai":
            return "AI"
        case "basic":
            return "Basic"
        case "pro":
            return "Pro"
        case "trial":
            return "Trial"
        default:
            return type.capitalized
        }
    }
    
    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
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
            guard let url = URL(string: "https://app.ordertech.me/api/foodics/devices/activate") else {
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
