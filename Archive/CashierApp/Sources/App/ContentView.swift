import SwiftUI

struct ContentView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var basket: BasketStore
    @EnvironmentObject var session: SessionStore
    @State private var showSettings = false
    var body: some View {
        NavigationStack {
            CashierHomeView(basket: basket, onShowSettings: { showSettings = true })
                .navigationBarHidden(true)
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                AdminSettingsView()
                    .navigationTitle("Admin Settings")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { showSettings = false }
                        }
                    }
            }
        }
        .task {
            // Do not auto-pair; show the display picker on demand from views
        }
        .onChange(of: env.deviceToken) { _ in
            // After activation, reload app data to trigger initial fetches
            env.reloadAppData()
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View { ContentView().environmentObject(EnvironmentStore()) }
}

