import SwiftUI
import OrderTechCore

struct RootView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var externalDisplayManager: ExternalDisplayManager
    
    var body: some View {
        VStack(spacing: 20) {
                // Header
                VStack(spacing: 8) {
                    HStack {
                        Image(systemName: "tv")
                            .font(.largeTitle)
                            .foregroundColor(.blue)
                        Text("OrderTech Display")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                    }
                    
                    Text("macOS Display App")
                        .font(.headline)
                        .foregroundColor(.secondary)
                }
                
                Divider()
                
                // Status Section
                VStack(spacing: 12) {
                    HStack {
                        Text("Device Information")
                            .font(.headline)
                        Spacer()
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Device ID:")
                                .fontWeight(.medium)
                            Spacer()
                            Text(app.deviceId)
                                .font(.monospaced(.caption)())
                                .textSelection(.enabled)
                        }
                        
                        HStack {
                            Text("Device Name:")
                                .fontWeight(.medium)
                            Spacer()
                            Text(app.friendlyName)
                        }
                        
                        if !app.branchName.isEmpty {
                            HStack {
                                Text("Branch:")
                                    .fontWeight(.medium)
                                Spacer()
                                Text(app.branchName)
                            }
                        }
                        
                        HStack {
                            Text("Activation:")
                                .fontWeight(.medium)
                            Spacer()
                            if env.deviceToken != nil {
                                Label("Active", systemImage: "checkmark.circle")
                                    .foregroundColor(.green)
                            } else {
                                Label("Not Activated", systemImage: "xmark.circle")
                                    .foregroundColor(.orange)
                            }
                        }
                    }
                    .padding()
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(8)
                }
                
                // External Display Section
                VStack(spacing: 12) {
                    HStack {
                        Text("External Display")
                            .font(.headline)
                        Spacer()
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Status:")
                                .fontWeight(.medium)
                            Spacer()
                            if externalDisplayManager.isConnected {
                                Label("Connected", systemImage: "tv.and.hifispeaker.fill")
                                    .foregroundColor(.green)
                            } else {
                                Label("Not Connected", systemImage: "tv.slash")
                                    .foregroundColor(.red)
                            }
                        }
                        
                        HStack {
                            Text("Rotation:")
                                .fontWeight(.medium)
                            Spacer()
                            if externalDisplayManager.shouldRotate {
                                Label("90° Clockwise", systemImage: "rotate.right")
                                    .foregroundColor(.blue)
                            } else {
                                Label("Normal", systemImage: "rectangle")
                                    .foregroundColor(.secondary)
                            }
                        }
                        
                        HStack {
                            Button("Toggle Rotation") {
                                externalDisplayManager.toggleRotation()
                            }
                            .disabled(!externalDisplayManager.isConnected)
                            
                            Spacer()
                            
                            Button("Check Screens") {
                                externalDisplayManager.debugCheckScreens()
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding()
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(8)
                }
                
                Spacer()
                
                // Demo Content for External Display
                VStack(spacing: 16) {
                    Text("Demo Content")
                        .font(.title2)
                        .fontWeight(.semibold)
                    
                    Text("This is what will appear on the external display when connected. It will be rotated 90° clockwise when rotation is enabled.")
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                    
                    // Sample product grid
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 16) {
                        ForEach(sampleProducts, id: \.id) { product in
                            VStack {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(product.color.gradient)
                                    .frame(height: 60)
                                
                                Text(product.name)
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .multilineTextAlignment(.center)
                            }
                            .padding(8)
                            .background(Color(NSColor.controlBackgroundColor))
                            .cornerRadius(8)
                        }
                    }
                }
                
                Spacer()
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // Sample products for demo
    private var sampleProducts: [SampleProduct] {
        [
            SampleProduct(id: 1, name: "Iced Americano", color: .brown),
            SampleProduct(id: 2, name: "Iced Matcha", color: .green),
            SampleProduct(id: 3, name: "Salted Caramel", color: .orange),
            SampleProduct(id: 4, name: "Vanilla Latte", color: .yellow),
            SampleProduct(id: 5, name: "Chocolate Shake", color: .purple),
            SampleProduct(id: 6, name: "Berry Smoothie", color: .pink)
        ]
    }
}

// Sample product for demo
private struct SampleProduct {
    let id: Int
    let name: String
    let color: Color
}