import SwiftUI
import OrderTechCore

/// A small red "InActive" indicator that appears when the device is not activated.
/// Tapping it opens the activation page as a sheet.
struct InActiveIndicator: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel  
    @EnvironmentObject var activation: ActivationManager
    @State private var showActivationSheet = false
    
    var body: some View {
        if env.deviceToken == nil {
            Button(action: { 
                showActivationSheet = true 
            }) {
                Text("InActive")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color.red)
                    )
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $showActivationSheet) {
                NavigationStack {
                    InlineActivationPageView()
                        .environmentObject(env)
                        .environmentObject(app)
                        .environmentObject(activation)
                        .navigationTitle("Device Activation")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .navigationBarTrailing) {
                                Button("Close") {
                                    showActivationSheet = false
                                }
                            }
                        }
                }
            }
        }
    }
}

#Preview {
    InActiveIndicator()
        .environmentObject(EnvironmentStore())
        .environmentObject(AppModel())
        .environmentObject(ActivationManager())
}