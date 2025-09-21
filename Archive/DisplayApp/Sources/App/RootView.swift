import SwiftUI
import OrderTechCore
#if canImport(UIKit)
import UIKit
import CoreLocation
#endif

// MARK: - LocationManager

#if canImport(CoreLocation)
final class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var lastLocation: CLLocation?
    private let manager = CLLocationManager()
    private var env: EnvironmentStore?
    private var client: HttpClient?
    
    func configure(env: EnvironmentStore) {
        self.env = env
        self.client = HttpClient(env: env)
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }
    
    func startUpdating() {
        #if os(iOS)
        if CLLocationManager.authorizationStatus() == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        #endif
        manager.startUpdatingLocation()
    }
    
    func stopUpdating() {
        manager.stopUpdatingLocation()
    }
    
    // CLLocationManagerDelegate
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        lastLocation = location
        Task { await sendLocationToServer(location: location) }
    }
    
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        #if os(iOS)
        let status = manager.authorizationStatus
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            manager.startUpdatingLocation()
        }
        #else
        manager.startUpdatingLocation()
        #endif
    }
    
    func sendLocationToServer(location: CLLocation) async {
        guard let env = env, let client = client, let token = env.deviceToken, !token.isEmpty else { return }
        let payload = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: payload)
            _ = try await client.request("/device/location", method: "POST", headers: [:], body: data, decode: HttpClient.Empty.self)
            print("[LocationManager] Updated location sent to server: \(payload)")
        } catch {
            print("[LocationManager] Failed to send location: \(error)")
        }
    }
}
#endif

struct RootView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var activation: ActivationManager

    @State private var showSettings = false
    @State private var presentedActivationOnce = false
    @StateObject private var sessionStoreHolder = SessionHolder()
    #if canImport(CoreLocation)
    @StateObject private var locationManager = LocationManager()
    #endif

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                if env.deviceToken != nil { header }
                content
            }
            .onAppear {
                Task { @MainActor in sessionStoreHolder.ensure(env: env, app: app) }
                activation.start(env: env, app: app)
                #if canImport(CoreLocation)
                locationManager.configure(env: env)
                if env.deviceToken != nil {
                    locationManager.startUpdating()
                }
                #endif
                // Present activation inline instead of auto-opening Settings
                if env.deviceToken == nil && !presentedActivationOnce {
                    presentedActivationOnce = true
                }
            }
            .onChange(of: env.deviceToken) { token in
                print("[UI] token changed → present? \(env.deviceToken != nil)")
                Task { @MainActor in sessionStoreHolder.tokenChanged(env: env, app: app) }
                activation.tokenChanged(env: env, app: app)
                #if canImport(CoreLocation)
                if token == nil {
                    locationManager.stopUpdating()
                } else {
                    locationManager.configure(env: env)
                    locationManager.startUpdating()
                }
                #endif
                if env.deviceToken == nil { /* keep activation page visible */ } else { showSettings = false }
            }
            .onDisappear {
                Task { @MainActor in sessionStoreHolder.stop() }
                #if canImport(CoreLocation)
                locationManager.stopUpdating()
                #endif
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BrandLogoView()
            Spacer()
            if env.deviceToken == nil {
                Text("Activate device")
                    .font(.caption).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Capsule().fill(Color.orange.opacity(0.2)))
            }
            if let s = sessionStoreHolder.store {
                Circle()
                    .fill(s.peersConnected ? Color.green : (s.connected ? Color.orange : Color.gray))
                    .frame(width: 10, height: 10)
            }
            Button(action: { showSettings = true }) { Image(systemName: "gearshape") }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private var content: some View {
        Group {
            if let s = sessionStoreHolder.store, env.deviceToken != nil {
                #if canImport(WebRTC)
                DisplayHomeView(store: s)
                    .environmentObject(s.webRTCService)
                #else
                DisplayHomeView(store: s)
                #endif
            } else if (env.deviceToken == nil && hasCachedMenu()) || env.previewMenu {
                // Offline preview: show cached menu even without activation, or when explicitly enabled
                OfflineMenuView()
                    .environmentObject(env)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(white: 0.96))
            } else if env.deviceToken == nil {
                InlineActivationPageView()
                    .environmentObject(env)
                    .environmentObject(app)
                    .environmentObject(activation)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(white: 0.96))
            } else {
                VStack(spacing: 12) {
                    ProgressView("Starting…")
                    Text("Connecting to server…")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(white: 0.96))
            }
        }
    }

    private func hasCachedMenu() -> Bool {
        do {
            let prods: [Product] = try LocalCache.loadJSON([Product].self, from: "products.json")
            return !prods.isEmpty
        } catch {
            return false
        }
    }
}

// ... (rest of your file unchanged)
