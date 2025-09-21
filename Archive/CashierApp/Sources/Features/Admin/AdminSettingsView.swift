import SwiftUI

enum RTCOverride: String, CaseIterable, Identifiable {
    case auto, p2p, livekit, twilio
    var id: String { rawValue }
    var title: String { rawValue.uppercased() }
}

enum ICEPolicy: String, CaseIterable, Identifiable {
    case all, relay
    var id: String { rawValue }
}

struct AdminSettingsView: View {
    @EnvironmentObject var env: EnvironmentStore
    @State private var rtcOverride: RTCOverride = .auto
    @State private var icePolicy: ICEPolicy = .all

    var body: some View {
        Form {
            Section("Environment") {
                Picker("Environment", selection: $env.environment) {
                    ForEach(AppEnvironment.allCases) { env in Text(env.displayName).tag(env) }
                }
                if env.environment == .custom {
                    TextField("Custom base URL", text: $env.customBaseURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                }
                Text("Base URL: \(env.baseURL.absoluteString)")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }

            Section("Tenant") {
                HStack { Text("Company Name"); Spacer(); Text(env.activationInfo?.companyName ?? "").foregroundColor(.secondary) }
                HStack { Text("Company ID"); Spacer(); Text((env.tenantId ?? "")).foregroundColor(.secondary).monospacedDigit() }
                HStack { Text("Branch"); Spacer(); Text(env.activationInfo?.branchName ?? "").foregroundColor(.secondary).lineLimit(1) }
                HStack { Text("Device Name"); Spacer(); Text(env.activationInfo?.deviceName ?? "").foregroundColor(.secondary).lineLimit(1) }
                Button("Refresh from Admin") { Task { await refreshAdminData() } }
                    .buttonStyle(.bordered)
            }
            Section("Actions") {
                Button("Reload App Data") { env.reloadAppData() }
            }
            Section("RTC") {
                Picker("Provider", selection: $rtcOverride) {
                    ForEach(RTCOverride.allCases) { p in Text(p.title).tag(p) }
                }
                Picker("ICE Policy", selection: $icePolicy) {
                    ForEach(ICEPolicy.allCases) { p in Text(p.rawValue) .tag(p) }
                }
            }
            Section("Device") {
                #if DEBUG
                Toggle("Require Activation (pairing)", isOn: $env.requireActivation)
                if env.requireActivation {
                    NavigationLink("Activate Device (manual)") { ActivationView() }
                }
                Button("Reset Activation (DEBUG)", role: .destructive) {
                    env.clearActivation()
                }
                #else
                // Activation is required by default in production builds
                Text("Activation: Required")
                #endif

                if let info = env.activationInfo {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Company: \(info.companyName ?? "—")")
                        Text("Company ID: \(info.tenantId)")
                        Text("Branch: \(info.branchName ?? "—")")
                        Text("Device Name: \(info.deviceName ?? "—")")
                        if let s = info.shortId, !s.isEmpty { Text("Short Code: \(s)") }
                    }
                    .font(.footnote)
                    .foregroundColor(.secondary)
                }
            }
        }
        .navigationTitle("Admin Settings")
    }

    private func refreshAdminData() async {
        do {
            let http = HttpClient(env: env)
            let (data, _) = try await http.getRaw("/manifest", fresh: true)
            let parsed = try? JSONSerialization.jsonObject(with: data, options: [])
            let companyName: String? = {
                if let dict = parsed as? [String: Any] {
                    let profile = dict["profile"] as? [String: Any]
                    let brand = dict["brand"] as? [String: Any]
                    func nonEmpty(_ s: Any?) -> String? { guard let s = s as? String else { return nil }; let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
                    return nonEmpty(profile?["tenant_name"]) ?? nonEmpty(brand?["display_name"]) ?? nonEmpty(brand?["name"]) ?? nonEmpty(dict["tenant_name"]) ?? nil
                }
                return nil
            }()
            let displayName: String? = {
                if let dict = parsed as? [String: Any], let profile = dict["profile"] as? [String: Any] { return (profile["display_name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
                return nil
            }()
            let branchName: String? = {
                if let dict = parsed as? [String: Any], let profile = dict["profile"] as? [String: Any] { return (profile["branch"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
                return nil
            }()
            let info = ActivationDetails(tenantId: env.tenantId ?? "", companyName: companyName, branchName: branchName, deviceName: displayName, shortId: nil)
            await MainActor.run { env.activationInfo = info }
        } catch {
            // ignore
        }
    }
}

