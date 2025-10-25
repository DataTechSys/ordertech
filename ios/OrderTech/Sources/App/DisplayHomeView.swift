import SwiftUI
import OrderTechCore
import UIKit
import AVFoundation
import AVKit
import OrderTechCore
import Foundation

// MARK: - Build Environment Detection
enum BuildEnv {
    /// Returns true if running on iOS Simulator, false on physical device
    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
}

// MARK: - Responsive Padding Helper (Inline for DisplayHomeView)
struct ResponsivePaddingModifier: ViewModifier {
    @EnvironmentObject private var orientation: OrientationModel
    
    let portraitPadding: EdgeInsets
    let landscapePadding: EdgeInsets
    
    func body(content: Content) -> some View {
        content.padding(orientation.isLandscape ? landscapePadding : portraitPadding)
    }
}

extension View {
    /// Applies different padding based on orientation
    func responsivePadding(
        portrait: EdgeInsets = EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16),
        landscape: EdgeInsets = EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20)
    ) -> some View {
        self.modifier(ResponsivePaddingModifier(
            portraitPadding: portrait,
            landscapePadding: landscape
        ))
    }
}

struct DisplayHomeView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var orientation: OrientationModel
    @ObservedObject var store: DisplaySessionStore
    @EnvironmentObject var localMode: LocalModeManager
    @Environment(\.isExternalContext) private var isExternalContext
    @State private var brandPrimaryColor: Color? = nil
    @State private var showBasketSheet: Bool = false
    @StateObject private var catalog = CatalogStore()
    // Edit context when tapping lines in the bill
    @State private var editProduct: Product? = nil
    @State private var editLineId: String? = nil
    @State private var editQty: Int = 1
    @State private var editLine: BasketLineUI? = nil
    // Product detail popup state - moved to main view for full-screen coverage
    @State private var selectedProduct: Product? = nil
    @State private var showDisconnectConfirmation: Bool = false
    
    // Poster overlay state
    @State private var showPosterOverlay: Bool = false
    
    // Track previous local mode state to detect transitions
    @State private var wasInLocalMode: Bool = false

    // Layout ratios - fixed: top row (camera + bill) is 1/4 of the screen height on all contexts
    private func topHeightFraction(isPad: Bool, isLandscape: Bool) -> CGFloat {
        return 0.25
    }
    
    private func camWidthFraction(isLandscape: Bool) -> CGFloat {
        return isLandscape ? 0.35 : 0.30
    }
    
    private let hGap: CGFloat = 4

    // Connection status used by the small chip (matches Cashier semantics)
    private var statusText: String {
        let isActivated = !(env.deviceToken ?? "").isEmpty
        if !isActivated { return "UNPAIRED" }
        if !store.connected { return "OFFLINE" }
        // Show OFFLINE when WebSocket is connected but no peers are connected
        // This handles the case where the cashier disconnects but WebSocket remains connected
        return store.peersConnected ? "CONNECTED" : "OFFLINE"
    }


    // Extract main content as computed property to reduce complexity
    @ViewBuilder
    private func mainContent(geo: GeometryProxy) -> some View {
        let totalW = geo.size.width
        let totalH = geo.size.height
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone

        // Drive layout using same spacing conventions as Cashier
        let hPad: CGFloat = 0
        let contentW = max(0, totalW - (hPad * 2))

        let topHF: CGFloat = topHeightFraction(isPad: isPad, isLandscape: orientation.isLandscape)
        let camWF: CGFloat = camWidthFraction(isLandscape: orientation.isLandscape)
        let billWF: CGFloat = 1.0 - camWF

        let topH = totalH * topHF
        let bottomH = max(0, totalH - topH)

        // Inner padding to align top row with bottom menu
        let innerPad: CGFloat = 0
        let innerContentW = max(0, contentW - (innerPad * 2))
        let sharedInner = max(0, innerContentW - hGap)
        let camW = max(0, (sharedInner * camWF).rounded(.down))
        let billW = max(0, (sharedInner * billWF).rounded(.down))

        ZStack(alignment: .topLeading) {
            (brandPrimaryColor ?? DT.bg).ignoresSafeArea()
            VStack(spacing: hGap) {
                // TOP ROW: [ Camera | Bill ]
                topRowView(camW: camW, billW: billW, topH: topH, contentW: contentW, innerPad: innerPad, isPad: isPad)
                
                // BOTTOM: Catalog (categories + products)
                CategoriesBoxView(
                    selectedProduct: $selectedProduct,
                    preview: store.preview, 
                    poster: store.poster
                )
                    .environmentObject(catalog)
                    .environmentObject(localMode)
                    .frame(width: contentW, height: bottomH)
                    .frame(height: bottomH)
            }
            .frame(width: contentW, height: totalH)
                .responsivePadding(
                    portrait: EdgeInsets(top: 0, leading: hPad, bottom: 0, trailing: hPad),
                    landscape: EdgeInsets(top: 0, leading: hPad, bottom: 0, trailing: hPad)
                )
            
            // Bottom-left double-click area for poster activation (64x64 invisible area)
            VStack {
                Spacer()
                HStack {
                    Color.clear
                        .frame(width: 64, height: 64)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) {
                            print("[DisplayHomeView] Bottom-left double-tap detected - showing poster overlay")
                            showPosterOverlay = true
                        }
                    Spacer()
                }
            }
        }
        
    }

    @ViewBuilder
    private func topRowView(camW: CGFloat, billW: CGFloat, topH: CGFloat, contentW: CGFloat, innerPad: CGFloat, isPad: Bool) -> some View {
        // Calculate width based on 9:16 aspect ratio from height
        let aspectWidth = topH * (9.0 / 16.0)
        
        HStack(spacing: hGap) {
            // Center the camera box horizontally with the correct aspect ratio
            HStack {
                Spacer()
                CameraBoxView(peersConnected: store.peersConnected)
                    .frame(width: aspectWidth, height: topH)
                Spacer()
            }
            .frame(width: camW)
            BillBoxView(
                lines: localMode.isLocalMode ? localMode.localBasketLines : store.basketLines,
                totals: localMode.isLocalMode ? localMode.localBasketTotals : store.basketTotals,
                textScale: isPad ? (orientation.isLandscape ? 0.9 : 1.0) : (orientation.isLandscape ? 0.55 : 0.6),
                onTapTotal: { showBasketSheet = true },
                onTapLine: { line in
                    // Map basket line id back to a catalog product and mirror to peers
                    let candidates = alternateIds(from: line.id)
                    if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                        store.pendingEditSku = line.id
                        store.sendShowProduct(id: p.id)
                    }
                },
                onEditLine: { line in
                    let candidates = alternateIds(from: line.id)
                    if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                        store.pendingEditSku = line.id
                        store.sendShowProduct(id: p.id)
                    }
                },
                onDeleteLine: { line in
                    if localMode.isLocalMode {
                        localMode.removeFromLocalBasket(lineId: line.id)
                    } else {
                        let candidates = alternateIds(from: line.id)
                        if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                            store.removeFromBasket(sku: p.id)
                        } else {
                            store.removeFromBasket(sku: line.id)
                        }
                    }
                }
            )
                .environmentObject(env)
                .environmentObject(catalog)
                .frame(width: billW, height: topH)
        }
        .padding(.horizontal, innerPad)
        .frame(width: contentW, height: topH)
    }

    var body: some View {
        GeometryReader { geo in
            mainContent(geo: geo)
        }
        .task { 
            await loadBrand() 
            await catalog.loadAll(env: env)
            
            // Set up LocalModeManager and DisplaySessionStore integration first
            localMode.configure(with: env, displaySessionStore: store)
            
            // Check initial state and activate local mode if needed
            localMode.checkInitialState(connected: store.connected, peersConnected: store.peersConnected)
        }
        .onReceive(store.$connected.combineLatest(store.$peersConnected)) { connected, peersConnected in
            localMode.updateConnectionStatus(connected: connected, peersConnected: peersConnected)
            
            // Auto-dismiss poster overlay when a remote session starts
            if peersConnected && showPosterOverlay {
                print("[DisplayHomeView] Remote session started - dismissing poster overlay")
                showPosterOverlay = false
            }
            
            // Clear local UI state when switching to remote mode
            if peersConnected && localMode.isLocalMode {
                print("[DisplayHomeView] Remote session started - clearing local UI state")
                selectedProduct = nil
            }
            
            // Clear remote UI state when returning to local mode
            if !peersConnected && !localMode.isLocalMode {
                print("[DisplayHomeView] Connection lost - will clear remote UI state when local mode activates")
            }
        }
        .onReceive(store.$poster) { poster in
            // Control poster overlay based on WebSocket events from Cashier
            if let _ = poster {
                print("[DisplayHomeView] Received poster:start from cashier - showing poster overlay")
                showPosterOverlay = true
            } else {
                print("[DisplayHomeView] Received poster:stop from cashier - hiding poster overlay")
                showPosterOverlay = false
            }
        }
.onReceive(store.$selectedProductId
            .removeDuplicates()
            .debounce(for: .milliseconds(100), scheduler: RunLoop.main)
        ) { pid in
            // Skip only remote-controlled changes while in local mode; allow local mirroring to external display
            if localMode.isLocalMode && store.peersConnected {
                print("[DisplayHomeView] Ignoring remote selectedProductId update in local mode: \(pid ?? "nil")")
                return
            }
            
            // Apply selection coming from our own device (mirroring) or from remote when allowed
            if let id = pid, !id.isEmpty {
                if let product = catalog.products.first(where: { $0.id == id }) {
                    selectedProduct = product
                }
            } else {
                // Clear popup when selectedProductId is set to nil (product options close)
                selectedProduct = nil
            }
        }
        .onChange(of: catalog.products.map { $0.id }) { _ in
            // If a product id was requested before data loaded, try fulfilling now
            if let id = store.selectedProductId, let product = catalog.products.first(where: { $0.id == id }) {
                selectedProduct = product
            }
        }
        .onReceive(localMode.$isLocalMode) { isLocalMode in
            // Only clear remote UI state when transitioning FROM remote TO local mode
            if isLocalMode && !wasInLocalMode {
                print("[DisplayHomeView] Transitioning to local mode - clearing remote UI state")
                selectedProduct = nil
                // The DisplaySessionStore will handle clearing its own remote state via resetToLocalControl
            }
            wasInLocalMode = isLocalMode
        }
        .environmentObject(localMode)
        .overlay {
            // Local mode checkout overlay
            if localMode.showCheckoutOverlay {
                LocalCheckoutOverlay()
                    .environmentObject(localMode)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .overlay {
            // Local mode receipt overlay
            if localMode.showReceipt, let receipt = localMode.lastOrderReceipt {
                LocalReceiptView(receipt: receipt)
                    .environmentObject(localMode)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .overlay {
            // Full-screen poster overlay
            if showPosterOverlay {
                PosterOverlayView(isPresented: $showPosterOverlay) {
                    showPosterOverlay = false
                }
                .transition(.opacity)
                .zIndex(1000)
            }
        }
        .overlay {
            // Product detail popup - slide up from bottom
            if let product = selectedProduct {
                Color.black.opacity(0.3)
                    .ignoresSafeArea(.all)
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            selectedProduct = nil
                            // Propagate close to other scene
                            store.selectedProductId = nil
                            // Reset shared quantity on backdrop tap close
                            store.optionsQty = 1
                            // Reset shared modifiers selection on backdrop close
                            store.optionsSelection = [:]
                        }
                    }
                    .overlay(alignment: .bottom) {
                        ProductDetailPopup(
                            product: product,
                            onAddToCart: { product, quantity, modifiers in
                                handleProductSelection(product: product, quantity: quantity, modifiers: modifiers)
                            },
                            onDismiss: {
                                withAnimation(.easeInOut(duration: 0.3)) {
                                    selectedProduct = nil
                                    // Propagate close so external scene also dismisses
                                    store.selectedProductId = nil
                                    // Reset shared quantity after closing options
                                    store.optionsQty = 1
                                    // Reset shared modifiers selection
                                    store.optionsSelection = [:]
                                }
                            }
                        )
                        .environmentObject(env)
                        .environmentObject(store)
                        .environmentObject(localMode)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 0)
                        .contentShape(Rectangle())
                        .allowsHitTesting(true)
                        .zIndex(2000)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    .transition(.opacity)
                    .zIndex(999)
            }
        }
        .alert("Disconnect from Cashier?", isPresented: $showDisconnectConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Disconnect", role: .destructive) {
                store.stop() // Disconnect WebSocket and RTC
                localMode.activateLocalMode() // Switch to local mode immediately
            }
        } message: {
            Text("This will disconnect from the cashier and switch to local mode.")
        }
.sheet(isPresented: $showBasketSheet) {
            let isPad = UIDevice.current.userInterfaceIdiom == .pad
            VStack(spacing: 0) {
                BillBoxView(
                    lines: localMode.isLocalMode ? localMode.localBasketLines : store.basketLines,
                    totals: localMode.isLocalMode ? localMode.localBasketTotals : store.basketTotals,
                    textScale: isPad ? (orientation.isLandscape ? 1.0 : 1.2) : (orientation.isLandscape ? 0.9 : 1.0),
                    onTapTotal: nil,
                    onTapLine: { line in
                        // Dismiss basket sheet before mirroring edit to peers
                        showBasketSheet = false
                        let candidates = alternateIds(from: line.id)
                        if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                            store.pendingEditSku = line.id
                            store.sendShowProduct(id: p.id)
                        }
                    },
                    onEditLine: { line in
                        // Same as tap
                        showBasketSheet = false
                        let candidates = alternateIds(from: line.id)
                        if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                            store.pendingEditSku = line.id
                            store.sendShowProduct(id: p.id)
                        }
                    },
                    onDeleteLine: { line in
                        if localMode.isLocalMode {
                            localMode.removeFromLocalBasket(lineId: line.id)
                        } else {
                            let candidates = alternateIds(from: line.id)
                            if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                                store.removeFromBasket(sku: p.id)
                            } else {
                                // Fallback: try using line.id directly
                                store.removeFromBasket(sku: line.id)
                            }
                        }
                    }
                )
                .environmentObject(env)
                .environmentObject(catalog)
                .padding()
                
                if localMode.isLocalMode && !localMode.localBasketLines.isEmpty {
                    Divider().padding(.horizontal)
                    HStack {
                        LocalCheckoutButton(
                            basketTotal: localMode.localBasketTotals.total,
                            itemCount: localMode.localBasketLines.reduce(0) { $0 + $1.qty },
                            onTap: {
                                // Close the bill popup and start checkout overlay
                                showBasketSheet = false
                                localMode.startCheckout()
                            }
                        )
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                }
            }
            .presentationDetents(orientation.isLandscape ? [.medium, .fraction(0.6)] : [.medium, .large])
        }
    }
    
    // MARK: - Product Selection Handling
    private func handleProductSelection(product: Product, quantity: Int, modifiers: [String: Any]) {
        if localMode.isLocalMode {
            // Add to local basket with modifiers (single line with qty)
            let mods = (modifiers["options"] as? [[String: Any]]) ?? []
            localMode.addToLocalBasket(product: product, qty: quantity, modifiers: mods)
        } else {
            // Send to cashier with product and selected modifiers to reflect in basket UI immediately
            let mods = (modifiers["options"] as? [[String: Any]]) ?? []
            if mods.isEmpty {
                store.addToBasket(product: product, qty: quantity)
            } else {
                store.addToBasket(product: product, qty: quantity, modifiers: mods)
            }
        }
        
        // Clear selection to close popup with animation and mirror to other scene
        withAnimation(.easeInOut(duration: 0.3)) {
            selectedProduct = nil
            store.selectedProductId = nil
        }
    }
}

// MARK: - Top Left: Camera with PIP (no background loop)
private struct CameraBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var store: DisplaySessionStore
    @EnvironmentObject var localMode: LocalModeManager
    @Environment(\.isExternalContext) private var isExternalContext
    #if canImport(WebRTC)
    @EnvironmentObject var storeService: WebRTCService
    #endif
    #if canImport(AVFoundation)
@StateObject private var preconnectController = DisplayPreconnectCameraController()
    #endif
    let peersConnected: Bool
    @State private var remoteKey: Int = 0
    @State private var pipLocalReady: Bool = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            AsymmetricRoundedRect(topLeft: 0, topRight: 0, bottomLeft: 12, bottomRight: 12).fill(Color.black)
            
            // Regular video content
            videoContent
            
            // PIP overlays for video calling
            videoPIPOverlays
            
            // Center overlay with link status (text + spinner) until video attaches
            if showLinkStatusOverlay {
                LinkStatusOverlay(title: linkStatusTitle, subtitle: linkStatusSubtitle)
                    .padding(16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    .transition(.opacity)
                    .accessibilityLabel(Text(linkStatusTitle))
            }
        }
            .overlay(alignment: .topLeading) {
                Color.black.opacity(0.001)
                    .frame(width: 64, height: 64)
                    .contentShape(Rectangle())
                    .allowsHitTesting(true)
                    .gesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in
                        NotificationCenter.default.post(name: .displayOpenSettings, object: nil)
                    })
                    .zIndex(100)
            }
            .clipShape(AsymmetricRoundedRect(topLeft: 0, topRight: 0, bottomLeft: 12, bottomRight: 12))
        .overlay(AsymmetricRoundedRect(topLeft: 0, topRight: 0, bottomLeft: 12, bottomRight: 12).stroke(Color.white.opacity(0.15), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            LocalModeIndicator(isActive: localMode.isLocalMode)
                .environmentObject(store)
                .scaleEffect(0.9)
                .padding(.top, 6)
                .padding(.trailing, 6)
        }
        .compositingGroup()
        .onReceive(NotificationCenter.default.publisher(for: .displayKickVideo)) { _ in
            remoteKey += 1
        }
        .onReceive(NotificationCenter.default.publisher(for: .displayVideoRefresh)) { _ in
            print("[CameraBoxView] Received video refresh notification, updating remoteKey")
            remoteKey += 1
        }
        .onReceive(NotificationCenter.default.publisher(for: .displayLocalCameraReady)) { _ in
            pipLocalReady = true
            #if canImport(AVFoundation)
            preconnectController.stop()
            #endif
        }
        .contentShape(Rectangle())
    }

    // MARK: Link status overlay control
    private var showLinkStatusOverlay: Bool {
        // Temporarily disabled overlay to fix video display issues
        // TODO: Fix link status logic and re-enable overlay
        return false
        
        // Original logic (commented out):
        // // Show until remote video is attached
        // #if canImport(LiveKit)
        // if let lk = store.currentLiveKit {
        //     return lk.linkStatus != .remoteAttached
        // }
        // #endif
        // if !store.connected { return true }
        // if !store.peersConnected { return true }
        // return false
    }

    private var linkStatusTitle: String {
        if !store.connected { return "Connecting to server…" }
        if !store.peersConnected { return "Waiting for cashier…" }
        #if canImport(LiveKit)
        if let lk = store.currentLiveKit { return lk.linkStatus.text }
        #endif
        return "Starting video…"
    }

    private var linkStatusSubtitle: String? {
        #if canImport(LiveKit)
        if let lk = store.currentLiveKit {
            switch lk.linkStatus {
            case .tokenRequested: return "Requesting access from server"
            case .roomConnecting: return "Negotiating media session"
            case .roomConnected: return "Setting up camera and speakers"
            case .remotePending: return "Waiting for remote stream"
            case .error(let m): return m
            default: return nil
            }
        }
        #endif
        return nil
    }

    // MARK: Video Content
    private var videoContent: some View {
        Group {
            if localMode.isLocalMode {
                // Local mode: Show only local device camera
                LocalCameraView()
                    .aspectRatio(CGSize(width: 9, height: 16), contentMode: .fit)
                    .onAppear {
                        print("[CameraBoxView] Local mode - Local camera main video appeared")
                    }
            } else {
                // Remote mode: Show LiveKit remote video
                #if canImport(LiveKit)
                let currentLiveKit = store.currentLiveKit
                let hasLiveKit = currentLiveKit != nil
                let _ = print("[CameraBoxView] Remote mode rendering: hasLiveKit=\(hasLiveKit)")
                if hasLiveKit {
                    LKRemoteVideoView(cornerRadius: 12, masksToBounds: true)
                        .id("remote_\(remoteKey)")
                        .environmentObject(store)
                        .aspectRatio(9/16, contentMode: .fit)
                        .onAppear {
                            print("[CameraBoxView] Remote mode - LiveKit remote video appeared")
                        }
                } else {
                    fallbackView
                }
                #else
                fallbackView
                #endif
            }
        }
    }
    
    private var videoPIPOverlays: some View {
        Group {
            // PIP only shown in remote mode (not in local mode)
            #if canImport(LiveKit)
            if !localMode.isLocalMode && store.currentLiveKit != nil {
                GeometryReader { geo in
                    let pipW: CGFloat = 48
                    let pipH: CGFloat = pipW * 16.0 / 9.0
                    let x = geo.size.width - 8 - pipW / 2
                    let y = min(geo.size.height - 8 - pipH / 2, geo.size.height * 5.0 / 6.0)
                    ZStack {
                        #if canImport(AVFoundation)
                        if !pipLocalReady {
                            DisplayPreconnectLocalPreview(controller: preconnectController)
                                .frame(width: pipW, height: pipH)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.6), lineWidth: 1))
                                .shadow(radius: 1)
                                .position(x: x, y: y)
                                .onAppear { preconnectController.start() }
                                .onDisappear { preconnectController.stop() }
                        }
                        #endif
                        LKLocalVideoView()
                            .environmentObject(store)
                            .frame(width: pipW, height: pipH)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.6), lineWidth: 1))
                            .shadow(radius: 3)
                            .position(x: x, y: y)
                            .onAppear {
                                print("[CameraBoxView] Remote mode - Local camera PIP appeared")
                            }
                    }
                }
            }
            #endif
        }
    }

    private var fallbackView: some View {
        Group {
            #if canImport(WebRTC)
            if let remote = storeService.remoteVideoTrack {
                RTCRemoteVideoView(track: remote)
                    .id(remoteKey)
                    .aspectRatio(9/16, contentMode: .fit)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                EmptyView() // Poster (tenant or default) will be visible behind
            }
            #else
            EmptyView() // Poster (tenant or default) will be visible behind
            #endif
        }
    }
}

// MARK: - LinkStatusOverlay (Drive)
private struct LinkStatusOverlay: View {
    var title: String
    var subtitle: String?
    var body: some View {
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone
        let titleSize: CGFloat = isPhone ? 13 : 15
        let subtitleSize: CGFloat = isPhone ? 11 : 13
        VStack(spacing: 8) {
            ProgressView()
                .progressViewStyle(.circular)
            Text(title)
                .font(.system(size: titleSize, weight: .semibold))
                .foregroundColor(.white)
            if let s = subtitle, !s.isEmpty {
                Text(s)
                    .font(.system(size: subtitleSize))
                    .foregroundColor(.white.opacity(0.9))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.15), lineWidth: 1))
    }
}

// MARK: - Bill item appearance configuration
private struct BillItemAppearance {
    var qtyNameMultiplier: CGFloat = 1.0
    var optionsMultiplier: CGFloat = 1.0
    var priceMultiplier: CGFloat = 0.95
    var rowSpacing: CGFloat = 4.0
}


// MARK: - Top Right: Bill (Order + Totals)
private struct BillBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var catalog: CatalogStore
    @EnvironmentObject var orientation: OrientationModel
    @Environment(\.isExternalContext) private var isExternalContext
    let lines: [BasketLineUI]
    let totals: BasketTotalsUI
    var textScale: CGFloat = 1.0
    var onTapTotal: (() -> Void)? = nil
    var onTapLine: ((BasketLineUI) -> Void)? = nil
    var onEditLine: ((BasketLineUI) -> Void)? = nil
    var onDeleteLine: ((BasketLineUI) -> Void)? = nil
    var appearance: BillItemAppearance = BillItemAppearance()
    var body: some View {
        VStack(spacing: 0) {
            if isExternalContext {
                HStack {
                    Text("Order Summary").font(.system(size: 17 * textScale, weight: .semibold))
                    Spacer()
                }
                .padding(.top, 10)
                .padding(.leading, 6)

                Divider().padding(.bottom, 6)
            }

// Order lines (Cashier-style)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(lines.indices, id: \.self) { index in
                        let line = lines[index]
                        
                        SwipeableRow(
                            onEdit: { onEditLine?(line) ?? onTapLine?(line) },
                            onDelete: { onDeleteLine?(line) },
                            editColor: DT.acc,
                            deleteColor: .red.opacity(0.9)
                        ) {
                            HStack(alignment: .top, spacing: 6) {
                                if let url = imageURL(for: line) {
                                    SquareAsyncImage(url: url, cornerRadius: 6, animated: false)
                                        .frame(width: 32, height: 32)
                                } else {
                                    Rectangle().fill(Color.gray.opacity(0.15)).frame(width: 32, height: 32).cornerRadius(6)
                                }
                                // Left block: Row1 (qty x name), Row2 (modifiers), Row3 (unit price)
                                VStack(alignment: .leading, spacing: appearance.rowSpacing) {
                                    // Row 1: qty x product name
                                    Text("\(line.qty)x \(line.name)")
                                        .font(.system(size: 14 * textScale * appearance.qtyNameMultiplier, weight: .semibold))
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                        .foregroundColor(.primary)
                                    // Row 2: modifiers (option names only)
                                    let modsClean = line.options.map { opt -> String in
                                        if let idx = opt.firstIndex(of: ":") {
                                            let after = opt.index(after: idx)
                                            return String(opt[after...]).trimmingCharacters(in: .whitespaces)
                                        }
                                        return opt
                                    }.filter { !$0.isEmpty }.joined(separator: ", ")
                                    if !modsClean.isEmpty {
                                        Text(modsClean)
                                            .font(.system(size: 10 * textScale * appearance.optionsMultiplier))
                                            .foregroundColor(.secondary)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                    }
                                    // Row 3: unit price (left)
                                    Text(String(format: "%.3f kwd", line.unitPrice))
                                        .font(.system(size: 12 * textScale * appearance.priceMultiplier))
                                        .foregroundColor(.primary)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                // Right block: align total on the third row vertically
                                VStack(alignment: .trailing, spacing: 2) {
                                    Spacer(minLength: 0)
                                    Text(currency(line.lineTotal))
                                        .font(.system(size: 14 * textScale * appearance.qtyNameMultiplier, weight: .semibold))
                                        .monospacedDigit()
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { onTapLine?(line) }
                        }
                        .padding(.vertical, 4)
                        
                        // Add thin divider between items (except after the last item)
                        if index < lines.count - 1 {
                            Divider()
                                .frame(height: 0.5)
                                .background(Color.gray.opacity(0.3))
                                .padding(.horizontal, 8)
                        }
                    }
                }
            }
.padding(.leading, 2)
            .padding(.top, isExternalContext ? 0 : 8)

            // Totals footer (tap to expand if handler provided)
            Button(action: { onTapTotal?() }) {
                HStack {
                    Text("Basket").font(.system(size: 17 * textScale))
                    Spacer()
                    Text(currency(totals.total)).font(.system(size: 17 * textScale, weight: .bold)).monospacedDigit()
                }
                .padding()
                .background(Color.white.opacity(0.8))
            }
            .buttonStyle(.plain)
        }
        .background(.white)
        .clipShape(AsymmetricRoundedRect(topLeft: 0, topRight: 0, bottomLeft: 12, bottomRight: 12))
    }

    private func absoluteURL(_ raw: String?) -> URL? {
        guard var raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        // Absolute URL with scheme — return as-is
        if let u = URL(string: raw), u.scheme != nil { return u }
        // Split raw into path and query (if any) so we don't encode '?' into the path
        var pathPart = raw
        var queryPart: String? = nil
        if let qIdx = raw.firstIndex(of: "?") {
            pathPart = String(raw[..<qIdx])
            queryPart = String(raw[raw.index(after: qIdx)...])
        }
        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        if pathPart.hasPrefix("/") {
            comps.path = pathPart
        } else {
            let basePath = env.baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            comps.path = "/" + ([basePath, pathPart].filter { !$0.isEmpty }.joined(separator: "/"))
        }
        if let q = queryPart, !q.isEmpty { comps.percentEncodedQuery = q }
        return comps.url
    }

    private func imageURL(for line: BasketLineUI) -> URL? {
        // 1) Use provided image URL if present
        if let u = absoluteURL(line.imageURL) { return u }
        // 2) Fallback to catalog by matching product id or alternate ids
        let candidates = alternateIds(from: line.id)
        if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
            return absoluteURL(p.image_url)
        }
        return nil
    }

    private func alternateIds(from id: String) -> [String] {
        var set = Set<String>()
        set.insert(id)
        let comps1 = id.split(separator: ":").map(String.init)
        if let last = comps1.last { set.insert(last) }
        let comps2 = id.split(separator: "#").map(String.init)
        if let last = comps2.last { set.insert(last) }
        let comps3 = id.split(separator: "-").map(String.init)
        if let last = comps3.last { set.insert(last) }
        let digits = id.filter { $0.isNumber }
        if !digits.isEmpty { set.insert(digits) }
        return Array(set)
    }
}

// MARK: - Fullscreen overlay for Display video
private struct DisplayFullscreenVideoView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var store: DisplaySessionStore
    #if canImport(WebRTC)
    @EnvironmentObject var storeService: WebRTCService
    #endif
    @Binding var isPresented: Bool
    @State private var fullVideoKey: Int = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            // Poster removed temporarily while fixing video attach issues
            Color.black.ignoresSafeArea()

            // Video content
            Group {
                #if canImport(LiveKit)
                if store.currentLiveKit != nil {
                    LKRemoteVideoView()
                        .id(fullVideoKey)
                        .environmentObject(store)
                        .ignoresSafeArea()
                } else {
                    fallbackFullView
                }
                #else
                fallbackFullView
                #endif
            }

            Button(action: { isPresented = false }) {
                Image(systemName: "arrow.down.right.and.arrow.up.left")
                    .padding(10)
                    .background(Capsule().fill(Color.white.opacity(0.2)))
            }
            .padding(16)
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { isPresented = false }
    }

    @ViewBuilder
    private var fallbackFullView: some View {
        #if canImport(WebRTC)
        if let track = storeService.remoteVideoTrack {
            RTCRemoteVideoView(track: track)
                .ignoresSafeArea()
        } else {
            EmptyView() // Poster backdrop visible
        }
        #else
        EmptyView() // Poster backdrop visible
        #endif
    }
}

// MARK: - Bottom Left: Catalog (Categories + Products) to match Cashier iPad design
private struct CategoriesBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var store: DisplaySessionStore
    @EnvironmentObject var catalog: CatalogStore
    @EnvironmentObject var localMode: LocalModeManager
    @EnvironmentObject var orientation: OrientationModel
    @State private var selectedCategory: String? = nil
    @State private var pageIndex: Int = 1
    
    @Binding var selectedProduct: Product?
    let preview: PreviewState?
    let poster: PosterState?

    // Removed debug controls in production build

    @State private var topVisibleProductId: String? = nil
    @State private var suppressScrollBroadcast: Bool = false
    @State private var topDebounceWorkItem: DispatchWorkItem? = nil
    var body: some View {
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone
        
        VStack(spacing: DT.space) {
            categoryChips
                .zIndex(2)
            
            ZStack {
                productsPager
                
                if let p = poster {
                    PosterView(poster: p)
                        .padding(20)
                        .zIndex(1)
                        .allowsHitTesting(false)
                } else if let pr = preview {
                    PreviewCardView(preview: pr)
                        .padding(20)
                        .zIndex(1)
                        .allowsHitTesting(false)
                }
            }
            .zIndex(0)
        }
        .onReceive(store.$selectedCategoryName.removeDuplicates()) { name in
            // When category changes from Cashier, reset any scroll echo suppression automatically
            suppressScrollBroadcast = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { suppressScrollBroadcast = false }
        }
.padding(.horizontal, 10)
        .padding(.vertical, DT.space2)
        .background(DT.surface)
        .clipShape(AsymmetricRoundedRect(topLeft: DT.radius, topRight: DT.radius, bottomLeft: 0, bottomRight: 0))
        .overlay(
            AsymmetricRoundedRect(topLeft: DT.radius, topRight: DT.radius, bottomLeft: 0, bottomRight: 0)
                .stroke(DT.line, lineWidth: 1)
        )
        .ignoresSafeArea(edges: .bottom)
        .task { await initialLoad() }
        .onReceive(NotificationCenter.default.publisher(for: .catalogDidSync)) { _ in
            Task { await initialLoad() }
        }
.onReceive(store.$selectedCategoryName.removeDuplicates()) { name in
            // Skip only when remote peers are connected and we're in local mode; otherwise allow local mirroring
            if localMode.isLocalMode && store.peersConnected {
                print("[CategoriesBoxView] Ignoring remote selectedCategoryName update in local mode: \(name ?? "nil")")
                return
            }
            // Apply mirrored or remote category
            if let n = name, !n.isEmpty { selectedCategory = n }
        }
        .onReceive(localMode.$isLocalMode) { isLocalMode in
            if isLocalMode {
                print("[CategoriesBoxView] Local mode activated - resetting category selection to first category")
                // Reset to first category when local mode activates to ensure clean state
                if let firstCategory = catalog.categoriesWithProducts.first?.name {
                    selectedCategory = firstCategory
                    pageIndex = 1
                }
            }
        }
        .overlay(alignment: .center) {
            if catalog.isLoading {
                VStack(spacing: 12) {
                    ProgressView()
                        .scaleEffect(1.2)
                    Text(catalog.loadingProgress.isEmpty ? "Loading menu…" : catalog.loadingProgress)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .padding(24)
                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.95)))
                .shadow(radius: 10)
            } else if catalog.categories.isEmpty && catalog.products.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundColor(.orange)
                    Text("No menu data available")
                        .font(.subheadline)
                    Text("Go to Settings to sync")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(24)
                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.95)))
            }
        }
    }

    private var categoryChips: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(catalog.categoriesWithProducts) { c in
                            let isSel = (c.name == (selectedCategory ?? c.name))
                            Button(action: { Task { await select(category: c.name) } }) {
                                Text(c.name)
                                    .font(.system(size: 15, weight: isSel ? .semibold : .regular))
                                    .foregroundColor(isSel ? DT.acc : DT.ink)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(isSel ? DT.acc.opacity(0.12) : DT.surface)
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSel ? DT.acc : DT.line, lineWidth: 1))
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .id(c.id)
                        }
                    }
                }
                .onAppear {
                    if let sel = selectedCategory, let cid = catalog.categoriesWithProducts.first(where: { $0.name == sel })?.id {
                        withAnimation { proxy.scrollTo(cid, anchor: .center) }
                    } else if let first = catalog.categoriesWithProducts.first?.id {
                        withAnimation { proxy.scrollTo(first, anchor: .center) }
                    }
                }
                .onChange(of: selectedCategory ?? "") { _ in
                    if let sel = selectedCategory, let cid = catalog.categoriesWithProducts.first(where: { $0.name == sel })?.id {
                        withAnimation { proxy.scrollTo(cid, anchor: .center) }
                    }
                }
            }
            Divider()
        }
        .background(DT.surface.opacity(0.98))
    }

    private var productsPager: some View {
        GeometryReader { proxy in
            let isPhone = UIDevice.current.userInterfaceIdiom == .phone
            let horizontalPadding = CGFloat(0)
            let availableWidth = proxy.size.width - (horizontalPadding * 2)
            let spacing: CGFloat = availableWidth < 430 ? DT.space : DT.space2
            
            // Orientation-aware grid sizing
            let minColW: CGFloat = isPhone ? (orientation.isLandscape ? 85 : 95) : (orientation.isLandscape ? 110 : 120)
            let maxCols = orientation.isLandscape ? 6 : 4 // More columns in landscape
            let minCols = orientation.isLandscape ? 4 : 3 // Higher minimum in landscape
            
            // Calculate responsive columns
            let colCalculation = (availableWidth + spacing) / (minColW + spacing)
            let columnsCount = max(minCols, min(maxCols, Int(floor(colCalculation))))
            let totalSpacing = spacing * CGFloat(columnsCount - 1)
            let colW = floor((availableWidth - totalSpacing) / CGFloat(columnsCount))

            let cats = catalog.categoriesWithProducts
            let hasCats = !cats.isEmpty
            let cyc = hasCats ? ([cats.last!] + cats + [cats.first!]) : []
            // If no categories came back, show all products on a single page
            let singlePageAll = !hasCats ? [Category(id: "all", name: "All")] : []

            TabView(selection: $pageIndex) {
                if !singlePageAll.isEmpty {
                    let list = catalog.products(inCategoryName: nil, env: env)
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVGrid(
                                columns: Array(repeating: GridItem(.fixed(colW), spacing: spacing, alignment: .top), count: columnsCount),
                                spacing: spacing
                            ) {
                                ForEach(list) { p in
                                    ProductTile(product: p, width: colW, onTap: {
                                        // Update shared store so both iPhone and external display open the popup
                                        store.selectedProductId = p.id
                                        // Immediate local feedback
                                        withAnimation(.easeInOut(duration: 0.3)) { selectedProduct = p }
                                    })
                                        .environmentObject(env)
                                        .id(p.id)
                                        .background(
                                            GeometryReader { gp in
                                                Color.clear.preference(key: VisibleProductKey.self, value: [p.id: gp.frame(in: .named("displayCatalogScroll")).minY])
                                            }
                                        )
                                }
                            }
                            .padding(.top, 6)
                            .padding(.horizontal, horizontalPadding)
                        }
                        .coordinateSpace(name: "displayCatalogScroll")
.onPreferenceChange(VisibleProductKey.self) { offsets in
                            let topPair = offsets.min(by: { a, b in a.value < b.value })
                            if let top = topPair?.key { debounceTopVisible(top) }
                        }
.onReceive(store.$scrollToProductId.removeDuplicates()) { pid in
                            // Skip only when remote peers are connected and we're in local mode; otherwise allow local mirroring
                            if localMode.isLocalMode && store.peersConnected { return }
                            guard let pid = pid, list.contains(where: { $0.id == pid }) else { return }
                            withAnimation { proxy.scrollTo(pid, anchor: .top) }
                        }
                    }
                } else {
                    ForEach(Array(cyc.enumerated()), id: \.offset) { pair in
                        let i = pair.offset
                        let c = pair.element
                        let list = catalog.products(inCategoryName: c.name, env: env)
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVGrid(
                                    columns: Array(repeating: GridItem(.fixed(colW), spacing: spacing, alignment: .top), count: columnsCount),
                                    spacing: spacing
                                ) {
                                    ForEach(list) { p in
                                        ProductTile(product: p, width: colW, onTap: {
                                            // Update shared store so both iPhone and external display open the popup
                                            store.selectedProductId = p.id
                                            // Immediate local feedback
                                            withAnimation(.easeInOut(duration: 0.3)) { selectedProduct = p }
                                        })
                                            .environmentObject(env)
                                            .id(p.id)
                                            .background(
                                                GeometryReader { gp in
                                                    Color.clear.preference(key: VisibleProductKey.self, value: [p.id: gp.frame(in: .named("displayCatalogScroll")).minY])
                                                }
                                            )
                                    }
                                }
                                .padding(.top, 6)
                                .padding(.horizontal, horizontalPadding)
                            }
                            .coordinateSpace(name: "displayCatalogScroll")
.onPreferenceChange(VisibleProductKey.self) { offsets in
                                let topPair = offsets.min(by: { a, b in a.value < b.value })
                                if let top = topPair?.key { debounceTopVisible(top) }
                            }
.onReceive(store.$scrollToProductId.removeDuplicates()) { pid in
                                // Skip only when remote peers are connected and we're in local mode; otherwise allow local mirroring
                                if localMode.isLocalMode && store.peersConnected { return }
                                guard let pid = pid, list.contains(where: { $0.id == pid }) else { return }
                                withAnimation { proxy.scrollTo(pid, anchor: .top) }
                            }
                        }
                        .tag(i)
                    }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .onAppear {
                if hasCats {
                    if let sel = selectedCategory, let idx = cats.firstIndex(where: { $0.name == sel }) {
                        pageIndex = idx + 1
                    } else {
                        pageIndex = 1
                        selectedCategory = cats.first?.name
                    }
                } else {
                    // No categories: single page with all products
                    pageIndex = 1
                }
            }
            .onChange(of: selectedCategory ?? "") { _ in
                if hasCats, let sel = selectedCategory, let idx = cats.firstIndex(where: { $0.name == sel }) {
                    let desired = idx + 1
                    if pageIndex != desired { pageIndex = desired }
                }
            }
            .onChange(of: pageIndex) { newVal in
                guard hasCats else { return }
                let lastIndex = cats.count
                if newVal == 0 {
                    pageIndex = lastIndex
                    let name = cats[lastIndex - 1].name
                    Task { await select(category: name) }
                } else if newVal == lastIndex + 1 {
                    pageIndex = 1
                    let name = cats[0].name
                    Task { await select(category: name) }
                } else {
                    let actual = max(1, min(lastIndex, newVal)) - 1
                    let name = cats[actual].name
                    if selectedCategory != name { Task { await select(category: name) } }
                }
            }
        }
    }

    private func initialLoad() async {
        await catalog.loadAll(env: env)
        // Ensure a selection and data visible
        if let first = catalog.categories.first?.name {
            selectedCategory = first
        } else {
            selectedCategory = nil
        }
    }

    private func select(category: String) async {
        selectedCategory = category
        // Mirror to shared store so external display reflects the change
        store.selectedCategoryName = category
        // Optional: notify peers (safe even if no peers)
        store.sendSelectCategory(name: category)
    }

    
    private func debounceTopVisible(_ top: String) {
        // Cancel any pending broadcast
        topDebounceWorkItem?.cancel()
        let work = DispatchWorkItem { [weak store = self.store, weak localMode = self.localMode] in
            guard let store = store, let localMode = localMode else { return }
            if top != self.topVisibleProductId {
                self.topVisibleProductId = top
                store.scrollToProductId = top
                if !localMode.isLocalMode && !self.suppressScrollBroadcast {
                    store.sendScrollTo(id: top)
                }
            }
        }
        topDebounceWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }
}

private struct VisibleProductKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { a, b in min(a, b) })
    }
}

// MARK: - Environment flag to detect external display context
private struct ExternalContextKey: EnvironmentKey { static let defaultValue: Bool = false }
extension EnvironmentValues {
    var isExternalContext: Bool {
        get { self[ExternalContextKey.self] }
        set { self[ExternalContextKey.self] = newValue }
    }
}

// MARK: - Temporary Product Detail Popup (will be moved to separate file)
struct ProductDetailPopup: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var localMode: LocalModeManager
    @EnvironmentObject var orientation: OrientationModel
    @EnvironmentObject var store: DisplaySessionStore
    @Environment(\.isExternalContext) private var isExternalContext
    @Environment(\.dismiss) private var dismiss
    
    let product: Product
    let onAddToCart: (Product, Int, [String: Any]) -> Void
    let onDismiss: () -> Void
    
    @State private var quantity: Int = 1
    @State private var selectedModifiers: [String: Any] = [:]
    @State private var isLoading = false
    // Modifiers
    @State private var modifierGroups: [DisplayModifierGroup] = []
    @State private var selection: [String: Set<String>] = [:] // group.id -> set(option.id)
    @State private var isLoadingOptions = false
    
    var totalPrice: Double {
        let perItem = product.price + selectedOptionsDelta
        return perItem * Double(quantity)
    }
    
    private func computeImageSide(isPad: Bool) -> CGFloat {
        let base: CGFloat
        if isPad {
            base = orientation.isLandscape ? 350 : 420
        } else {
            base = orientation.isLandscape ? 280 : 320
        }
        // Reduce on external display
        if isExternalContext {
            return isPad ? 300 : 220
        }
        return base
    }
    
    private var selectedOptionsDelta: Double {
        var sum: Double = 0
        for g in modifierGroups {
            let set = selection[g.group.id] ?? []
            for o in g.options where set.contains(o.id) {
                if let d = o.price { sum += d }
            }
        }
        return sum
    }
    
    var body: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let imageSide = computeImageSide(isPad: isPad)
        
        VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Product Details")
                        .font(.system(size: isPad ? 24 : 20, weight: .bold))
                        .foregroundColor(.primary)
                    Spacer()
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 16)
                .background(Color.white)
                
                // Scrollable content
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Product image section - full width, larger
                        Group {
                            if let imageURL = product.image_url, !imageURL.isEmpty {
                                AsyncImage(url: URL(string: imageURL)) { image in
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .frame(width: imageSide, height: imageSide)
                                        .clipShape(RoundedRectangle(cornerRadius: 16))
                                } placeholder: {
                                    RoundedRectangle(cornerRadius: 16)
                                        .fill(Color.gray.opacity(0.2))
                                        .frame(width: imageSide, height: imageSide)
                                        .overlay {
                                            VStack(spacing: 12) {
                                                Image(systemName: "photo")
                                                    .font(.system(size: 50))
                                                    .foregroundColor(.gray)
                                                Text("Loading...")
                                                    .font(.title3)
                                                    .foregroundColor(.gray)
                                            }
                                        }
                                }
                            } else {
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color.gray.opacity(0.15))
                                    .frame(width: imageSide, height: imageSide)
                                    .overlay {
                                        VStack(spacing: 12) {
                                            Image(systemName: "photo")
                                                .font(.system(size: 50))
                                                .foregroundColor(.gray)
                                            Text(product.name)
                                                .font(.title2.bold())
                                                .foregroundColor(.gray)
                                                .multilineTextAlignment(.center)
                                        }
                                    }
                            }
                        }
                        .frame(maxWidth: .infinity)
                        
                        // Product info
                        VStack(alignment: .leading, spacing: 8) {
                            // Arabic name (if available) above English
                            let ar = (product.name_localized?["ar"] ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                            if !ar.isEmpty {
                                Text(ar)
                                    .font(.system(size: isPad ? 24 : 20, weight: .bold))
                                    .foregroundColor(.primary)
                            }
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(product.name)
                                    .font(.system(size: isPad ? 28 : 24, weight: .bold))
                                    .foregroundColor(.primary)
                                if quantity > 1 {
                                    Text("x\(quantity)")
                                        .font(.system(size: isPad ? 20 : 16, weight: .semibold))
                                        .foregroundColor(.secondary)
                                }
                            }
                            
                            Text(String(format: "%.3f KWD", product.price))
                                .font(.system(size: isPad ? 22 : 18, weight: .semibold))
                                .foregroundColor(.blue)
                                .monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        
                        // Quantity selector moved to top
                        if !isExternalContext {
                            HStack {
                                Text("Quantity")
                                    .font(.system(size: isPad ? 20 : 18, weight: .medium))
                                    .foregroundColor(.primary)
                                
                                Spacer()
                                
                                HStack(spacing: 16) {
                                    Button(action: { 
                                        if quantity > 1 { quantity -= 1 }
                                    }) {
                                        Image(systemName: "minus")
                                            .font(.system(size: 18, weight: .semibold))
                                            .foregroundColor(.white)
                                            .frame(width: 40, height: 40)
                                            .background(Circle().fill(quantity > 1 ? Color.blue : Color.gray))
                                    }
                                    .disabled(quantity <= 1)
                                    .buttonStyle(.plain)
                                    
                                    Text("\(quantity)")
                                        .font(.system(size: isPad ? 22 : 20, weight: .bold))
                                        .foregroundColor(.primary)
                                        .frame(minWidth: 40)
                                    
                                    Button(action: { quantity += 1 }) {
                                        Image(systemName: "plus")
                                            .font(.system(size: 18, weight: .semibold))
                                            .foregroundColor(.white)
                                            .frame(width: 40, height: 40)
                                            .background(Circle().fill(Color.blue))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        
                        // Actions row moved to top
                        if !isExternalContext {
                            let rowH: CGFloat = isPad ? 56 : 48
                            HStack(spacing: 12) {
                                // Close button (narrow)
                                Button(action: {
                                    withAnimation(.easeInOut(duration: 0.3)) {
                                        onDismiss()
                                        store.selectedProductId = nil
                                    }
                                }) {
                                    Text("Close")
                                        .font(.system(size: isPad ? 16 : 14, weight: .semibold))
                                        .foregroundColor(.primary)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                                        .background(
                                            RoundedRectangle(cornerRadius: 16)
                                                .fill(Color.gray.opacity(0.08))
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 16)
                                                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                                .frame(height: rowH)
                                
                                // Add button (wide) — icon + price only
                                Button(action: addToCart) {
                                    HStack(spacing: 8) {
                                        Image(systemName: localMode.isLocalMode ? "cart.badge.plus" : "paperplane.fill")
                                            .font(.system(size: isPad ? 20 : 18, weight: .semibold))
                                        Text(String(format: "%.3f KWD", totalPrice))
                                            .font(.system(size: isPad ? 18 : 16, weight: .bold))
                                            .monospacedDigit()
                                    }
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                                    .background(
                                        RoundedRectangle(cornerRadius: 16)
                                            .fill(localMode.isLocalMode ? Color.orange : Color.blue)
                                            .shadow(color: (localMode.isLocalMode ? Color.orange : Color.blue).opacity(0.3), radius: 12, x: 0, y: 6)
                                    )
                                }
                                .buttonStyle(.plain)
                                .scaleEffect(isLoading ? 0.95 : 1.0)
                                .opacity(isLoading ? 0.7 : 1.0)
                                .disabled(isLoading || isLoadingOptions || !isSelectionValid)
                                .animation(.easeInOut(duration: 0.1), value: isLoading)
                                .frame(height: rowH)
                            }
                        }
                        
                        // Modifiers
                        if !modifierGroups.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Customizations")
                                    .font(.system(size: isPad ? 20 : 18, weight: .semibold))
                                    .foregroundColor(DT.ink)
                                ForEach(modifierGroups) { g in
                                    let selectedCount = selection[g.group.id]?.count ?? 0
                                    let maxSel = g.group.max_select ?? Int.max
                                    let isSingle = maxSel == 1 || (g.group.required ?? false) && (g.group.max_select ?? 1) == 1
                                    VStack(alignment: .leading, spacing: 8) {
                                        // Header row
                                        HStack(spacing: 8) {
                                            HStack(spacing: 6) {
                                                Text(g.group.name)
                                                    .font(.system(size: isPad ? 17 : 15, weight: .semibold))
                                                    .foregroundColor(DT.ink)
                                                if let arabicName = g.group.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines),
                                                   !arabicName.isEmpty {
                                                    Text(arabicName)
                                                        .font(.system(size: isPad ? 15 : 13, weight: .medium))
                                                        .foregroundColor(DT.ink.opacity(0.7))
                                                }
                                            }
                                            if g.group.required == true {
                                                Text("Required")
                                                    .font(.system(size: 11, weight: .semibold))
                                                    .foregroundColor(DT.acc)
                                                    .padding(.horizontal, 6)
                                                    .padding(.vertical, 3)
                                                    .background(Capsule().fill(DT.acc.opacity(0.12)))
                                            }
                                            Spacer()
                                            if selectedCount > 0 {
                                                Text("Selected: \(selectedCount)")
                                                    .font(.system(size: 11))
                                                    .foregroundColor(.secondary)
                                            }
                                            if selectedCount > 0 {
                                                Button("Clear") {
                                                    selection[g.group.id] = []
                                                }
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundColor(DT.acc)
                                                .buttonStyle(.plain)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(Capsule().fill(DT.acc.opacity(0.1)))
                                            }
                                        }
                                        
                                        // Options (professional row style)
                                        #if os(iOS)
                                        let isPad = UIDevice.current.userInterfaceIdiom == .pad
                                        #else
                                        let isPad = false
                                        #endif
                                        let useTwoCols = isExternalContext || isPad
                                        let optCols: [GridItem] = useTwoCols
                                            ? [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
                                            : [GridItem(.flexible(), spacing: 8)]
                                        LazyVGrid(columns: optCols, spacing: 8) {
                                            ForEach(g.options) { opt in
                                                let isOn = selection[g.group.id, default: []].contains(opt.id)
                                                Button(action: { toggleOption(opt, in: g) }) {
                                                    HStack(spacing: 10) {
                                                        Image(systemName: isSingle ? (isOn ? "largecircle.fill.circle" : "circle") : (isOn ? "checkmark.square.fill" : "square"))
                                                            .font(.system(size: isPad ? 16 : 15, weight: .semibold))
                                                            .foregroundColor(isOn ? DT.acc : .secondary)
                                                        VStack(alignment: .leading, spacing: 2) {
                                                            HStack(spacing: 4) {
                                                                Text(opt.name)
                                                                    .font(.system(size: isPad ? 15 : 13, weight: isOn ? .semibold : .regular))
                                                                    .foregroundColor(DT.ink)
                                                                if let arabicName = opt.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines),
                                                                   !arabicName.isEmpty {
                                                                    Text(arabicName)
                                                                        .font(.system(size: isPad ? 13 : 11, weight: isOn ? .medium : .regular))
                                                                        .foregroundColor(DT.ink.opacity(0.7))
                                                                }
                                                            }
                                                            .lineLimit(1)
                                                            .truncationMode(.tail)
                                                        }
                                                        Spacer()
                                                        if let price = opt.price, price != 0 {
                                                            Text(String(format: "+%.3f KWD", price))
                                                                .font(.system(size: isPad ? 12 : 10, weight: .semibold))
                                                                .foregroundColor(DT.acc)
                                                                .monospacedDigit()
                                                                .lineLimit(1)
                                                                .truncationMode(.tail)
                                                        }
                                                    }
                                                    .padding(.horizontal, 12)
                                                    .padding(.vertical, 10)
                                                    .background(
                                                        RoundedRectangle(cornerRadius: 10)
                                                            .fill(isOn ? DT.acc.opacity(0.08) : Color.gray.opacity(0.06))
                                                    )
                                                    .overlay(
                                                        RoundedRectangle(cornerRadius: 10)
                                                            .stroke(isOn ? DT.acc : Color.gray.opacity(0.25), lineWidth: 1)
                                                    )
                                                }
                                                .buttonStyle(.plain)
                                                .allowsHitTesting(!isExternalContext)
                                            }
                                        }
                                        
                                        // Guidance (removed info icon)
                                        HStack(spacing: 6) {
                                            if let minSel = minRequired(g) {
                                                if maxSel == Int.max {
                                                    Text("Select at least \\(minSel)")
                                                        .font(.footnote)
                                                        .foregroundColor(.secondary)
                                                } else {
                                                    Text("Select \\(minSel) to \\(maxSel)")
                                                        .font(.footnote)
                                                        .foregroundColor(.secondary)
                                                }
                                            } else if maxSel != Int.max {
                                                Text("Select up to \\(maxSel)")
                                                    .font(.footnote)
                                                    .foregroundColor(.secondary)
                                            }
                                            Spacer()
                                        }
                                    }
                                    .padding(12)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.15), lineWidth: 1))
                                }
                            }
                            .padding(.top, 6)
                        }
                        
                        // Quantity selector and Actions moved to top (after product info)
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                    .padding(.bottom, 40)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .shadow(color: Color.black.opacity(0.2), radius: 20, x: 0, y: 10)
            .onAppear {
                // Initialize from shared store so external display mirrors immediately
                quantity = max(1, store.optionsQty)
                // Fetch modifiers lazily
                Task { await loadModifiersIfNeeded() }
            }
            .onChange(of: quantity) { q in
                // Mirror local changes to shared store
                store.optionsQty = max(1, q)
            }
            .onReceive(store.$optionsQty) { q in
                // Reflect external changes locally (avoid loops by checking inequality)
                if q != quantity {
                    quantity = max(1, q)
                }
            }
            .onChange(of: selection) { newSel in
                // Mirror modifiers selection
                store.optionsSelection = newSel
            }
            .onReceive(store.$optionsSelection) { incoming in
                if !equalSelection(incoming, selection) {
                    // Adopt external selection
                    selection = incoming
                }
            }
    }
    
    private func addToCart() {
        isLoading = true
        let mods = buildModifiersPayload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            onAddToCart(product, quantity, mods)
            isLoading = false
        }
    }
    
    private func initSelection() {
        var map: [String: Set<String>] = [:]
        for g in modifierGroups { map[g.group.id] = [] }
        selection = map
    }
    
    private func toggleOption(_ opt: DisplayModifierGroup.Option, in g: DisplayModifierGroup) {
        var set = selection[g.group.id] ?? []
        let maxSel = g.group.max_select ?? ((g.group.required ?? false) ? 1 : Int.max)
        if set.contains(opt.id) {
            set.remove(opt.id)
        } else {
            if maxSel == 1 { set.removeAll() }
            if set.count < maxSel { set.insert(opt.id) }
        }
        selection[g.group.id] = set
    }
    
    private func minRequired(_ g: DisplayModifierGroup) -> Int? {
        if let n = g.group.min_select { return n }
        if g.group.required ?? false { return 1 }
        return nil
    }
    
    private var isSelectionValid: Bool {
        for g in modifierGroups {
            let selCount = selection[g.group.id]?.count ?? 0
            let minSel = g.group.min_select ?? ((g.group.required ?? false) ? 1 : 0)
            let maxSel = g.group.max_select ?? Int.max
            if selCount < minSel { return false }
            if selCount > maxSel { return false }
        }
        return true
    }
    
    private func buildModifiersPayload() -> [String: Any] {
        var list: [[String: Any]] = []
        for g in modifierGroups {
            let set = selection[g.group.id] ?? []
            for o in g.options where set.contains(o.id) {
                var item: [String: Any] = ["id": o.id, "name": o.name]
                if let p = o.price { item["price"] = p }
                item["group_id"] = g.group.id
                item["group_name"] = g.group.name
                list.append(item)
            }
        }
        return ["options": list]
    }
    
    private func equalSelection(_ a: [String: Set<String>], _ b: [String: Set<String>]) -> Bool {
        if a.count != b.count { return false }
        for (k, va) in a {
            guard let vb = b[k] else { return false }
            if va != vb { return false }
        }
        return true
    }
    
    private func loadModifiersIfNeeded() async {
        if !modifierGroups.isEmpty { return }
        isLoadingOptions = true
        defer { isLoadingOptions = false }
        // Prefer embedded modifiers from catalog (Foodics include=modifiers)
        if let embedded = product.modifiers, !embedded.isEmpty {
            print("[ProductDetailPopup] Found embedded modifiers for \(product.name): groups=\(embedded.count)")
            // Map groups and preselect default options if provided by pivot
            let mapped: [DisplayModifierGroup] = embedded.map { g in
                let grp = DisplayModifierGroup.Group(
                    id: g.id,
                    name: g.name,
                    name_localized: g.name_localized,
                    required: g.required,
                    min_select: g.min,
                    max_select: g.max
                )
                let opts: [DisplayModifierGroup.Option] = g.options.map { o in
                    DisplayModifierGroup.Option(id: o.id, name: o.name, name_localized: o.name_localized, price: o.price)
                }
                print("[ProductDetailPopup] → group=\(g.name) opts=\(opts.count) req=\(g.required) min=\(g.min) max=\(g.max)")
                return DisplayModifierGroup(group: grp, options: opts)
            }
            await MainActor.run {
                self.modifierGroups = mapped
                // Initialize selection with defaults from pivot
                var initSel: [String: Set<String>] = [:]
                for (idx, g) in embedded.enumerated() {
                    let defaults = Set(g.default_option_ids ?? [])
                    initSel[mapped[idx].group.id] = defaults
                }
                self.selection = initSel
            }
            return
        }
        // Fallback to server API if no embedded modifiers present
        do {
            let groups: [DisplayModifierGroup] = try await HttpClient(env: env).fetchModifiers(for: product.id)
            print("[ProductDetailPopup] Loaded server modifiers for \(product.name): groups=\(groups.count)")
            await MainActor.run {
                self.modifierGroups = groups
                self.initSelection()
            }
        } catch {
            print("[ProductDetailPopup] Failed to fetch modifiers: \(error)")
        }
    }
}

// MARK: - SwipeableRow (left=edit, right=delete, full swipe left = delete)
private struct SwipeableRow<Content: View>: View {
    @State private var offsetX: CGFloat = 0
    @State private var openSide: Side = .none
    @State private var isDeletionInProgress: Bool = false
    let onEdit: () -> Void
    let onDelete: () -> Void
    let editColor: Color
    let deleteColor: Color
    let maxReveal: CGFloat = 70
    let threshold: CGFloat = 45
    let fullSwipeThreshold: CGFloat = 120 // Full swipe threshold for immediate delete
    let content: () -> Content
    enum Side { case none, left, right }
    #if canImport(UIKit)
    private let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
    private let deleteFeedback = UINotificationFeedbackGenerator()
    #endif

    init(onEdit: @escaping () -> Void, onDelete: @escaping () -> Void, editColor: Color = .blue, deleteColor: Color = .red, @ViewBuilder content: @escaping () -> Content) {
        self.onEdit = onEdit
        self.onDelete = onDelete
        self.editColor = editColor
        self.deleteColor = deleteColor
        self.content = content
    }

    var body: some View {
        ZStack {
            // Background actions
            HStack {
                // Left (reveal on swipe right) - Edit
                HStack {
                    Image(systemName: "square.and.pencil")
                        .foregroundColor(.white)
                        .font(.system(size: 16, weight: .medium))
                }
                .frame(width: maxReveal)
                .frame(maxHeight: .infinity)
                .background(editColor)
                
                Spacer(minLength: 0)
                
                // Right (reveal on swipe left) - Delete
                HStack {
                    Image(systemName: "trash")
                        .foregroundColor(.white)
                        .font(.system(size: 16, weight: .medium))
                }
                .frame(width: max(maxReveal, abs(offsetX)), alignment: .trailing)
                .frame(maxHeight: .infinity)
                .background(deleteColor)
                .clipped()
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Foreground content with deletion animation
            content()
                .padding(.vertical, 4)
                .padding(.horizontal, 6)
                .background(Color.white)
                .scaleEffect(isDeletionInProgress ? 0.95 : 1.0)
                .opacity(isDeletionInProgress ? 0.8 : 1.0)
                .offset(x: offsetX)
                .gesture(drag)
                .animation(.spring(response: 0.35, dampingFraction: 0.8, blendDuration: 0.1), value: offsetX)
                .animation(.easeInOut(duration: 0.2), value: isDeletionInProgress)
                // Tappable action areas when revealed
                .overlay(alignment: .leading) {
                    if openSide == .left {
                        Button(action: {
                            #if canImport(UIKit)
                            impactFeedback.impactOccurred()
                            #endif
                            onEdit(); close()
                        }) {
                            Color.clear.frame(width: maxReveal, height: 1)
                        }
                        .frame(maxHeight: .infinity)
                    }
                }
                .overlay(alignment: .trailing) {
                    if openSide == .right {
                        Button(action: {
                            performDelete()
                        }) {
                            Color.clear.frame(width: maxReveal, height: 1)
                        }
                        .frame(maxHeight: .infinity)
                    }
                }
        }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .local)
            .onChanged { value in
                guard !isDeletionInProgress else { return }
                
                let t = value.translation.width
                let velocity = value.predictedEndTranslation.width - value.translation.width
                
                if openSide == .none {
                    // Allow extended swipe for full delete
                    let maxOffset = abs(t) > fullSwipeThreshold ? -200 : maxReveal
                    offsetX = clamp(t, -maxOffset, maxReveal)
                    
                    // Provide haptic feedback when crossing full swipe threshold
                    if abs(t) > fullSwipeThreshold && abs(offsetX) <= fullSwipeThreshold {
                        #if canImport(UIKit)
                        impactFeedback.impactOccurred()
                        #endif
                    }
                } else if openSide == .left { // left opened (edit), allow close or switch
                    offsetX = clamp(maxReveal + t, -maxReveal, maxReveal)
                } else if openSide == .right { // right opened (delete)
                    let maxOffset = abs(t) > fullSwipeThreshold ? -200 : maxReveal
                    offsetX = clamp(-maxReveal + t, -maxOffset, maxReveal)
                }
            }
            .onEnded { value in
                guard !isDeletionInProgress else { return }
                
                let t = value.translation.width
                let velocity = value.predictedEndTranslation.width - value.translation.width
                
                if openSide == .none {
                    // Check for full swipe delete (swipe left past threshold)
                    if t < -fullSwipeThreshold || (t < -threshold && velocity < -50) {
                        performDelete()
                    } else if t > threshold {
                        open(.left)
                    } else if t < -threshold {
                        open(.right)
                    } else {
                        close()
                    }
                } else if openSide == .left {
                    if t < -threshold { close() } else { open(.left) }
                } else if openSide == .right {
                    // Check for full swipe delete from revealed state
                    if t < -fullSwipeThreshold || (t < -threshold && velocity < -50) {
                        performDelete()
                    } else if t > threshold {
                        close()
                    } else {
                        open(.right)
                    }
                }
            }
    }
    
    private func performDelete() {
        guard !isDeletionInProgress else { return }
        
        isDeletionInProgress = true
        
        #if canImport(UIKit)
        deleteFeedback.notificationOccurred(.success)
        #endif
        
        // Animate off screen then delete
        withAnimation(.easeInOut(duration: 0.3)) {
            offsetX = -400
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            onDelete()
            // Reset state in case the item isn't immediately removed from the list
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isDeletionInProgress = false
                close()
            }
        }
    }

    private func open(_ side: Side) {
        openSide = side
        offsetX = (side == .left) ? maxReveal : (side == .right ? -maxReveal : 0)
    }
    
    private func close() {
        openSide = .none
        offsetX = 0
    }
    
    private func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
        min(max(v, lo), hi)
    }
}

// MARK: - Product tile adapted from Cashier
private struct ProductTile: View {
    @EnvironmentObject var env: EnvironmentStore
    @Environment(\.isExternalContext) private var isExternalContext
    let product: Product
    let width: CGFloat
    var onTap: (() -> Void)? = nil

    private var corner: CGFloat { DT.radius }
    private var innerPad: CGFloat { 10 }
    private var textBlockH: CGFloat { 60 }

    var body: some View {
        let imageSide = (width - innerPad * 2) * 0.88
        ZStack {
            RoundedRectangle(cornerRadius: corner)
                .fill(DT.surface)
                .overlay(RoundedRectangle(cornerRadius: corner).stroke(DT.line, lineWidth: 1))
            VStack(spacing: 6) {
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: corner)
                    .frame(width: imageSide, height: imageSide)
                VStack(spacing: 2) {
                    let ar = (product.name_localized?["ar"] ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                    let en = product.name
                    if ar.isEmpty {
                        let arSize: CGFloat = isExternalContext ? 12 : 13
                        Text(en)
                            .font(.system(size: arSize, weight: .semibold))
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.clear)
                            .frame(width: imageSide)
                    } else {
                        let arSize: CGFloat = isExternalContext ? 12 : 13
                        Text(ar)
                            .font(.system(size: arSize, weight: .semibold))
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                            .foregroundColor(DT.ink)
                            .frame(width: imageSide)
                    }
                    let enSize: CGFloat = isExternalContext ? 10 : 11
                    Text(en)
                        .font(.system(size: enSize, weight: .regular))
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                        .foregroundColor(DT.ink)
                        .frame(width: imageSide)
                    let priceSize: CGFloat = isExternalContext ? 11 : 12
                    Text(String(format: "%.3f KWD", product.price))
                        .font(.system(size: priceSize, weight: .semibold))
                        .foregroundColor(DT.acc)
                        .frame(width: imageSide)
                }
                .frame(height: textBlockH)
            }
            .padding(innerPad)
        }
        .frame(width: width, height: imageSide + 8 + textBlockH + innerPad * 2)
        .shadow(color: .black.opacity(0.04), radius: 3, x: 0, y: 1)
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
    }

    private func absoluteURL(_ raw: String?) -> URL? {
        guard let raw = raw, !raw.isEmpty else { return nil }
        if let u = URL(string: raw), u.scheme != nil { return u }
        if raw.hasPrefix("/") {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false)
            comps?.path = raw
            return comps?.url
        }
        return env.baseURL.appendingPathComponent(raw)
    }
}

// MARK: - LocalCameraView (Device Camera)
private struct LocalCameraView: View {
    @State private var isActive = false
    
    var body: some View {
        ZStack {
            // Background
            Color.black
            
            VStack(spacing: 8) {
                Image(systemName: isActive ? "video.fill" : "video")
                    .font(.system(size: 32))
                    .foregroundColor(isActive ? .white : .gray)
                
                Text(isActive ? "Local Camera" : "Camera Ready")
                    .font(.caption)
                    .foregroundColor(isActive ? .white : .gray)
                
                if isActive {
                    // Simulated "live" indicator
                    HStack {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 6, height: 6)
                        Text("LIVE")
                            .font(.system(.caption2, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
            }
            .onAppear {
                // Simulate camera activation
                withAnimation(.easeInOut(duration: 0.5).delay(0.5)) {
                    isActive = true
                }
            }
            .onDisappear {
                isActive = false
            }
        }
        .background(
            // Subtle animated background for "video" effect when active
            Group {
                if isActive {
                    LinearGradient(
                        colors: [Color.blue.opacity(0.2), Color.blue.opacity(0.1), Color.blue.opacity(0.15)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: isActive)
                } else {
                    Color.black
                }
            }
        )
    }
}

// MARK: - Helper Shapes
private struct PreviewCardView: View {
    let preview: PreviewState
    var body: some View {
        HStack(spacing: 16) {
            AsyncImage(url: URL(string: preview.imageURL ?? "")) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                case .success(let img):
                    img.resizable().scaledToFill()
                case .failure:
                    Color.gray.opacity(0.2)
                @unknown default:
                    Color.gray.opacity(0.2)
                }
            }
            .frame(width: 200, height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 8) {
                Text(preview.name).font(.title3)
                if !preview.options.isEmpty {
                    Text(preview.options.joined(separator: ", "))
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Text(currency(preview.price)).font(.title2).bold().monospacedDigit()
                Spacer()
            }
            Spacer()
        }
        .padding()
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: Color.black.opacity(0.1), radius: 6, x: 0, y: 3)
    }
}

private struct PosterView: View {
    let poster: PosterState
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white)
            HStack(spacing: 16) {
                if let urlStr = poster.imageURL, let url = URL(string: urlStr) {
                    AsyncImage(url: url) { img in img.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(width: 200, height: 200)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                VStack(alignment: .leading, spacing: 8) {
                    if !poster.title.isEmpty { Text(poster.title).font(.title2).bold() }
                    if !poster.message.isEmpty { Text(poster.message).font(.title3) }
                    Spacer()
                }
                Spacer()
            }
            .padding()
        }
        .shadow(color: Color.black.opacity(0.1), radius: 6, x: 0, y: 3)
    }
}

private func currency(_ v: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.maximumFractionDigits = 2
    return f.string(from: NSNumber(value: v)) ?? String(format: "%.2f", v)
}

// Resolve possible variants of a basket line id back to a catalog product id
private func alternateIds(from id: String) -> [String] {
    var set = Set<String>()
    set.insert(id)
    let comps1 = id.split(separator: ":").map(String.init)
    if let last = comps1.last { set.insert(last) }
    let comps2 = id.split(separator: "#").map(String.init)
    if let last = comps2.last { set.insert(last) }
    let comps3 = id.split(separator: "-").map(String.init)
    if let last = comps3.last { set.insert(last) }
    let digits = id.filter { $0.isNumber }
    if !digits.isEmpty { set.insert(digits) }
    return Array(set)
}

// MARK: - Product Detail Sheet
private struct ProductDetailSheetView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var store: DisplaySessionStore
    @EnvironmentObject var localMode: LocalModeManager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isExternalContext) private var isExternalContext

    let product: Product
    // Optional editing context when opened from an existing basket line
    var lineId: String? = nil
    var initialQty: Int? = nil
    var line: BasketLineUI? = nil

    @State private var qty: Int = 1
    // Modifiers selection state (groupId -> Set<optionId>)
    @State private var selection: [String: Set<String>] = [:]

    var body: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        VStack(spacing: 12) {
            content
            Spacer(minLength: 0)
            actions
        }
        .padding(20)
        .frame(maxWidth: isPad ? 620 : 520)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(alignment: .topTrailing) {
            Button(action: {
                // If this sheet was opened due to remote "showOptions", mirror close to peers
                store.pendingEditSku = nil
                if store.selectedProductId != nil { store.sendOptionsClose() }
                dismiss()
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .padding(8)
                    .background(Circle().fill(Color.gray.opacity(0.15)))
            }
            .buttonStyle(.plain)
            .padding(6)
        }
        .onAppear {
            if let q = initialQty, q > 0 { qty = q } else if let l = line { qty = max(1, l.qty) }
        }
    }


    private var content: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let imageSide: CGFloat = isPad ? 420 : 320
        return ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                // Photo on top, centered
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: 12, animated: true, overscan: 1.02)
                    .frame(width: imageSide, height: imageSide)
                    .frame(maxWidth: .infinity)

                // Name, options, and price — prefer basket line details when editing
                VStack(alignment: .leading, spacing: 4) {
                    if let l = line {
                        Text(l.name)
                            .font(.system(size: isPad ? 22 : 17, weight: .bold))
                            .foregroundColor(DT.ink)
                        if !l.options.isEmpty {
                            Text(l.options.joined(separator: ", "))
                                .font(.system(size: isPad ? 14 : 12))
                                .foregroundColor(.secondary)
                        }
                        Text(String(format: "%.3f KWD", l.unitPrice))
                            .font(.system(size: isPad ? 18 : 15, weight: .semibold))
                            .foregroundColor(DT.acc)
                    } else {
                        let ar = (product.name_localized?["ar"] ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                        if !ar.isEmpty {
                            Text(ar)
                                .font(.system(size: isPad ? 20 : 16, weight: .bold))
                                .foregroundColor(DT.ink)
                        }
                        Text(product.name)
                            .font(.system(size: isPad ? 22 : 17, weight: .bold))
                            .foregroundColor(DT.ink)
                        Text(String(format: "%.3f KWD", product.price + totalDelta))
                            .font(.system(size: isPad ? 18 : 15, weight: .semibold))
                            .foregroundColor(DT.acc)
                    }
                }
                
                // Modifiers (if any)
                if let groups = product.modifiers, !groups.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(groups, id: \.id) { g in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(g.name)
                                        .font(.system(size: 14, weight: .semibold))
                                    Spacer()
                                    if g.min > 0 {
                                        Text("min \(g.min)")
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                    if g.max > 0 && g.max < 99 {
                                        Text("max \(g.max)")
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                // Options as chips
                                let opts = g.options
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], alignment: .leading, spacing: 8) {
                                    ForEach(opts, id: \.id) { opt in
                                        let isOn = selection[g.id, default: []].contains(opt.id)
                                        Button(action: { toggleOption(optId: opt.id, inGroup: g) }) {
                                            HStack(spacing: 6) {
                                                Text(opt.name)
                                                    .font(.system(size: 13, weight: isOn ? .semibold : .regular))
                                                if opt.price != 0 {
                                                    Text(String(format: "+%.3f", opt.price))
                                                        .font(.system(size: 12, weight: .semibold))
                                                        .foregroundColor(DT.acc)
                                                }
                                            }
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 8)
                                            .frame(minWidth: 96)
                                            .background(isOn ? DT.acc.opacity(0.12) : DT.surface)
                                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(isOn ? DT.acc : DT.line, lineWidth: 1))
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                    }
                    .onAppear { initSelectionIfNeeded() }
                }
                
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 12)
            .padding(.bottom, 4)
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            HStack {
                if isExternalContext {
                    Text("Quantity: x\(qty)")
                        .frame(maxWidth: 260, alignment: .leading)
                } else {
                    Stepper(value: $qty, in: 1...200) {
                        Text("Quantity: \(qty)")
                    }
                    .frame(maxWidth: 260)
                }
                Spacer()
            }
            // Single add-style control. If an edit was initiated, set exact qty on that line; else add.
            Button {
                if let sku = store.pendingEditSku, !sku.isEmpty {
                    if localMode.isLocalMode {
                        localMode.setLocalLineQty(lineId: sku, qty: qty)
                    } else {
                        store.setLineQty(sku: sku, qty: qty)
                    }
                    store.pendingEditSku = nil
                } else {
                    if localMode.isLocalMode {
                        localMode.addToLocalBasket(product: product, qty: qty)
                    } else {
                        store.addToBasket(product: product, qty: qty, modifiers: selectedModifiersPayload())
                    }
                }
                if store.selectedProductId != nil { store.sendOptionsClose() }
                dismiss()
            } label: {
                    HStack {
                        Image(systemName: "cart.fill")
                        Text(String(format: "Add • %.3f KWD", product.price + totalDelta))
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(DT.acc))
                    .foregroundColor(.white)
                }
                .buttonStyle(.plain)
            }
        }
    
    private var totalDelta: Double {
        guard let groups = product.modifiers else { return 0 }
        var sum: Double = 0
        for g in groups {
            let set = selection[g.id] ?? []
            for o in g.options where set.contains(o.id) { sum += o.price }
        }
        return sum
    }

    private func selectedModifiersPayload() -> [[String: Any]]? {
        guard let groups = product.modifiers else { return nil }
        var list: [[String: Any]] = []
        for g in groups {
            let set = selection[g.id] ?? []
            for o in g.options where set.contains(o.id) {
                list.append(["name": g.name, "value": o.name])
            }
        }
        return list.isEmpty ? nil : list
    }

    private func initSelectionIfNeeded() {
        guard selection.isEmpty, let groups = product.modifiers else { return }
        var initSel: [String: Set<String>] = [:]
        for g in groups { initSel[g.id] = [] }
        selection = initSel
    }

    private func toggleOption(optId: String, inGroup g: Product.ModifierGroup) {
        var set = selection[g.id, default: []]
        let maxSel = g.max > 0 ? g.max : Int.max
        if set.contains(optId) {
            set.remove(optId)
        } else {
            if maxSel == 1 { set.removeAll() }
            if set.count < maxSel { set.insert(optId) }
        }
        selection[g.id] = set
    }

    private func absoluteURL(_ raw: String?) -> URL? {
        guard let raw = raw, !raw.isEmpty else { return nil }
        if let u = URL(string: raw), u.scheme != nil { return u }
        if raw.hasPrefix("/") {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false)
            comps?.path = raw
            return comps?.url
        }
        return env.baseURL.appendingPathComponent(raw)
    }
}

#if canImport(AVFoundation)
import AVFoundation
@MainActor
final class PreconnectCameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private var videoInput: AVCaptureDeviceInput?
    private let queue = DispatchQueue(label: "PreconnectCameraController.queue")

    func start() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if self.session.isRunning { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .vga640x480
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) ??
                                AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .unspecified) else {
                self.session.commitConfiguration(); return
            }
            do {
                let input = try AVCaptureDeviceInput(device: device)
                if self.session.canAddInput(input) { self.session.addInput(input); self.videoInput = input }
            } catch {
                self.session.commitConfiguration(); return
            }
            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if !self.session.isRunning { return }
            self.session.stopRunning()
        }
    }
}

// MARK: - Brand Loader
extension DisplayHomeView {
    struct BrandResponse: Decodable { let color_primary: String? }
    func loadBrand() async {
        do {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            comps.path = "/brand"
            guard let url = comps.url else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue("application/json", forHTTPHeaderField: "accept")
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return }
            if let br = try? JSONDecoder().decode(BrandResponse.self, from: data), let hex = br.color_primary, let c = color(fromHexString: hex) {
                brandPrimaryColor = c
            }
        } catch { /* ignore */ }
    }
    func color(fromHexString s: String?) -> Color? {
        guard var raw = s?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.hasPrefix("#") { raw.removeFirst() }
        if raw.count == 3 { raw = raw.map { "\($0)\($0)" }.joined() }
        guard raw.count == 6, let val = UInt(raw, radix: 16) else { return nil }
        return Color(hex: val)
    }
}

struct PreconnectLocalPreview: UIViewRepresentable {
    @ObservedObject var controller: PreconnectCameraController
    func makeUIView(context: Context) -> PrePreviewView {
        let v = PrePreviewView(); v.videoPreviewLayer.session = controller.session; v.videoPreviewLayer.videoGravity = .resizeAspectFill; return v
    }
    func updateUIView(_ uiView: PrePreviewView, context: Context) { uiView.videoPreviewLayer.session = controller.session }
}

final class PrePreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
#endif

// MARK: - Helper Shapes
struct AsymmetricRoundedRect: Shape {
    var topLeft: CGFloat
    var topRight: CGFloat
    var bottomLeft: CGFloat
    var bottomRight: CGFloat
    func path(in rect: CGRect) -> Path {
        let tl = min(topLeft, min(rect.width, rect.height) / 2)
        let tr = min(topRight, min(rect.width, rect.height) / 2)
        let bl = min(bottomLeft, min(rect.width, rect.height) / 2)
        let br = min(bottomRight, min(rect.width, rect.height) / 2)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
        p.addArc(center: CGPoint(x: rect.maxX - tr, y: rect.minY + tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
        p.addArc(center: CGPoint(x: rect.maxX - br, y: rect.maxY - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
        p.addArc(center: CGPoint(x: rect.minX + bl, y: rect.maxY - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
        p.addArc(center: CGPoint(x: rect.minX + tl, y: rect.minY + tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}
