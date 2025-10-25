import SwiftUI
import OrderTechCore

struct SettingsView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var externalDisplayManager: ExternalDisplayManager

    var body: some View {
        TabView {
            // General Settings
            GeneralSettingsView()
                .environmentObject(env)
                .environmentObject(app)
                .tabItem {
                    Label("General", systemImage: "gearshape")
                }
            
            // External Display Settings
            ExternalDisplaySettingsView()
                .environmentObject(externalDisplayManager)
                .tabItem {
                    Label("External Display", systemImage: "tv")
                }
        }
        .frame(width: 500, height: 400)
    }
}

// MARK: - General Settings
struct GeneralSettingsView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel

    var body: some View {
        Form {
            Section("Device Information") {
                LabeledContent("Device ID", value: app.deviceId)
                    .textSelection(.enabled)
                
                LabeledContent("Device Name", value: app.friendlyName)
                
                LabeledContent("Branch", value: app.branchName.isEmpty ? "Not set" : app.branchName)
                
                LabeledContent("Company ID", value: env.tenantId ?? "Not set")
                    .textSelection(.enabled)
            }
            
            Section("Activation") {
                if let token = env.deviceToken, !token.isEmpty {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text("Active")
                            .foregroundColor(.green)
                            .fontWeight(.medium)
                    }
                    
                    Button("Deactivate Device") {
                        env.deviceToken = nil
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                } else {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text("Not activated")
                            .foregroundColor(.orange)
                            .fontWeight(.medium)
                    }
                    
                    Text("Use the main window to activate this device")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - External Display Settings
struct ExternalDisplaySettingsView: View {
    @EnvironmentObject var externalDisplayManager: ExternalDisplayManager

    var body: some View {
        Form {
            Section("External Display Status") {
                HStack {
                    Text("Connected")
                    Spacer()
                    if externalDisplayManager.isConnected {
                        Label("Yes", systemImage: "checkmark.circle")
                            .foregroundColor(.green)
                    } else {
                        Label("No", systemImage: "xmark.circle")
                            .foregroundColor(.red)
                    }
                }
                
                HStack {
                    Text("Rotation")
                    Spacer()
                    if externalDisplayManager.shouldRotate {
                        Label("90° Clockwise", systemImage: "rotate.right")
                            .foregroundColor(.blue)
                    } else {
                        Label("Normal", systemImage: "rectangle")
                            .foregroundColor(.secondary)
                    }
                }
            }
            
            Section("Controls") {
                Button("Toggle Rotation") {
                    externalDisplayManager.toggleRotation()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!externalDisplayManager.isConnected)
                
                Button("Check for External Screens") {
                    externalDisplayManager.debugCheckScreens()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            
            Section("Information") {
                Text("The external display will automatically be detected when connected. Use the rotation toggle to rotate the display content 90 degrees clockwise for portrait orientation.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text("Supported: Any external monitor connected via USB-C, Thunderbolt, HDMI, or DisplayPort.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}