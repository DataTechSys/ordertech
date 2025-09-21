import SwiftUI
import OrderTechCore

// Minimal placeholder settings page to keep build green; can be replaced with full settings later.
struct SettingsView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var activation: ActivationManager

    // API override (host only)
    @State private var apiHostInput: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Device") {
                    HStack { Text("Device ID"); Spacer(); Text(app.deviceId).font(.footnote).foregroundColor(.secondary) }
                    HStack { Text("Branch"); Spacer(); Text(app.branchName).font(.footnote).foregroundColor(.secondary) }
                    HStack { Text("Friendly Name"); Spacer(); Text(app.friendlyName).font(.footnote).foregroundColor(.secondary) }
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
                Section("API") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("API Host Override (host only)")
                            .font(.footnote).foregroundColor(.secondary)
                        TextField("my-service-abc-ue.a.run.app", text: $apiHostInput)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                            .font(.system(.body, design: .monospaced))
                        HStack(spacing: 12) {
                            Button("Use from URL…") {
                                if let u = URL(string: apiHostInput), let h = u.host, !h.isEmpty { apiHostInput = h }
                            }
                            Button("Save Host") {
                                let host = sanitizeHost(apiHostInput)
                                apiHostInput = host
                                if host.isEmpty { env.setTenantHostOverride(nil) } else { env.setTenantHostOverride(host) }
                            }
                            Button("Reset") {
                                apiHostInput = ""
                                env.setTenantHostOverride(nil)
                            }
                        }
                        Text("If set, the app will use https://<host> for all API calls (Cloud Run proxy). Leave blank for default.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        HStack {
                            Text("Current Base:")
                            Spacer()
                            Text(env.baseURL.absoluteString)
                                .font(.footnote.monospaced())
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                apiHostInput = env.tenantHostOverride ?? ""
            }
        }
    }

    private func sanitizeHost(_ raw: String) -> String {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return "" }
        if let url = URL(string: t), let host = url.host, !host.isEmpty { return host }
        if t.hasPrefix("https://") { return String(t.dropFirst(8)).trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
        if t.hasPrefix("http://") { return String(t.dropFirst(7)).trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
        return t.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
