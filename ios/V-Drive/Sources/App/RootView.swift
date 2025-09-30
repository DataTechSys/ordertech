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
    private var timer: Timer?
    private var lastSentAt: Date? = nil
    private let minInterval: TimeInterval = 15 * 60 // 15 minutes
    
    func configure(env: EnvironmentStore) {
        self.env = env
        self.client = HttpClient(env: env)
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100 // meters
    }
    
    func startUpdating() {
        #if os(iOS)
        if CLLocationManager.authorizationStatus() == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        #endif
        manager.startUpdatingLocation()
        // Also request a location every 15 minutes to guarantee cadence even if stationary
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: minInterval, repeats: true) { [weak self] _ in
                self?.manager.requestLocation()
            }
            if let t = timer { RunLoop.main.add(t, forMode: .common) }
        }
    }
    
    func stopUpdating() {
        manager.stopUpdatingLocation()
        timer?.invalidate(); timer = nil
    }
    
    // CLLocationManagerDelegate
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        lastLocation = location
        let now = Date()
        if let last = lastSentAt, now.timeIntervalSince(last) < minInterval {
            return // throttle
        }
        lastSentAt = now
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
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[LocationManager] Failed to get location: \(error)")
        if let err = error as? CLError, err.code == .denied {
            manager.stopUpdatingLocation()
        }
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
    @AppStorage("OT.display.shareLocation") private var shareLocation: Bool = true
    #endif

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                
                content
            }
.overlay(alignment: .topTrailing) {
                SettingsHotCorner(size: 64, trigger: .longPress(0.6)) { showSettings = true }
                    .padding(.trailing, 8)
                    .padding(.top, 8)
            }
            .overlay(alignment: .topLeading) {
                Color.black.opacity(0.001)
                    .frame(width: 72, height: 72)
                    .contentShape(Rectangle())
                    .allowsHitTesting(true)
                    .gesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in showSettings = true })
                    .zIndex(1000)
            }
            .background(
                Group {
                    #if canImport(UIKit)
                    if UIDevice.current.userInterfaceIdiom == .phone {
                        HomeIndicatorHider().ignoresSafeArea()
                    }
                    #endif
                }
            )
            .onAppear {
                Task { @MainActor in sessionStoreHolder.ensure(env: env, app: app) }
                // Start activation manager in all builds
                activation.start(env: env, app: app)
                #if canImport(CoreLocation)
                locationManager.configure(env: env)
                if env.deviceToken != nil && shareLocation {
                    locationManager.startUpdating()
                } else {
                    locationManager.stopUpdating()
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
                #if !DEBUG
                activation.tokenChanged(env: env, app: app)
                #endif
                #if canImport(CoreLocation)
                if token == nil {
                    locationManager.stopUpdating()
                } else {
                    locationManager.configure(env: env)
                    if shareLocation {
                        locationManager.startUpdating()
                    } else {
                        locationManager.stopUpdating()
                    }
                }
                #endif
                if env.deviceToken == nil { /* keep activation page visible */ } else { showSettings = false }
            }
            .onChange(of: shareLocation) { enabled in
                #if canImport(CoreLocation)
                if env.deviceToken != nil {
                    enabled ? locationManager.startUpdating() : locationManager.stopUpdating()
                } else {
                    locationManager.stopUpdating()
                }
                #endif
            }
            .onDisappear {
                Task { @MainActor in sessionStoreHolder.stop() }
                #if canImport(CoreLocation)
                locationManager.stopUpdating()
                #endif
            }
            .onReceive(NotificationCenter.default.publisher(for: .displayOpenSettings)) { _ in
                showSettings = true
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BrandLogoView()
                .onTapGesture(count: 2) { showSettings = true }
            Spacer()
            if env.deviceToken == nil {
                #if !DEBUG
                Text("Activate device")
                    .font(.caption).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Capsule().fill(Color.orange.opacity(0.2)))
                #endif
            }
            // Connection status chip (dot-only) similar to Cashier
            StatusChipView(status: statusChipText, compact: true, dotOnly: true)
            // Removed gear icon to keep screen clean
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private var content: some View {
        Group {
            // Unified logic for both Debug and Release: show activation when token is missing
            if let s = sessionStoreHolder.store, env.deviceToken != nil {
                #if canImport(WebRTC)
                DisplayHomeView(store: s)
                    .environmentObject(s)
                    .environmentObject(s.webRTCService)
                #else
                DisplayHomeView(store: s)
                    .environmentObject(s)
                #endif
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

    private var statusChipText: String {
        if env.deviceToken == nil { return "UNPAIRED" }
        if let s = sessionStoreHolder.store, s.peersConnected { return "CONNECTED" }
        return "READY"
    }
}

private enum HotCornerTrigger {
    case tap
    case doubleTap
    case longPress(Double)
}

private struct SettingsHotCorner: View {
    let size: CGFloat
    let trigger: HotCornerTrigger
    let onTap: () -> Void

    init(size: CGFloat = 64, trigger: HotCornerTrigger = .longPress(0.6), onTap: @escaping () -> Void) {
        self.size = size
        self.trigger = trigger
        self.onTap = onTap
    }

    @ViewBuilder
    var body: some View {
        let base = Color.clear
            .frame(width: size, height: size)
            .contentShape(Rectangle())
        switch trigger {
        case .tap:
            base.onTapGesture(perform: onTap)
        case .doubleTap:
            base.onTapGesture(count: 2, perform: onTap)
        case .longPress(let duration):
            base.gesture(LongPressGesture(minimumDuration: duration).onEnded { _ in onTap() })
        }
    }
}

#if canImport(UIKit)
private struct HomeIndicatorHider: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> HiderVC { HiderVC() }
    func updateUIViewController(_ uiViewController: HiderVC, context: Context) {}
    final class HiderVC: UIViewController {
        override var prefersHomeIndicatorAutoHidden: Bool { true }
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            setNeedsUpdateOfHomeIndicatorAutoHidden()
        }
    }
}
#endif

extension Notification.Name {
    static let displayOpenSettings = Notification.Name("OT.Display.OpenSettings")
}
