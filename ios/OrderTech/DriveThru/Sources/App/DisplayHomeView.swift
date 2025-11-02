import SwiftUI
import OrderTechCore
import UIKit
import AVFoundation
import AVKit
import OrderTechCore
import Foundation

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
    
    // Track previous local mode state to detect transitions
    @State private var wasInLocalMode: Bool = false
    
    // Display picker state
    @State private var showDisplayPicker: Bool = false
    
    // Idle detection
    @State private var lastInteractionTime: Date = Date()
    @State private var idleTimer: Timer?
    @AppStorage("OT.display.idlePosterEnabled") private var idlePosterEnabled: Bool = false
    @AppStorage("OT.display.idleTimeout") private var idleTimeout: Double = 15.0
    @AppStorage("OT.display.posterFlipInterval") private var posterFlipInterval: Double = 15.0

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
                            if idlePosterEnabled {
                                print("[DisplayHomeView] Bottom-left double-tap detected - showing poster overlay")
                                store.showIdlePoster = true
                            } else {
                                print("[DisplayHomeView] Bottom-left double-tap detected - poster is disabled in settings")
                            }
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
        // Bill area takes remaining width after camera
        let actualBillW = contentW - aspectWidth - hGap
        
        HStack(spacing: hGap) {
            // Camera box with correct aspect ratio
            CameraBoxView(peersConnected: store.peersConnected, showDisplayPicker: $showDisplayPicker)
                .frame(width: aspectWidth, height: topH)
            
            BillBoxView(
                lines: localMode.isLocalMode ? localMode.localBasketLines : store.basketLines,
                totals: localMode.isLocalMode ? localMode.localBasketTotals : store.basketTotals,
                textScale: isPad ? (orientation.isLandscape ? 0.9 : 1.0) : (orientation.isLandscape ? 0.55 : 0.6),
                onTapTotal: {
                    // Go directly to checkout, skip basket sheet
                    if localMode.isLocalMode {
                        localMode.startCheckout()
                    } else {
                        localMode.startRemoteCheckout(from: store)
                    }
                },
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
                .frame(width: actualBillW, height: topH)
        }
        .padding(.horizontal, innerPad)
        .frame(width: contentW, height: topH)
    }

    var body: some View {
        contentWithGestures
    }
    
    private var contentWithGestures: some View {
        baseContent
            .task(priority: .userInitiated, taskActions)
    }
    
    private var baseContent: some View {
        contentWithReceivers
        .overlay {
            // Checkout overlay - shared across all displays
            if store.showCheckoutOverlay || localMode.showCheckoutOverlay {
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
            // Full-screen idle poster overlay with product grid
            if store.showIdlePoster {
                IdlePosterOverlay(onDismiss: {
                    store.showIdlePoster = false
                    resetIdleTimer()
                })
                .environmentObject(env)
                .environmentObject(catalog)
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
                            // Send close event to remote display (D2D or Cashier)
                            store.sendOptionsClose()
                            // Reset shared quantity on backdrop tap close
                            store.optionsQty = 1
                            // Reset shared modifiers selection on backdrop close
                            store.optionsSelection = [:]
                        }
                    }
                    .overlay(alignment: .bottom) {
                        let isPad = UIDevice.current.userInterfaceIdiom == .pad
                        let maxPopupWidth: CGFloat = isPad ? 900 : UIScreen.main.bounds.width - 32
                        let maxPopupHeight: CGFloat = UIScreen.main.bounds.height * 0.85
                        
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
                                    // Send close event to remote display (D2D or Cashier)
                                    store.sendOptionsClose()
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
                        .frame(maxWidth: maxPopupWidth, maxHeight: maxPopupHeight)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
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
            basketSheetContent
        }
    }
    
    // MARK: - Basket Sheet Content
    @ViewBuilder
    private var basketSheetContent: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let basketLines = localMode.isLocalMode ? localMode.localBasketLines : store.basketLines
        let basketTotals = localMode.isLocalMode ? localMode.localBasketTotals : store.basketTotals
        let hasItems = !basketLines.isEmpty
        let total = basketTotals.total
        let itemCount = basketLines.reduce(0) { $0 + $1.qty }
        
        VStack(spacing: 0) {
            BillBoxView(
                lines: basketLines,
                totals: basketTotals,
                textScale: isPad ? (orientation.isLandscape ? 1.0 : 1.2) : (orientation.isLandscape ? 0.9 : 1.0),
                onTapTotal: nil,
                onTapLine: { line in
                    showBasketSheet = false
                    let candidates = alternateIds(from: line.id)
                    if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
                        store.pendingEditSku = line.id
                        store.sendShowProduct(id: p.id)
                    }
                },
                onEditLine: { line in
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
                        // Always use the lineId directly for removal
                        store.removeFromBasket(sku: line.id)
                    }
                }
            )
            .environmentObject(env)
            .environmentObject(catalog)
            .padding()
            
            if hasItems {
                Divider().padding(.horizontal)
                HStack {
                    LocalCheckoutButton(
                        basketTotal: total,
                        itemCount: itemCount,
                        onTap: {
                            showBasketSheet = false
                            if localMode.isLocalMode {
                                localMode.startCheckout()
                            } else {
                                localMode.startRemoteCheckout(from: store)
                            }
                        }
                    )
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        .presentationDetents(orientation.isLandscape ? [.medium, .fraction(0.6)] : [.medium, .large])
    }
    
    // MARK: - Product Selection Handling
    private func handleProductSelection(product: Product, quantity: Int, modifiers: [String: Any]) {
        resetIdleTimer() // Reset on product selection
        
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
    
    // MARK: - Idle Detection
    
    private func startIdleTimer() {
        stopIdleTimer()
        
        // Don't start timer if poster is disabled in settings
        guard idlePosterEnabled else {
            print("[DisplayHomeView] Idle poster disabled - not starting timer")
            return
        }
        
        lastInteractionTime = Date()
        
        idleTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [self] _ in
            let elapsed = Date().timeIntervalSince(lastInteractionTime)
            
            // Get RTC orchestrator state to check if we're in an active video session
            let hasActiveRTC = (store.rtcOrchestrator?.providerState == .connected)
            
            // Only show poster if in local mode, not connected to cashier, and no active RTC session
            // Also respect remote poster control - don't show if a remote poster:stop was received
            let shouldShowPoster = elapsed >= idleTimeout 
                && !store.showIdlePoster 
                && localMode.isLocalMode 
                && !store.peersConnected
                && !hasActiveRTC
                && store.poster == nil  // Don't auto-show if remote explicitly stopped poster
            
            if shouldShowPoster {
                Task { @MainActor in
                    withAnimation {
                        store.showIdlePoster = true
                    }
                }
            }
        }
    }
    
    private func stopIdleTimer() {
        idleTimer?.invalidate()
        idleTimer = nil
    }
    
    private func resetIdleTimer() {
        lastInteractionTime = Date()
    }
    
    // MARK: - Helper Methods
    private var tapGesture: some Gesture {
        TapGesture()
            .onEnded { _ in
                resetIdleTimer()
            }
    }
    
    private func onAppearActions() {
        startIdleTimer()
    }
    
    private func onDisappearActions() {
        stopIdleTimer()
    }
    
    private var contentWithReceivers: some View {
        contentWithLifecycle
            .onReceive(store.$connected.combineLatest(store.$peersConnected), perform: handleConnectionChange)
            .onReceive(store.$poster, perform: handlePosterChange)
            .onReceive(store.$selectedProductId.removeDuplicates().debounce(for: .milliseconds(100), scheduler: RunLoop.main), perform: handleProductIdChange)
            .onChange(of: catalog.products.map { $0.id }, perform: handleCatalogChange)
            .onReceive(localMode.$isLocalMode, perform: handleLocalModeChange)
            .onChange(of: idlePosterEnabled, perform: handlePosterSettingChange)
            .environmentObject(localMode)
    }
    
    private var contentWithLifecycle: some View {
        geometryContent
            .onAppear(perform: onAppearActions)
            .onDisappear(perform: onDisappearActions)
    }
    
    private var geometryContent: some View {
        GeometryReader { geo in
            mainContent(geo: geo)
                .simultaneousGesture(tapGesture)
        }
    }
    
    @Sendable
    private func taskActions() async {
        await loadBrand()
        await catalog.loadAll(env: env)
        
        // Set up LocalModeManager and DisplaySessionStore integration first
        await MainActor.run {
            localMode.configure(with: env, displaySessionStore: store)
            // Check initial state and activate local mode if needed
            localMode.checkInitialState(connected: store.connected, peersConnected: store.peersConnected)
        }
    }
    
    // MARK: - Event Handlers
    private func handleConnectionChange(_ values: (Bool, Bool)) {
        let (connected, peersConnected) = values
        localMode.updateConnectionStatus(connected: connected, peersConnected: peersConnected)
        
        // Auto-dismiss poster overlay when a remote session starts
        if peersConnected && store.showIdlePoster {
            store.showIdlePoster = false
        }
        
        // Clear local UI state when switching to remote mode
        if peersConnected && localMode.isLocalMode {
            selectedProduct = nil
        }
    }
    
    private func handlePosterChange(_ poster: PosterState?) {
        if let _ = poster {
            if idlePosterEnabled {
                store.showIdlePoster = true
                resetIdleTimer()
            }
        } else {
            store.showIdlePoster = false
            resetIdleTimer()
        }
    }
    
    private func handleProductIdChange(_ pid: String?) {
        if localMode.isLocalMode && store.peersConnected { return }
        
        if let id = pid, !id.isEmpty {
            if let product = catalog.products.first(where: { $0.id == id }) {
                selectedProduct = product
            }
        } else {
            selectedProduct = nil
        }
    }
    
    private func handleCatalogChange(_ ids: [String]) {
        if let id = store.selectedProductId, let product = catalog.products.first(where: { $0.id == id }) {
            selectedProduct = product
        }
    }
    
    private func handleLocalModeChange(_ isLocalMode: Bool) {
        if isLocalMode && !wasInLocalMode {
            selectedProduct = nil
        }
        wasInLocalMode = isLocalMode
    }
    
    private func handlePosterSettingChange(_ enabled: Bool) {
        if !enabled {
            stopIdleTimer()
            store.showIdlePoster = false
        } else {
            startIdleTimer()
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
    @Binding var showDisplayPicker: Bool

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
                .contentShape(Rectangle())
                .onTapGesture {
                    showDisplayPicker = true
                }
        }
        .compositingGroup()
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
        return "Starting video…"
    }

    private var linkStatusSubtitle: String? {
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
            }
        }
    }
    
    private var videoPIPOverlays: some View {
        Group {
            GeometryReader { geo in
                let pipW: CGFloat = 48
                let pipH: CGFloat = pipW * 16.0 / 9.0
                let x = geo.size.width - 8 - pipW / 2
                let y = min(geo.size.height - 8 - pipH / 2, geo.size.height * 5.0 / 6.0)
                
                if localMode.isLocalMode {
                    // Local mode: PIP disabled to avoid camera session conflicts
                    // iOS doesn't allow multiple AVCaptureSession instances simultaneously
                    // The external USB camera uses the main session
                    EmptyView()
                } else {
                    // Remote mode: Show LiveKit local camera in PIP
                }
            }
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

// MARK: - FlashingDot for syncing indicator
private struct FlashingDot: View {
    @State private var isAnimating = false
    
    var body: some View {
        Circle()
            .fill(Color.blue)
            .frame(width: 6, height: 6)
            .opacity(isAnimating ? 0.3 : 1.0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                    isAnimating = true
                }
            }
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
            // Syncing indicator at top right
            if catalog.isLoading {
                HStack {
                    Spacer()
                    HStack(spacing: 4) {
                        FlashingDot()
                        Text("Syncing...")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.blue)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.08))
                    .cornerRadius(8)
                }
                .padding(.top, 6)
                .padding(.trailing, 8)
                .transition(.opacity)
            }
            
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
            if !lines.isEmpty {
                Button(action: { onTapTotal?() }) {
                    HStack {
                        Text("Basket").font(.system(size: 17 * textScale))
                        Spacer()
                        Text(currency(totals.total)).font(.system(size: 17 * textScale, weight: .bold)).monospacedDigit()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(DT.acc.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(DT.acc.opacity(0.3), lineWidth: 1)
                    )
                    .cornerRadius(8)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 12)
            } else {
                // Empty state - just show text without button styling
                HStack {
                    Text("Basket").font(.system(size: 17 * textScale))
                    Spacer()
                    Text(currency(totals.total)).font(.system(size: 17 * textScale, weight: .bold)).monospacedDigit()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
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
    @Environment(\.isExternalContext) private var isExternalContext
    @State private var selectedCategory: String? = nil
    @State private var pageIndex: Int = 1
    
    @Binding var selectedProduct: Product?
    let preview: PreviewState?
    let poster: PosterState?
    
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
                    let categories = catalog.categoriesWithProducts
                    let halfCount = (categories.count + 1) / 2
                    let row1 = Array(categories.prefix(halfCount))
                    let row2 = Array(categories.dropFirst(halfCount))
                    
                    VStack(spacing: 6) {
                        // First row
                        HStack(spacing: 6) {
                            ForEach(row1) { c in
                                categoryButton(c)
                            }
                        }
                        // Second row
                        if !row2.isEmpty {
                            HStack(spacing: 6) {
                                ForEach(row2) { c in
                                    categoryButton(c)
                                }
                            }
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
    
    @ViewBuilder
    private func categoryButton(_ c: Category) -> some View {
        let isSel = (c.name == (selectedCategory ?? c.name))
        let arabicName = c.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        Button(action: { Task { await select(category: c.name) } }) {
            VStack(spacing: 2) {
                if !arabicName.isEmpty {
                    Text(arabicName)
                        .font(.system(size: 14, weight: isSel ? .semibold : .medium))
                        .foregroundColor(isSel ? DT.acc : DT.ink)
                }
                Text(c.name)
                    .font(.system(size: 13, weight: isSel ? .medium : .regular))
                    .foregroundColor(isSel ? DT.acc.opacity(0.8) : DT.ink.opacity(0.7))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(isSel ? DT.acc.opacity(0.12) : DT.surface)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSel ? DT.acc : DT.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .id(c.id)
    }

    private var productsPager: some View {
        GeometryReader { proxy in
            let isPhone = UIDevice.current.userInterfaceIdiom == .phone
            let horizontalPadding = CGFloat(0)
            let availableWidth = proxy.size.width - (horizontalPadding * 2)
            let availableHeight = proxy.size.height
            let spacing: CGFloat = availableWidth < 430 ? DT.space : DT.space2

            let cats = catalog.categoriesWithProducts
            let hasCats = !cats.isEmpty
            let cyc = hasCats ? ([cats.last!] + cats + [cats.first!]) : []
            // If no categories came back, show all products on a single page
            let singlePageAll = !hasCats ? [Category(id: "all", name: "All")] : []

            TabView(selection: $pageIndex) {
                if !singlePageAll.isEmpty {
                    let list = catalog.products(inCategoryName: nil, env: env)
                    let gridConfig = calculateOptimalGrid(
                        availableWidth: availableWidth,
                        availableHeight: availableHeight,
                        spacing: spacing,
                        isLandscape: orientation.isLandscape,
                        productCount: list.count
                    )
                    let columnsCount = gridConfig.columns
                    let colW = gridConfig.columnWidth
                    
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
                                        // Send to remote display (D2D or Cashier)
                                        store.sendShowProduct(id: p.id)
                                        // Immediate local feedback
                                        withAnimation(.easeInOut(duration: 0.3)) { selectedProduct = p }
                                    })
                                        .environmentObject(env)
                                        .id(p.id)
                                }
                            }
                            .padding(.top, 6)
                            .padding(.bottom, 80)
                            .padding(.horizontal, horizontalPadding)
                        }
                    }
                } else {
                    ForEach(Array(cyc.enumerated()), id: \.offset) { pair in
                        let i = pair.offset
                        let c = pair.element
                        let list = catalog.products(inCategoryName: c.name, env: env)
                        let gridConfig = calculateOptimalGrid(
                            availableWidth: availableWidth,
                            availableHeight: availableHeight,
                            spacing: spacing,
                            isLandscape: orientation.isLandscape,
                            productCount: list.count
                        )
                        let columnsCount = gridConfig.columns
                        let colW = gridConfig.columnWidth
                        
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
                                            // Send to remote display (D2D or Cashier)
                                            store.sendShowProduct(id: p.id)
                                            // Immediate local feedback
                                            withAnimation(.easeInOut(duration: 0.3)) { selectedProduct = p }
                                        })
                                            .environmentObject(env)
                                            .id(p.id)
                                    }
                                }
                                .padding(.top, 6)
                                .padding(.bottom, 80)
                                .padding(.horizontal, horizontalPadding)
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

    
    private func calculateOptimalGrid(
        availableWidth: CGFloat,
        availableHeight: CGFloat,
        spacing: CGFloat,
        isLandscape: Bool,
        productCount: Int
    ) -> (columns: Int, columnWidth: CGFloat) {
        // Calculate optimal grid based on available space AND product count for this specific category
        // Target card aspect ratio: card height = image + text + padding
        // From ProductTile: height = imageSide + 8 + textBlockH(60) + innerPad(10) * 2
        // imageSide = (width - 20) * 0.88, so height ≈ width * 0.88 + 88
        let cardAspectRatio: CGFloat = 1.4 // approximate height/width ratio (reduced to fit more)
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone
        
        // iPhone always uses 3 columns, iPad is adaptive
        if isPhone {
            let columnsCount = 3
            let totalSpacing = spacing * CGFloat(columnsCount - 1)
            let colW = floor((availableWidth - totalSpacing) / CGFloat(columnsCount))
            return (columns: columnsCount, columnWidth: colW)
        }
        
        // iPad: Try different column counts and pick the one that best fills the screen for THIS category
        let minCols = isLandscape ? 4 : 3
        // External displays (Drive-Thru screens) limited to 4 columns max for better readability
        let maxCols = isExternalContext ? 4 : 8
        
        var bestCols = minCols
        var bestFit: CGFloat = 0
        
        for cols in minCols...maxCols {
            let totalSpacing = spacing * CGFloat(cols - 1)
            let cardWidth = floor((availableWidth - totalSpacing) / CGFloat(cols))
            let cardHeight = cardWidth * cardAspectRatio
            
            // Calculate how many rows are needed for this category's product count
            let neededRows = ceil(CGFloat(productCount) / CGFloat(cols))
            
            // Calculate how many rows can ACTUALLY fit in the available height
            // Use floor to ensure we don't exceed the screen bounds
            let maxFittableRows = floor(availableHeight / (cardHeight + spacing))
            let possibleRows = max(3, maxFittableRows)
            
            // Score this layout based on:
            // 1. How well it fits the products (prefer layouts that show all products if possible)
            // 2. How well it fills the vertical space without exceeding it
            // 3. Avoid excessive columns for small product counts
            let canShowAllProducts = neededRows <= possibleRows
            
            // Calculate actual used height (never exceed available height)
            let actualRows = min(neededRows, possibleRows)
            let usedHeight = actualRows * (cardHeight + spacing)
            let verticalUtilization = min(1.0, usedHeight / availableHeight)
            let visibleCards = CGFloat(cols) * actualRows
            
            // Penalize excessive columns for small product counts
            let columnEfficiency = min(1.0, CGFloat(productCount) / (CGFloat(cols) * actualRows))
            
            // Composite score: prioritize showing all products, then vertical fill, then efficiency
            var score = visibleCards * verticalUtilization * columnEfficiency
            if canShowAllProducts {
                score *= 1.5 // Bonus for fitting all products without scroll
            }
            
            if score > bestFit {
                bestFit = score
                bestCols = cols
            }
        }
        
        let columnsCount = bestCols
        let totalSpacing = spacing * CGFloat(columnsCount - 1)
        let colW = floor((availableWidth - totalSpacing) / CGFloat(columnsCount))
        
        return (columns: columnsCount, columnWidth: colW)
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
    @State private var optionQuantities: [String: Int] = [:] // option.id -> quantity (for quantifiable modifiers)
    @State private var isLoadingOptions = false
    @State private var expandedGroups: Set<String> = [] // Track which groups are expanded
    
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
                if let d = o.price {
                    let qty = optionQuantities[o.id] ?? 1
                    sum += d * Double(qty)
                }
            }
        }
        return sum
    }
    
    // Check if a modifier option is quantifiable (can have quantity > 1)
    private func isQuantifiableModifier(_ optionName: String) -> Bool {
        let name = optionName.lowercased()
        // Remove any pipes and extra spaces for better detection
        let cleanName = name.replacingOccurrences(of: "|", with: " ").replacingOccurrences(of: "  ", with: " ")
        let isQuantifiable = cleanName.contains("shot") || cleanName.contains("espresso") || 
                            cleanName.contains("matcha") || cleanName.contains("extra")
        #if DEBUG
        print("[ProductDetailPopup] Checking modifier: '\(optionName)' (cleaned: '\(cleanName)') -> quantifiable: \(isQuantifiable)")
        #endif
        return isQuantifiable
    }
    
    var body: some View {
        mainContentView
            .frame(maxWidth: .infinity)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .shadow(color: Color.black.opacity(0.2), radius: 20, x: 0, y: 10)
            .onAppear {
                quantity = 1
                store.optionsQty = 1
                Task { await loadModifiersIfNeeded() }
            }
            .onChange(of: quantity) { q in
                store.optionsQty = max(1, q)
            }
            .onReceive(store.$optionsQty) { q in
                if q != quantity {
                    quantity = max(1, q)
                }
            }
            .onChange(of: selection) { newSel in
                store.optionsSelection = newSel
            }
            .onReceive(store.$optionsSelection) { incoming in
                if !equalSelection(incoming, selection) {
                    selection = incoming
                }
            }
            .onChange(of: expandedGroups) { newExpanded in
                store.optionsExpandedGroups = newExpanded
            }
            .onReceive(store.$optionsExpandedGroups) { incoming in
                if incoming != expandedGroups {
                    expandedGroups = incoming
                }
            }
    }
    
    @ViewBuilder
    private var mainContentView: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let imageSide = computeImageSide(isPad: isPad)
        let useVerticalLayout = !isPad
        
        VStack(spacing: 0) {
            headerView(isPad: isPad)
            
            ScrollView {
                VStack(spacing: modifierGroups.isEmpty ? 16 : 20) {
                    productLayoutView(isPad: isPad, imageSide: imageSide, useVerticalLayout: useVerticalLayout)
                    
                    productDescriptionView(isPad: isPad)
                        .padding(.horizontal, isPad ? 32 : 24)
                    
                    if !modifierGroups.isEmpty {
                        modifiersSection(isPad: isPad)
                            .padding(.top, 6)
                            .padding(.horizontal, isPad ? 32 : 24)
                        
                        // Only add spacer when there are modifiers
                        Spacer(minLength: 40)
                    }
                }
                .padding(.top, modifierGroups.isEmpty ? 16 : 24)
            }
        }
    }
    
    @ViewBuilder
    private func headerView(isPad: Bool) -> some View {
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
    }
    
    @ViewBuilder
    private func productLayoutView(isPad: Bool, imageSide: CGFloat, useVerticalLayout: Bool) -> some View {
        if useVerticalLayout {
            VStack(alignment: .leading, spacing: 20) {
                productImageView(imageSide: imageSide, isPad: isPad)
                    .frame(maxWidth: .infinity)
                productDetailsView(isPad: isPad)
            }
            .padding(.horizontal, 24)
        } else {
            HStack(alignment: .top, spacing: 20) {
                productImageView(imageSide: imageSide, isPad: isPad)
                productDetailsView(isPad: isPad)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 32)
        }
    }
    
    @ViewBuilder
    private func modifiersSection(isPad: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Customizations")
                .font(.system(size: isPad ? 20 : 18, weight: .semibold))
                .foregroundColor(DT.ink)
            ForEach(modifierGroups) { g in
                modifierGroupCard(g, isPad: isPad)
            }
        }
    }
    
    @ViewBuilder
    private func modifierGroupCard(_ g: DisplayModifierGroup, isPad: Bool) -> some View {
        let selectedCount = selection[g.group.id]?.count ?? 0
        let maxSel = g.group.max_select ?? Int.max
        let isSingle = maxSel == 1 || (g.group.required ?? false) && (g.group.max_select ?? 1) == 1
        let isRequired = (g.group.min_select ?? 0) > 0 || g.group.required == true
        let isExpanded = expandedGroups.contains(g.group.id)
        
        VStack(alignment: .leading, spacing: 8) {
            modifierGroupHeader(g, isPad: isPad, selectedCount: selectedCount, isRequired: isRequired, isExpanded: isExpanded)
            
            if isExpanded {
                modifierGroupOptions(g, isPad: isPad, isSingle: isSingle, maxSel: maxSel)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.15), lineWidth: 1))
    }
    
    @ViewBuilder
    private func modifierGroupHeader(_ g: DisplayModifierGroup, isPad: Bool, selectedCount: Int, isRequired: Bool, isExpanded: Bool) -> some View {
        Button(action: { toggleGroup(g.group.id) }) {
            HStack(spacing: 8) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: (isPad || isExternalContext) ? 18 : 12, weight: .semibold))
                    .foregroundColor(isRequired ? .red : DT.ink)
                
                groupIcon(g.group.name, isRequired: isRequired, isPad: isPad)
                
                VStack(alignment: .leading, spacing: 2) {
                    if let arabicName = g.group.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines), !arabicName.isEmpty {
                        Text(arabicName)
                            .font(.system(size: (isPad || isExternalContext) ? 22 : 15, weight: .bold))
                            .foregroundColor(isRequired ? .red : DT.ink)
                    }
                    Text(g.group.name)
                        .font(.system(size: (isPad || isExternalContext) ? 19 : 13, weight: .medium))
                        .foregroundColor(isRequired ? .red.opacity(0.8) : DT.ink.opacity(0.7))
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
        }
        .buttonStyle(.plain)
    }
    
    @ViewBuilder
    private func groupIcon(_ groupName: String, isRequired: Bool, isPad: Bool) -> some View {
        Group {
            let name = groupName.lowercased()
            if name.contains("milk") {
                Image("milk")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: (isPad || isExternalContext) ? 28 : 20, height: (isPad || isExternalContext) ? 28 : 20)
            } else if name.contains("espresso") || name.contains("shot") {
                Image("espresso")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: (isPad || isExternalContext) ? 28 : 20, height: (isPad || isExternalContext) ? 28 : 20)
            } else if name.contains("extra") {
                Image("extra")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: (isPad || isExternalContext) ? 24 : 18, height: (isPad || isExternalContext) ? 24 : 18)
            } else {
                Image(systemName: iconForGroup(groupName))
                    .font(.system(size: (isPad || isExternalContext) ? 22 : 14, weight: .semibold))
                    .foregroundColor(isRequired ? .red : DT.acc)
                    .frame(width: (isPad || isExternalContext) ? 32 : 20)
            }
        }
    }
    
    @ViewBuilder
    private func modifierGroupOptions(_ g: DisplayModifierGroup, isPad: Bool, isSingle: Bool, maxSel: Int) -> some View {
        let useTwoCols = isExternalContext || isPad
        VStack(alignment: .leading, spacing: 12) {
            optionsGrid(g.options, group: g, isSingle: isSingle, useTwoCols: useTwoCols)
            optionGuidance(g, maxSel: maxSel)
        }
    }
    
    @ViewBuilder
    private func optionsGrid(_ options: [DisplayModifierGroup.Option], group: DisplayModifierGroup, isSingle: Bool, useTwoCols: Bool) -> some View {
        let columns: [GridItem] = {
            if useTwoCols {
                // iPad and External display: 2 columns
                return Array(repeating: GridItem(.flexible(), spacing: 8), count: 2)
            } else {
                // iPhone: 1 column
                return [GridItem(.flexible())]
            }
        }()
        
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(options) { opt in
                optionRow(opt, group: group, isSingle: isSingle, useTwoCols: useTwoCols)
            }
        }
    }
    
    @ViewBuilder
    private func optionRow(_ opt: DisplayModifierGroup.Option, group: DisplayModifierGroup, isSingle: Bool, useTwoCols: Bool) -> some View {
        let isOn = selection[group.group.id, default: []].contains(opt.id)
        let isQuantifiable = isQuantifiableModifier(opt.name)
        // Quantifiable modifiers start at 0, regular modifiers at 1
        let qty = optionQuantities[opt.id] ?? (isQuantifiable ? 0 : 1)
        
        if isQuantifiable {
            // Quantifiable modifier: show name on left, +/- counter on right with dynamic price
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    if let arabicName = opt.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines), !arabicName.isEmpty {
                        Text(arabicName)
                            .font(.system(size: useTwoCols ? 18 : 13, weight: isOn ? .bold : .semibold))
                            .foregroundColor(DT.ink)
                            .lineLimit(1)
                    }
                    Text(opt.name)
                        .font(.system(size: useTwoCols ? 16 : 11, weight: isOn ? .medium : .regular))
                        .foregroundColor(DT.ink.opacity(0.7))
                        .lineLimit(1)
                }
                Spacer()
                VStack(spacing: 4) {
                    HStack(spacing: 8) {
                        Button(action: {
                            if qty > 0 {
                                let newQty = qty - 1
                                if newQty == 0 {
                                    optionQuantities[opt.id] = nil
                                    var set = selection[group.group.id] ?? []
                                    set.remove(opt.id)
                                    selection[group.group.id] = set
                                } else {
                                    optionQuantities[opt.id] = newQty
                                }
                            }
                        }) {
                            Image(systemName: "minus")
                                .font(.system(size: useTwoCols ? 14 : 12, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: useTwoCols ? 32 : 28, height: useTwoCols ? 32 : 28)
                                .background(Circle().fill(qty > 0 ? DT.acc : Color.gray))
                        }
                        .disabled(qty == 0 || isExternalContext)
                        .buttonStyle(.plain)
                        
                        Text("\(qty)")
                            .font(.system(size: useTwoCols ? 18 : 16, weight: .bold))
                            .foregroundColor(DT.ink)
                            .frame(minWidth: useTwoCols ? 30 : 24)
                            .monospacedDigit()
                        
                        Button(action: {
                            let newQty = qty + 1
                            optionQuantities[opt.id] = newQty
                            var set = selection[group.group.id] ?? []
                            set.insert(opt.id)
                            selection[group.group.id] = set
                        }) {
                            Image(systemName: "plus")
                                .font(.system(size: useTwoCols ? 14 : 12, weight: .bold))
                                .foregroundColor(.white)
                                .frame(width: useTwoCols ? 32 : 28, height: useTwoCols ? 32 : 28)
                                .background(Circle().fill(DT.acc))
                        }
                        .disabled(isExternalContext)
                        .buttonStyle(.plain)
                    }
                    if let price = opt.price, price != 0, qty > 0 {
                        HStack(spacing: 2) {
                            Text(String(format: "+%.3f", price * Double(qty)))
                                .font(.system(size: useTwoCols ? 14 : 10, weight: .semibold))
                                .foregroundColor(DT.acc)
                                .monospacedDigit()
                            Text("KWD")
                                .font(.system(size: useTwoCols ? 9 : 8, weight: .medium))
                                .foregroundColor(DT.acc.opacity(0.8))
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 10).fill(isOn ? DT.acc.opacity(0.08) : Color.gray.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(isOn ? DT.acc : Color.gray.opacity(0.25), lineWidth: 1))
        } else {
            // Regular modifier: show checkbox
            Button(action: { toggleOption(opt, in: group) }) {
                HStack(spacing: 10) {
                    Image(systemName: isSingle ? (isOn ? "largecircle.fill.circle" : "circle") : (isOn ? "checkmark.square.fill" : "square"))
                        .font(.system(size: useTwoCols ? 20 : 15, weight: .semibold))
                        .foregroundColor(isOn ? DT.acc : .secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        if let arabicName = opt.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines), !arabicName.isEmpty {
                            Text(arabicName)
                                .font(.system(size: useTwoCols ? 18 : 13, weight: isOn ? .bold : .semibold))
                                .foregroundColor(DT.ink)
                                .lineLimit(1)
                        }
                        Text(opt.name)
                            .font(.system(size: useTwoCols ? 16 : 11, weight: isOn ? .medium : .regular))
                            .foregroundColor(DT.ink.opacity(0.7))
                            .lineLimit(1)
                    }
                    Spacer()
                    if let price = opt.price, price != 0 {
                        HStack(spacing: 2) {
                            Text(String(format: "+%.3f", price))
                                .font(.system(size: useTwoCols ? 16 : 10, weight: .semibold))
                                .foregroundColor(DT.acc)
                                .monospacedDigit()
                            Text("KWD")
                                .font(.system(size: useTwoCols ? 10 : 8, weight: .medium))
                                .foregroundColor(DT.acc.opacity(0.8))
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 10).fill(isOn ? DT.acc.opacity(0.08) : Color.gray.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(isOn ? DT.acc : Color.gray.opacity(0.25), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .allowsHitTesting(!isExternalContext)
        }
    }
    
    @ViewBuilder
    private func optionGuidance(_ g: DisplayModifierGroup, maxSel: Int) -> some View {
        HStack(spacing: 6) {
            if let minSel = minRequired(g) {
                if maxSel == Int.max {
                    Text("Select at least \(minSel)")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                } else {
                    Text("Select \(minSel) to \(maxSel)")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
            } else if maxSel != Int.max {
                Text("Select up to \(maxSel)")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
    }
    
    private func addToCart() {
        isLoading = true
        let mods = buildModifiersPayload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            onAddToCart(product, quantity, mods)
            isLoading = false
            // Reset quantity to 1 after adding to cart
            quantity = 1
            store.optionsQty = 1
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
                let qty = optionQuantities[o.id] ?? 1
                var item: [String: Any] = ["id": o.id, "name": o.name, "quantity": qty]
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
    
    private func toggleGroup(_ groupId: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if expandedGroups.contains(groupId) {
                // Collapse the currently open group
                expandedGroups.remove(groupId)
            } else {
                // Collapse all groups and expand only this one (accordion behavior)
                expandedGroups.removeAll()
                expandedGroups.insert(groupId)
            }
            // Sync to store for external display
            store.optionsExpandedGroups = expandedGroups
        }
    }
    
    private func iconForGroup(_ groupName: String) -> String {
        let name = groupName.lowercased()
        
        // Beverages & Drinks
        if name.contains("milk") || name.contains("dairy") || name.contains("cream") {
            return "drop"
        } else if name.contains("coffee") || name.contains("espresso") || name.contains("shot") {
            return "cup.and.saucer"
        } else if name.contains("tea") {
            return "mug"
        } else if name.contains("juice") || name.contains("smoothie") {
            return "drop.triangle"
        } else if name.contains("water") || name.contains("drink") {
            return "drop"
        }
        
        // Sweeteners & Flavors
        else if name.contains("sugar") || name.contains("sweet") || name.contains("syrup") {
            return "cube"
        } else if name.contains("flavor") || name.contains("sauce") {
            return "circle.hexagongrid"
        } else if name.contains("honey") {
            return "drop.triangle"
        }
        
        // Toppings & Add-ons
        else if name.contains("topping") || name.contains("whip") {
            return "sparkles"
        } else if name.contains("ice") || name.contains("cold") {
            return "snowflake"
        } else if name.contains("hot") || name.contains("temp") {
            return "thermometer.medium"
        }
        
        // Food items
        else if name.contains("bread") || name.contains("bun") || name.contains("toast") {
            return "takeoutbag.and.cup.and.straw"
        } else if name.contains("cheese") {
            return "square.stack"
        } else if name.contains("meat") || name.contains("protein") || name.contains("patty") {
            return "circle.grid.cross"
        } else if name.contains("vegetable") || name.contains("veggie") || name.contains("salad") {
            return "leaf"
        } else if name.contains("egg") {
            return "circle"
        }
        
        // Size & Quantity
        else if name.contains("size") {
            return "ruler"
        } else if name.contains("extra") || name.contains("add") {
            return "plus.circle"
        }
        
        // Default icon
        return "circle.grid.2x2"
    }
    
    private func loadModifiersIfNeeded() async {
        if !modifierGroups.isEmpty { return }
        
        // Use embedded modifiers from catalog (already loaded during cold start)
        if let embedded = product.modifiers, !embedded.isEmpty {
            print("[ProductDetailPopup] Using embedded modifiers for \(product.name): groups=\(embedded.count)")
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
        } else {
            // No modifiers for this product - initialize empty selection
            await MainActor.run {
                self.initSelection()
            }
        }
    }
    
    // MARK: - Helper Views
    @ViewBuilder
    private func productImageView(imageSide: CGFloat, isPad: Bool) -> some View {
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
    }
    
    @ViewBuilder
    private func productDescriptionView(isPad: Bool) -> some View {
        let hasArabicDesc = (product.description_localized?["ar"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        let hasEnglishDesc = (product.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        
        if hasArabicDesc || hasEnglishDesc {
            VStack(alignment: .center, spacing: 8) {
                // Localized description (Arabic) on top
                if let descLocalized = product.description_localized?["ar"],
                   !descLocalized.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(descLocalized)
                        .font(.system(size: isPad ? 24 : 18, weight: .regular))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                
                // English description below
                if let desc = product.description,
                   !desc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(desc)
                        .font(.system(size: isPad ? 20 : 16, weight: .regular))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }
    
    @ViewBuilder
    private func productDetailsView(isPad: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // Product names
            VStack(alignment: .leading, spacing: 8) {
                // Arabic name (if available) above English
                let ar = (product.name_localized?["ar"] ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                if !ar.isEmpty {
                    let fontSize: CGFloat = isExternalContext ? 40 : (isPad ? 36 : 28)
                    Text(ar)
                        .font(.system(size: fontSize, weight: .black))
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
                
                HStack(spacing: 3) {
                    Text(String(format: "%.3f", product.price))
                        .font(.system(size: isPad ? 22 : 18, weight: .semibold))
                        .foregroundColor(.blue)
                        .monospacedDigit()
                    Text("KWD")
                        .font(.system(size: isPad ? 14 : 12, weight: .medium))
                        .foregroundColor(.blue.opacity(0.8))
                }
            }
            
            Divider()
            
            // Quantity selector
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
            
            Divider()
            
            // Actions row
            if !isExternalContext {
                let rowH: CGFloat = isPad ? 56 : 48
                HStack(spacing: 12) {
                    // Close button (narrow)
                    Button(action: {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            onDismiss()
                            store.selectedProductId = nil
                            // Send close event to remote display (D2D or Cashier)
                            store.sendOptionsClose()
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
                            HStack(spacing: 2) {
                                Text(String(format: "%.3f", totalPrice))
                                    .font(.system(size: isPad ? 18 : 16, weight: .bold))
                                    .monospacedDigit()
                                Text("KWD")
                                    .font(.system(size: isPad ? 12 : 10, weight: .medium))
                            }
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
    private var innerPad: CGFloat { 2 }
    private var textBlockH: CGFloat { 60 }

    var body: some View {
        let imageSide = (width - innerPad * 2) * 0.96
        let ar = (product.name_localized?["ar"] ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        let en = product.name
        
        ZStack {
            RoundedRectangle(cornerRadius: corner)
                .fill(DT.surface)
                .overlay(RoundedRectangle(cornerRadius: corner).stroke(DT.line, lineWidth: 1))
            
            // Same vertical layout for both local and external displays
            VStack(spacing: 4) {
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: corner)
                    .frame(width: imageSide, height: imageSide)
                VStack(spacing: 1) {
                    if ar.isEmpty {
                        Text(en)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.clear)
                            .frame(width: imageSide)
                    } else {
                        Text(ar)
                            .font(.system(size: 14, weight: .black))
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                            .foregroundColor(DT.ink)
                            .frame(width: imageSide)
                    }
                    Text(en)
                        .font(.system(size: 12, weight: .regular))
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                        .foregroundColor(DT.ink)
                        .frame(width: imageSide)
                    HStack(spacing: 2) {
                        Text(String(format: "%.3f", product.price))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(DT.acc)
                            .monospacedDigit()
                        Text("KWD")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(DT.acc.opacity(0.8))
                    }
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

// MARK: - External USB Camera Controller (Singleton for USB-C cameras)
@MainActor
class ExternalUSBCameraController: ObservableObject {
    static let shared = ExternalUSBCameraController()
    
    let captureSession: AVCaptureSession
    private var videoDeviceInput: AVCaptureDeviceInput?
    @Published var isRunning = false
    private var referenceCount = 0
    
    private init() {
        // Use MultiCamSession if supported for simultaneous cameras
        if #available(iOS 13.0, *), AVCaptureMultiCamSession.isMultiCamSupported {
            print("[ExternalUSBCameraController] Device supports MultiCam, using AVCaptureMultiCamSession")
            captureSession = AVCaptureMultiCamSession()
        } else {
            print("[ExternalUSBCameraController] Device does NOT support MultiCam, using regular AVCaptureSession")
            captureSession = AVCaptureSession()
        }
    }
    
    func retain() {
        Task { @MainActor in
            referenceCount += 1
            print("[ExternalUSBCameraController] Retain called, count: \(referenceCount)")
            if referenceCount == 1 {
                start()
            }
        }
    }
    
    func release() {
        Task { @MainActor in
            referenceCount = max(0, referenceCount - 1)
            print("[ExternalUSBCameraController] Release called, count: \(referenceCount)")
            if referenceCount == 0 {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    if self.referenceCount == 0 {
                        self.stop()
                    }
                }
            }
        }
    }
    
    private func start() {
        guard !isRunning else { return }
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            
            self.captureSession.beginConfiguration()
            
            if self.captureSession.canSetSessionPreset(.high) {
                self.captureSession.sessionPreset = .high
            }
            
            // Look for external USB camera first, then fall back to built-in
            guard let videoDevice = self.findExternalCamera() ?? self.findBuiltInFrontCamera() else {
                print("[ExternalUSBCameraController] No camera available (neither external nor built-in)")
                self.captureSession.commitConfiguration()
                return
            }
            
            do {
                let videoInput = try AVCaptureDeviceInput(device: videoDevice)
                if self.captureSession.canAddInput(videoInput) {
                    self.captureSession.addInput(videoInput)
                    self.videoDeviceInput = videoInput
                    print("[ExternalUSBCameraController] Camera input added: \(videoDevice.localizedName)")
                }
            } catch {
                print("[ExternalUSBCameraController] Error creating camera input: \(error)")
            }
            
            self.captureSession.commitConfiguration()
            
            // For MultiCam, start immediately without delay
            // MultiCam requires both sessions to start nearly simultaneously
            if self.captureSession is AVCaptureMultiCamSession {
                print("[ExternalUSBCameraController] MultiCam: Starting immediately")
                self.captureSession.startRunning()
                self.waitForSessionRunning(retryCount: 0)
            } else {
                // For non-MultiCam, stagger the starts to avoid conflicts
                print("[ExternalUSBCameraController] Non-MultiCam: Waiting 0.3s before starting...")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                    guard let self = self else { return }
                    print("[ExternalUSBCameraController] Now starting USB camera session")
                    self.captureSession.startRunning()
                    self.waitForSessionRunning(retryCount: 0)
                }
            }
            print("[ExternalUSBCameraController] Capture session start initiated")
        }
        #endif
    }
    
    private func stop() {
        guard isRunning else { return }
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.stopRunning()
            Task { @MainActor in
                self?.isRunning = false
            }
            print("[ExternalUSBCameraController] Capture session stopped")
        }
        #endif
    }
    
    private func findExternalCamera() -> AVCaptureDevice? {
        #if !targetEnvironment(simulator)
        // Look for external cameras (USB-C, HikVision, etc.)
        if #available(iOS 17.0, *) {
            // iOS 17+: Use .external device type
            let discoverySession = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInWideAngleCamera, .external],
                mediaType: .video,
                position: .unspecified
            )
            
            for device in discoverySession.devices {
                // External devices have position .unspecified
                if device.position == .unspecified {
                    print("[ExternalUSBCameraController] Found external camera (iOS 17+): \(device.localizedName)")
                    return device
                }
            }
        } else {
            // iOS 16 and below: Search all devices for external ones
            let discoverySession = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInWideAngleCamera],
                mediaType: .video,
                position: .unspecified
            )
            
            // Also check devices() method for external cameras
            for device in AVCaptureDevice.devices(for: .video) {
                // External cameras typically have position .unspecified
                if device.position == .unspecified {
                    print("[ExternalUSBCameraController] Found external camera (iOS 16-): \(device.localizedName)")
                    return device
                }
            }
        }
        
        print("[ExternalUSBCameraController] No external camera found")
        #endif
        return nil
    }
    
    private func findBuiltInFrontCamera() -> AVCaptureDevice? {
        #if !targetEnvironment(simulator)
        if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) {
            print("[ExternalUSBCameraController] Falling back to built-in front camera")
            return front
        }
        #endif
        return nil
    }
    
    private func waitForSessionRunning(retryCount: Int) {
        let delay: TimeInterval = retryCount == 0 ? 0.1 : 0.05  // First check after 0.1s, then every 0.05s
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            
            if self.captureSession.isRunning {
                self.isRunning = true
                print("[ExternalUSBCameraController] Session confirmed running after \(retryCount) retries, posting notification")
                NotificationCenter.default.post(name: .externalCameraSessionStarted, object: self.captureSession)
            } else if retryCount < 20 {  // Retry up to 20 times (1 second total)
                print("[ExternalUSBCameraController] Session not running yet, retry \(retryCount + 1)")
                self.waitForSessionRunning(retryCount: retryCount + 1)
            } else {
                print("[ExternalUSBCameraController] ERROR: Session still not running after maximum retries!")
                self.isRunning = false
            }
        }
    }
}

// MARK: - Shared Local Camera Controller (Singleton)
@MainActor
class SharedLocalCameraController: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = SharedLocalCameraController()
    
    let captureSession: AVCaptureSession
    private var videoDeviceInput: AVCaptureDeviceInput?
    private var videoDataOutput: AVCaptureVideoDataOutput?
    @Published var isRunning = false
    @Published var currentImage: UIImage?
    private var referenceCount = 0
    private let videoOutputQueue = DispatchQueue(label: "com.ordertech.videoOutput", qos: .userInitiated)
    
    override private init() {
        // Always use regular AVCaptureSession for single camera shown on multiple displays
        // MultiCam is only needed when using DIFFERENT cameras simultaneously
        print("[SharedLocalCameraController] Using regular AVCaptureSession for single camera")
        captureSession = AVCaptureSession()
        super.init()
    }
    
    func retain() {
        Task { @MainActor in
            referenceCount += 1
            print("[SharedLocalCameraController] Retain called, count: \(referenceCount)")
            if referenceCount == 1 {
                start()
            }
        }
    }
    
    func release() {
        Task { @MainActor in
            referenceCount = max(0, referenceCount - 1)
            print("[SharedLocalCameraController] Release called, count: \(referenceCount)")
            // Add delay before stopping to allow for view transitions
            if referenceCount == 0 {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 second delay
                    if self.referenceCount == 0 {
                        self.stop()
                    } else {
                        print("[SharedLocalCameraController] Skipping stop - new reference added during delay")
                    }
                }
            }
        }
    }
    
    private func start() {
        guard !isRunning else { return }
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            
            self.captureSession.beginConfiguration()
            
            // Set preset
            if self.captureSession.canSetSessionPreset(.high) {
                self.captureSession.sessionPreset = .high
            }
            
            // Use built-in front camera
            guard let videoDevice = self.findBuiltInFrontCamera() else {
                print("[SharedLocalCameraController] No built-in camera available")
                self.captureSession.commitConfiguration()
                return
            }
            
            // Add video input
            do {
                let videoInput = try AVCaptureDeviceInput(device: videoDevice)
                if self.captureSession.canAddInput(videoInput) {
                    self.captureSession.addInput(videoInput)
                    self.videoDeviceInput = videoInput
                    print("[SharedLocalCameraController] Camera input added: \(videoDevice.localizedName)")
                }
            } catch {
                print("[SharedLocalCameraController] Error creating camera input: \(error)")
            }
            
            // Add video data output to capture frames
            let videoOutput = AVCaptureVideoDataOutput()
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(self, queue: self.videoOutputQueue)
            
            if self.captureSession.canAddOutput(videoOutput) {
                self.captureSession.addOutput(videoOutput)
                self.videoDataOutput = videoOutput
                print("[SharedLocalCameraController] Video data output added")
            }
            
            self.captureSession.commitConfiguration()
            self.captureSession.startRunning()
            // Keep checking until session actually reports as running (built-in camera can take time)
            self.waitForSessionRunning(retryCount: 0)
            print("[SharedLocalCameraController] Shared capture session start initiated")
        }
        #endif
    }
    
    private func stop() {
        guard isRunning else { return }
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.stopRunning()
            Task { @MainActor in
                self?.isRunning = false
            }
            print("[SharedLocalCameraController] Shared capture session stopped")
        }
        #endif
    }
    
    private func findBuiltInFrontCamera() -> AVCaptureDevice? {
        #if !targetEnvironment(simulator)
        if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) {
            print("[SharedLocalCameraController] Found built-in front camera")
            return front
        }
        print("[SharedLocalCameraController] No built-in front camera found")
        #endif
        return nil
    }
    
    private func waitForSessionRunning(retryCount: Int) {
        let delay: TimeInterval = retryCount == 0 ? 0.1 : 0.05  // First check after 0.1s, then every 0.05s
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            
            if self.captureSession.isRunning {
                Task { @MainActor in
                    self.isRunning = true
                }
                print("[SharedLocalCameraController] Session confirmed running after \(retryCount) retries")
            } else if retryCount < 20 {  // Retry up to 20 times (1 second total)
                print("[SharedLocalCameraController] Session not running yet, retry \(retryCount + 1)")
                self.waitForSessionRunning(retryCount: retryCount + 1)
            } else {
                print("[SharedLocalCameraController] ERROR: Session still not running after maximum retries!")
                Task { @MainActor in
                    self.isRunning = false
                }
            }
        }
    }
    
    // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        let context = CIContext()
        
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }
        let uiImage = UIImage(cgImage: cgImage, scale: 1.0, orientation: .leftMirrored)
        
        Task { @MainActor in
            self.currentImage = uiImage
        }
    }
}

// MARK: - LocalCameraView (Shows built-in camera on both displays)
private struct LocalCameraView: View {
    @Environment(\.isExternalContext) private var isExternalContext
    // Observe the shared controller to get frame updates
    @ObservedObject private var builtInController = SharedLocalCameraController.shared
    
    var body: some View {
        ZStack {
            Color.black
            
            if BuildEnv.isSimulator {
                // Show placeholder on simulator
                VStack(spacing: 8) {
                    Image(systemName: "video.fill")
                        .font(.system(size: 32))
                        .foregroundColor(.white)
                    
                    Text("Built-in Camera")
                        .font(.caption)
                        .foregroundColor(.white)
                    
                    HStack {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 6, height: 6)
                        Text("LIVE (Simulator)")
                            .font(.system(.caption2, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
            } else {
                // Show captured frames from video data output
                if let image = builtInController.currentImage {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    VStack(spacing: 8) {
                        ProgressView()
                            .tint(.white)
                        Text("Starting camera...")
                            .font(.caption)
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .onAppear {
            print("[LocalCameraView] \(isExternalContext ? "External" : "Local") display - showing built-in camera")
            builtInController.retain()
        }
        .onDisappear {
            print("[LocalCameraView] \(isExternalContext ? "External" : "Local") display - hiding built-in camera")
            builtInController.release()
        }
        .id("camera-\(isExternalContext ? "external" : "local")")
    }
}

// MARK: - LocalPIPCameraView (Built-in Front Camera for PIP)
private struct LocalPIPCameraView: View {
    @StateObject private var pipController = LocalPIPCameraController()
    
    var body: some View {
        ZStack {
            Color.black
            
            if BuildEnv.isSimulator {
                // Show placeholder on simulator
                VStack(spacing: 4) {
                    Image(systemName: "video.fill")
                        .font(.system(size: 12))
                        .foregroundColor(.white)
                    Text("PIP")
                        .font(.system(.caption2))
                        .foregroundColor(.white)
                }
            } else {
                // Show actual front camera on device
                CameraPreviewView(session: pipController.captureSession)
                    .onAppear {
                        pipController.start()
                    }
                    .onDisappear {
                        pipController.stop()
                    }
            }
        }
    }
}

// MARK: - LocalCameraController (Built-in Camera Only)
private class LocalCameraController: ObservableObject {
    let captureSession = AVCaptureSession()
    private var videoDeviceInput: AVCaptureDeviceInput?
    
    func start() {
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            
            self.captureSession.beginConfiguration()
            
            // Set preset
            if self.captureSession.canSetSessionPreset(.high) {
                self.captureSession.sessionPreset = .high
            }
            
            // Use built-in front camera
            guard let videoDevice = self.findBuiltInFrontCamera() else {
                print("[LocalCameraController] No built-in camera available")
                self.captureSession.commitConfiguration()
                return
            }
            
            // Add video input
            do {
                let videoInput = try AVCaptureDeviceInput(device: videoDevice)
                if self.captureSession.canAddInput(videoInput) {
                    self.captureSession.addInput(videoInput)
                    self.videoDeviceInput = videoInput
                    print("[LocalCameraController] Camera input added: \(videoDevice.localizedName)")
                }
            } catch {
                print("[LocalCameraController] Error creating camera input: \(error)")
            }
            
            self.captureSession.commitConfiguration()
            self.captureSession.startRunning()
            print("[LocalCameraController] Capture session started")
        }
        #endif
    }
    
    func stop() {
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.stopRunning()
            print("[LocalCameraController] Capture session stopped")
        }
        #endif
    }
    
    private func findBuiltInFrontCamera() -> AVCaptureDevice? {
        #if !targetEnvironment(simulator)
        if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) {
            print("[LocalCameraController] Found built-in front camera")
            return front
        }
        print("[LocalCameraController] No built-in front camera found")
        #endif
        return nil
    }
}

// MARK: - LocalPIPCameraController (PIP - Built-in Front Camera)
private class LocalPIPCameraController: ObservableObject {
    let captureSession = AVCaptureSession()
    private var videoDeviceInput: AVCaptureDeviceInput?
    
    func start() {
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            
            self.captureSession.beginConfiguration()
            
            // Set preset for PIP (lower quality is fine)
            if self.captureSession.canSetSessionPreset(.medium) {
                self.captureSession.sessionPreset = .medium
            }
            
            // Always use front camera for PIP
            guard let videoDevice = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
                print("[LocalPIPCameraController] Failed to get front camera for PIP")
                self.captureSession.commitConfiguration()
                return
            }
            
            // Add video input
            do {
                let videoInput = try AVCaptureDeviceInput(device: videoDevice)
                if self.captureSession.canAddInput(videoInput) {
                    self.captureSession.addInput(videoInput)
                    self.videoDeviceInput = videoInput
                    print("[LocalPIPCameraController] PIP camera input added: \(videoDevice.localizedName)")
                }
            } catch {
                print("[LocalPIPCameraController] Error creating PIP camera input: \(error)")
            }
            
            self.captureSession.commitConfiguration()
            self.captureSession.startRunning()
            print("[LocalPIPCameraController] PIP capture session started")
        }
        #endif
    }
    
    func stop() {
        #if !targetEnvironment(simulator)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.stopRunning()
            print("[LocalPIPCameraController] PIP capture session stopped")
        }
        #endif
    }
}

// MARK: - CameraPreviewView (UIKit Integration)
// Fixed: Creates independent preview layers for each instance while sharing session
private struct CameraPreviewView: UIViewRepresentable {
    let session: AVCaptureSession
    // Direct reference to check running state without triggering view updates
    private let sharedController = SharedLocalCameraController.shared
    
    func makeUIView(context: Context) -> CameraPreviewUIView {
        // Pass the session reference so it only connects to THIS specific session
        return CameraPreviewUIView(intendedSession: session)
    }
    
    func updateUIView(_ uiView: CameraPreviewUIView, context: Context) {
        // Check connection status BEFORE any modifications
        let connectionActive = uiView.previewLayer.connection?.isActive ?? false
        let sessionRunning = session.isRunning
        let controllerRunning = sharedController.isRunning
        
        print("[CameraPreviewView #\(uiView.instanceId)] updateUIView - sessionRunning: \(sessionRunning), connectionActive: \(connectionActive), controllerRunning: \(controllerRunning)")
        
        // Ensure session is still connected
        if uiView.previewLayer.session !== session {
            uiView.previewLayer.session = session
            print("[CameraPreviewView #\(uiView.instanceId)] Session reconnected to preview layer")
        }
        
        // Force refresh if session is running but connection isn't active
        if controllerRunning && sessionRunning && !connectionActive {
            print("[CameraPreviewView #\(uiView.instanceId)] Triggering refreshConnection from updateUIView")
            uiView.refreshConnection()
        }
    }
}

private class CameraPreviewUIView: UIView {
    var previewLayer: AVCaptureVideoPreviewLayer!
    private static var instanceCount = 0
    let instanceId: Int  // Made public for logging
    private var sessionObserver: NSObjectProtocol?
    private weak var intendedSession: AVCaptureSession?  // Only connect to THIS session
    
    init(intendedSession: AVCaptureSession) {
        Self.instanceCount += 1
        self.instanceId = Self.instanceCount
        self.intendedSession = intendedSession
        super.init(frame: .zero)
        
        // CRITICAL FIX: Create preview layer WITHOUT session initially
        // We'll connect it only after session is confirmed running
        previewLayer = AVCaptureVideoPreviewLayer()
        previewLayer.videoGravity = .resizeAspectFill
        // IMPORTANT: Each layer needs its own connection
        previewLayer.connection?.isEnabled = true
        layer.addSublayer(previewLayer)
        print("[CameraPreviewUIView #\(instanceId)] Created WITHOUT session initially, will connect when running")
        
        // Now connect to session if it's already running, or wait for notification
        if intendedSession.isRunning {
            print("[CameraPreviewUIView #\(instanceId)] Session already running, connecting immediately")
            connectToSession(intendedSession)
        } else {
            print("[CameraPreviewUIView #\(instanceId)] Session not running yet, will connect via notification")
            // Store session weakly to connect later
            DispatchQueue.main.async { [weak self] in
                guard let self = self, let session = self.intendedSession else { return }
                // Check again after a brief delay
                if session.isRunning {
                    print("[CameraPreviewUIView #\(self.instanceId)] Session became running, connecting now")
                    self.connectToSession(session)
                }
            }
        }
        
        // Listen for session start notifications (both built-in and external cameras)
        print("[CameraPreviewUIView #\(instanceId)] Setting up notification observers")
        
        // Built-in camera notification
        sessionObserver = NotificationCenter.default.addObserver(
            forName: .localCameraSessionStarted,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self else { return }
            print("[CameraPreviewUIView #\(self.instanceId)] Received localCameraSessionStarted notification")
            if let session = notification.object as? AVCaptureSession,
               session === self.intendedSession {
                print("[CameraPreviewUIView #\(self.instanceId)] Session matches intended session, connecting")
                self.connectToSession(session)
            } else {
                print("[CameraPreviewUIView #\(self.instanceId)] Session does NOT match intended session, ignoring")
            }
        }
        
        // External USB camera notification  
        let externalObserver = NotificationCenter.default.addObserver(
            forName: .externalCameraSessionStarted,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self else { return }
            print("[CameraPreviewUIView #\(self.instanceId)] Received externalCameraSessionStarted notification")
            if let session = notification.object as? AVCaptureSession,
               session === self.intendedSession {
                print("[CameraPreviewUIView #\(self.instanceId)] Session matches intended session, connecting")
                self.connectToSession(session)
            } else {
                print("[CameraPreviewUIView #\(self.instanceId)] Session does NOT match intended session, ignoring")
            }
        }
        // Store external observer too (we'll clean both up in deinit)
        objc_setAssociatedObject(self, "externalObserver", externalObserver, .OBJC_ASSOCIATION_RETAIN)
    }
    
    private func connectToSession(_ session: AVCaptureSession) {
        print("[CameraPreviewUIView #\(instanceId)] Connecting to session - isRunning: \(session.isRunning)")
        previewLayer.session = session
        
        if let connection = previewLayer.connection {
            connection.isEnabled = true
            print("[CameraPreviewUIView #\(instanceId)] Connected - enabled: \(connection.isEnabled), active: \(connection.isActive)")
        } else {
            print("[CameraPreviewUIView #\(instanceId)] WARNING: No connection available after setting session!")
        }
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
        print("[CameraPreviewUIView #\(instanceId)] layoutSubviews - bounds: \(bounds), layer frame: \(previewLayer?.frame ?? .zero)")
    }
    
    func refreshConnection() {
        let isRunning = previewLayer.session?.isRunning ?? false
        let isActive = previewLayer.connection?.isActive ?? false
        let isEnabled = previewLayer.connection?.isEnabled ?? false
        print("[CameraPreviewUIView #\(instanceId)] Refreshing connection - session running: \(isRunning), connection active: \(isActive), enabled: \(isEnabled)")
        
        // Force the preview layer to re-establish its connection
        if let session = previewLayer.session {
            previewLayer.session = nil
            previewLayer.session = session
            // Force enable the connection
            if let connection = previewLayer.connection {
                connection.isEnabled = true
            }
            print("[CameraPreviewUIView #\(instanceId)] Connection refreshed, now enabled: \(previewLayer.connection?.isEnabled ?? false)")
            
            // If session wasn't running yet, retry after a short delay
            if !isRunning {
                print("[CameraPreviewUIView #\(instanceId)] Scheduling delayed retry in 0.2s")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self, weak session] in
                    guard let self = self, let session = session else {
                        print("[CameraPreviewUIView] Delayed retry skipped - view or session deallocated")
                        return
                    }
                    let nowRunning = self.previewLayer.session?.isRunning ?? false
                    let nowActive = self.previewLayer.connection?.isActive ?? false
                    print("[CameraPreviewUIView #\(self.instanceId)] Delayed retry check - session running: \(nowRunning), connection active: \(nowActive)")
                    
                    if nowRunning {
                        print("[CameraPreviewUIView #\(self.instanceId)] Applying delayed refresh")
                        self.previewLayer.session = nil
                        self.previewLayer.session = session
                        print("[CameraPreviewUIView #\(self.instanceId)] Delayed connection refreshed")
                    } else {
                        print("[CameraPreviewUIView #\(self.instanceId)] Session still not running after delay")
                    }
                }
            }
        }
    }
    
    deinit {
        if let observer = sessionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let externalObserver = objc_getAssociatedObject(self, "externalObserver") {
            NotificationCenter.default.removeObserver(externalObserver)
        }
        print("[CameraPreviewUIView #\(instanceId)] Deallocated")
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
    
    // Handle lineId format: "sku::hash" -> extract base SKU
    if id.contains("::") {
        let parts = id.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: true)
        if let first = parts.first {
            set.insert(String(first))
        }
    }
    
    // Legacy fallback parsing
    let comps1 = id.split(separator: ":").map(String.init)
    if let first = comps1.first { set.insert(first) }
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
    @State private var expandedGroups: Set<String> = []

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
                            let isRequired = g.min > 0
                            let isExpanded = expandedGroups.contains(g.id)
                            
                            VStack(alignment: .leading, spacing: 6) {
                                // Group header (tappable to expand/collapse)
                                Button(action: { toggleGroup(g.id) }) {
                                    HStack {
                                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                                            .font(.system(size: isPad ? 18 : 12, weight: .semibold))
                                            .foregroundColor(isRequired ? .red : .secondary)
                                        
                                        // Group icon
                                        Group {
                                            let groupName = g.name.lowercased()
                                            if groupName.contains("milk") {
                                                Image("milk")
                                                    .resizable()
                                                    .aspectRatio(contentMode: .fit)
                                                    .frame(width: isPad ? 28 : 20, height: isPad ? 28 : 20)
                                            } else if groupName.contains("espresso") || groupName.contains("shot") {
                                                Image("espresso")
                                                    .resizable()
                                                    .aspectRatio(contentMode: .fit)
                                                    .frame(width: isPad ? 28 : 20, height: isPad ? 28 : 20)
                                            } else if groupName.contains("extra") {
                                                Image("extra")
                                                    .resizable()
                                                    .aspectRatio(contentMode: .fit)
                                                    .frame(width: isPad ? 24 : 18, height: isPad ? 24 : 18)
                                            } else {
                                                Image(systemName: iconForGroup(g.name))
                                                    .font(.system(size: isPad ? 22 : 14, weight: .semibold))
                                                    .foregroundColor(isRequired ? .red : DT.acc)
                                                    .frame(width: isPad ? 32 : 20)
                                            }
                                        }
                                        
                                        VStack(alignment: .leading, spacing: 2) {
                                            if let arabicName = g.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines),
                                               !arabicName.isEmpty {
                                                Text(arabicName)
                                                    .font(.system(size: isPad ? 22 : 14, weight: .bold))
                                                    .foregroundColor(isRequired ? .red : .primary)
                                            }
                                            Text(g.name)
                                                .font(.system(size: isPad ? 19 : 12, weight: .medium))
                                                .foregroundColor(isRequired ? .red.opacity(0.8) : .primary.opacity(0.7))
                                        }
                                        Spacer()
                                        if g.min > 0 {
                                            Text("min \(g.min)")
                                                .font(.caption2)
                                                .foregroundColor(isRequired ? .red : .secondary)
                                        }
                                        if g.max > 0 && g.max < 99 {
                                            Text("max \(g.max)")
                                                .font(.caption2)
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                    .padding(.vertical, 8)
                                    .padding(.horizontal, 12)
                                    .background(isRequired ? Color.red.opacity(0.05) : Color.clear)
                                    .cornerRadius(8)
                                }
                                .buttonStyle(.plain)
                                
                                // Options (only shown when expanded)
                                if isExpanded {
                                    let opts = g.options
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], alignment: .leading, spacing: 8) {
                                        ForEach(opts, id: \.id) { opt in
                                            let isOn = selection[g.id, default: []].contains(opt.id)
                                            Button(action: { toggleOption(optId: opt.id, inGroup: g) }) {
                                                VStack(alignment: .leading, spacing: 2) {
                                                    if let arabicName = opt.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines),
                                                       !arabicName.isEmpty {
                                                        Text(arabicName)
                                                            .font(.system(size: isPad ? 18 : 13, weight: isOn ? .bold : .semibold))
                                                            .foregroundColor(DT.ink)
                                                    }
                                                    HStack(spacing: 6) {
                                                        Text(opt.name)
                                                            .font(.system(size: isPad ? 16 : 11, weight: isOn ? .medium : .regular))
                                                            .foregroundColor(DT.ink.opacity(0.7))
                                                        if opt.price != 0 {
                                                            Text(String(format: "+%.3f", opt.price))
                                                                .font(.system(size: isPad ? 14 : 10, weight: .semibold))
                                                                .foregroundColor(DT.acc)
                                                        }
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
                                    .padding(.leading, 24)
                                    .transition(.opacity.combined(with: .move(edge: .top)))
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
                    }
                    // Remote mode removed
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

    private func toggleGroup(_ groupId: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if expandedGroups.contains(groupId) {
                expandedGroups.remove(groupId)
            } else {
                expandedGroups.insert(groupId)
            }
        }
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
    
    private func iconForGroup(_ groupName: String) -> String {
        let name = groupName.lowercased()
        
        // Beverages & Drinks
        if name.contains("milk") || name.contains("dairy") || name.contains("cream") {
            return "waterbottle"
        } else if name.contains("coffee") || name.contains("espresso") || name.contains("shot") {
            return "cup.and.saucer"
        } else if name.contains("tea") {
            return "mug"
        } else if name.contains("juice") || name.contains("smoothie") {
            return "drop.triangle"
        } else if name.contains("water") || name.contains("drink") {
            return "drop"
        }
        
        // Sweeteners & Flavors
        else if name.contains("sugar") || name.contains("sweet") || name.contains("syrup") {
            return "cube"
        } else if name.contains("flavor") || name.contains("sauce") {
            return "circle.hexagongrid"
        } else if name.contains("honey") {
            return "drop.triangle"
        }
        
        // Toppings & Add-ons
        else if name.contains("topping") || name.contains("whip") {
            return "sparkles"
        } else if name.contains("ice") || name.contains("cold") {
            return "snowflake"
        } else if name.contains("hot") || name.contains("temp") {
            return "thermometer.medium"
        }
        
        // Food items
        else if name.contains("bread") || name.contains("bun") || name.contains("toast") {
            return "takeoutbag.and.cup.and.straw"
        } else if name.contains("cheese") {
            return "square.stack"
        } else if name.contains("meat") || name.contains("protein") || name.contains("patty") {
            return "circle.grid.cross"
        } else if name.contains("vegetable") || name.contains("veggie") || name.contains("salad") {
            return "leaf"
        } else if name.contains("egg") {
            return "circle"
        }
        
        // Size & Quantity
        else if name.contains("size") {
            return "ruler"
        } else if name.contains("extra") || name.contains("add") {
            return "plus.circle"
        }
        
        // Default icon
        return "circle.grid.2x2"
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


private struct ProductPosterCard: View {
    @EnvironmentObject var env: EnvironmentStore
    let product: Product
    let width: CGFloat
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let imageURL = absoluteURL(product.image_url) {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .empty:
                        Rectangle()
                            .fill(Color.gray.opacity(0.2))
                            .overlay(ProgressView().tint(.white))
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure:
                        Rectangle()
                            .fill(Color.gray.opacity(0.2))
                            .overlay(
                                Image(systemName: "photo")
                                    .font(.system(size: 32))
                                    .foregroundColor(.white.opacity(0.5))
                            )
                    @unknown default:
                        Rectangle()
                            .fill(Color.gray.opacity(0.2))
                    }
                }
                .frame(width: width, height: width)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Rectangle()
                    .fill(Color.gray.opacity(0.2))
                    .frame(width: width, height: width)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        Image(systemName: "photo")
                            .font(.system(size: 32))
                            .foregroundColor(.white.opacity(0.5))
                    )
            }
            
            HStack(alignment: .center, spacing: 8) {
                // Names on the left side
                VStack(alignment: .leading, spacing: 2) {
                    // English name
                    Text(product.name)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    
                    // Arabic name below if available
                    if let nameAr = product.name_localized?["ar"], !nameAr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(nameAr)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.white.opacity(0.85))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
                // Price on the right side
                Text(String(format: "%.3f", product.price))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.green.opacity(0.9))
            }
        }
        .frame(width: width)
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
