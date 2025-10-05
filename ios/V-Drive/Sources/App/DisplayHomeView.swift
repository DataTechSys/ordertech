import SwiftUI
import OrderTechCore
import UIKit
import AVFoundation

struct DisplayHomeView: View {
    @EnvironmentObject var env: EnvironmentStore
    @ObservedObject var store: DisplaySessionStore
    @StateObject private var localMode = LocalModeManager()
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

    // Layout ratios to mirror Cashier
    private let topHeightFractionPhone: CGFloat = 0.30
    private let topHeightFractionPad: CGFloat = 0.40
    private let camWidthFraction: CGFloat = 0.30
    private let hGap: CGFloat = 4

    // Connection status used by the small chip (matches Cashier semantics)
    private var statusText: String {
        let isActivated = !(env.deviceToken ?? "").isEmpty
        if !isActivated { return "UNPAIRED" }
        if !store.connected { return "OFFLINE" }
        return store.peersConnected ? "CONNECTED" : "READY"
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

        let topHF: CGFloat = isPad ? topHeightFractionPad : topHeightFractionPhone
        let camWF: CGFloat = camWidthFraction
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
            .padding(.horizontal, hPad)
            .padding(.top, isPad ? 16 : 0)
            .padding(.bottom, 0)
        }
        
        // Local mode checkout button overlay
        if localMode.isLocalMode && !localMode.localBasketLines.isEmpty {
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    LocalCheckoutButton(
                        basketTotal: localMode.localBasketTotals.total,
                        itemCount: localMode.localBasketLines.reduce(0) { $0 + $1.qty },
                        onTap: {
                            localMode.startCheckout()
                        }
                    )
                    .padding(.trailing, 20)
                    .padding(.bottom, 20)
                }
            }
            .transition(.scale.combined(with: .opacity))
            .animation(.spring(response: 0.5, dampingFraction: 0.8), value: localMode.isLocalMode)
        }
    }

    @ViewBuilder
    private func topRowView(camW: CGFloat, billW: CGFloat, topH: CGFloat, contentW: CGFloat, innerPad: CGFloat, isPad: Bool) -> some View {
        HStack(spacing: hGap) {
            CameraBoxView(peersConnected: store.peersConnected)
                .frame(width: camW, height: topH)
            BillBoxView(
                lines: localMode.isLocalMode ? localMode.localBasketLines : store.basketLines,
                totals: localMode.isLocalMode ? localMode.localBasketTotals : store.basketTotals,
                textScale: isPad ? 1.0 : 0.6,
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
                .overlay(alignment: .topTrailing) {
                    HStack(spacing: 8) {
                        LocalModeIndicator(isActive: localMode.isLocalMode)
                            .environmentObject(store)
                        InActiveIndicator()
                        StatusChipView(status: statusText, compact: true, dotOnly: true, onTap: {
                            showDisconnectConfirmation = true
                        })
                        // Debug gestures removed - using working backup configuration
                    }
                    .padding(.top, 6)
                    .padding(.trailing, 6)
                }
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
        }
        .onReceive(store.$selectedProductId.removeDuplicates().debounce(for: .milliseconds(100), scheduler: RunLoop.main)) { pid in
            // Skip remote product selection commands when in local mode
            guard !localMode.isLocalMode else {
                print("[DisplayHomeView] Ignoring remote selectedProductId update in local mode: \(pid ?? "nil")")
                return
            }
            
            // Handle external product selection commands from cashier
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
            // Product detail popup - full screen coverage
            if let product = selectedProduct {
                Color.black.opacity(0.01)
                    .ignoresSafeArea(.all)
                    .onTapGesture {
                        selectedProduct = nil
                    }
                    .overlay {
                        ProductDetailPopup(
                            product: product,
                            onAddToCart: { product, quantity, modifiers in
                                handleProductSelection(product: product, quantity: quantity, modifiers: modifiers)
                            },
                            onDismiss: {
                                selectedProduct = nil
                            }
                        )
                        .environmentObject(localMode)
                        .padding(.horizontal, 20)
                        .padding(.top, 40)
                        .padding(.bottom, 20)
                    }
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
                textScale: isPad ? 1.2 : 1.0,
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
                .padding()
            }
            .presentationDetents([.medium, .large])
        }
    }
    
    // MARK: - Product Selection Handling
    private func handleProductSelection(product: Product, quantity: Int, modifiers: [String: Any]) {
        if localMode.isLocalMode {
            // Add to local basket with modifiers
            for _ in 0..<quantity {
                localMode.addToLocalBasket(product: product, qty: 1)
            }
            // TODO: Store modifiers information with the basket item if needed
            // For now, modifiers are ignored in local mode
        } else {
            // Send to cashier with product selection
            store.sendShowProduct(id: product.id)
            // TODO: Send modifiers information to cashier if needed
            // For now, modifiers are sent via the regular product selection
        }
        
        // Clear selection to close popup
        selectedProduct = nil
    }
}

// MARK: - Top Left: Camera with PIP (no background loop)
private struct CameraBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var store: DisplaySessionStore
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
            RoundedRectangle(cornerRadius: 12).fill(Color.black)
            
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
            .clipShape(RoundedRectangle(cornerRadius: 12))
        .mask(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.15), lineWidth: 1))
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
            #if canImport(LiveKit)
            let currentLiveKit = store.currentLiveKit
            let hasLiveKit = currentLiveKit != nil
            let peersConnected = store.peersConnected
            let _ = print("[CameraBoxView] Rendering decision: currentLiveKit=\(hasLiveKit ? "available" : "nil"), peersConnected=\(peersConnected)")
            if hasLiveKit {
                let _ = print("[CameraBoxView] Creating LKRemoteVideoView")
                LKRemoteVideoView(cornerRadius: 12, masksToBounds: true)
                    .id("remote_\(remoteKey)")
                    .environmentObject(store)
                    .aspectRatio(9/16, contentMode: .fit)
                    .onAppear {
                        print("[CameraBoxView] LKRemoteVideoView appeared")
                    }
            } else {
                let _ = print("[CameraBoxView] Using fallbackView - no LiveKit available")
                fallbackView
            }
            #else
            fallbackView
            #endif
        }
    }
    
    private var videoPIPOverlays: some View {
        Group {
            #if canImport(LiveKit)
            if store.currentLiveKit != nil {
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
                    }
                }
            }
            #endif
            #if canImport(WebRTC)
            if store.currentLiveKit == nil {
                if let local = storeService.localVideoTrack {
                    GeometryReader { geo in
                        let pipW: CGFloat = 48
                        let pipH: CGFloat = pipW * 16.0 / 9.0
                        let x = geo.size.width - 8 - pipW / 2
                        let y = min(geo.size.height - 8 - pipH / 2, geo.size.height * 5.0 / 6.0)
                        RTCLocalVideoView(track: local)
                            .frame(width: pipW, height: pipH)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.6), lineWidth: 1))
                            .shadow(radius: 1)
                            .position(x: x, y: y)
                    }
                } else {
                    #if canImport(AVFoundation)
                    GeometryReader { geo in
                        let pipW: CGFloat = 48
                        let pipH: CGFloat = pipW * 16.0 / 9.0
                        let x = geo.size.width - 8 - pipW / 2
                        let y = min(geo.size.height - 8 - pipH / 2, geo.size.height * 5.0 / 6.0)
                        DisplayPreconnectLocalPreview(controller: preconnectController)
                            .frame(width: pipW, height: pipH)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.6), lineWidth: 1))
                            .shadow(radius: 3)
                            .position(x: x, y: y)
                            .onAppear { preconnectController.start() }
                            .onDisappear { preconnectController.stop() }
                    }
                    #endif
                }
            }
            #else
            #if canImport(AVFoundation)
            if store.currentLiveKit == nil {
                GeometryReader { geo in
                    let pipW: CGFloat = 48
                    let pipH: CGFloat = pipW * 16.0 / 9.0
                    let x = geo.size.width - 8 - pipW / 2
                    let y = min(geo.size.height - 8 - pipH / 2, geo.size.height * 5.0 / 6.0)
                    PreconnectLocalPreview(controller: preconnectController)
                        .frame(width: pipW, height: pipH)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.6), lineWidth: 1))
                        .shadow(radius: 3)
                        .position(x: x, y: y)
                        .onAppear { preconnectController.start() }
                        .onDisappear { preconnectController.stop() }
                }
            }
            #endif
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

// MARK: - Top Right: Bill (Order + Totals)
private struct BillBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var catalog: CatalogStore
    let lines: [BasketLineUI]
    let totals: BasketTotalsUI
    var textScale: CGFloat = 1.0
    var onTapTotal: (() -> Void)? = nil
    var onTapLine: ((BasketLineUI) -> Void)? = nil
    var onEditLine: ((BasketLineUI) -> Void)? = nil
    var onDeleteLine: ((BasketLineUI) -> Void)? = nil
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Order Summary").font(.system(size: 17 * textScale, weight: .semibold))
                Spacer()
            }
    
            .padding(.top, 10)
            .padding(.leading, 6)

            Divider().padding(.bottom, 6)

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
                                // Left block: qty, modifiers+name, unit price
                                VStack(alignment: .leading, spacing: 0) {
                                    Text("x\(line.qty)")
                                        .font(.system(size: max(11, 12 * textScale)))
                                        .foregroundColor(.primary)
                                        .lineLimit(1)
                                    let mods = line.options.joined(separator: ", ")
                                    if !mods.isEmpty {
                                        (Text(mods)
                                            .font(.system(size: 11 * textScale))
                                            .foregroundColor(.secondary)
                                         + Text(" ")
                                         + Text(line.name)
                                            .font(.system(size: 14 * textScale, weight: .bold))
                                        )
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                        .layoutPriority(1)
                                    } else {
                                        Text(line.name)
                                            .font(.system(size: 14 * textScale, weight: .bold))
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                            .layoutPriority(1)
                                    }
                                    Text(String(format: "%.3f KWD", line.unitPrice))
                                        .font(.system(size: 12 * textScale))
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                // Right: line total
                                Text(currency(line.lineTotal))
                                    .font(.system(size: 14 * textScale, weight: .semibold))
                                    .monospacedDigit()
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
        .clipShape(RoundedRectangle(cornerRadius: 12))
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
    @State private var selectedCategory: String? = nil
    @State private var pageIndex: Int = 1
    
    @Binding var selectedProduct: Product?
    let preview: PreviewState?
    let poster: PosterState?

    // Removed debug controls in production build

    @State private var topVisibleProductId: String? = nil
    @State private var suppressScrollBroadcast: Bool = false
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
.padding(.horizontal, 0)
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
            // External (Cashier) requested a category; apply it
            if let n = name, !n.isEmpty { selectedCategory = n }
        }
        .overlay(alignment: .center) {
            if catalog.categories.isEmpty && catalog.products.isEmpty {
                ProgressView("Loading menu…")
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            }
        }
    }

    private var categoryChips: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(catalog.categories) { c in
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
                    if let sel = selectedCategory, let cid = catalog.categories.first(where: { $0.name == sel })?.id {
                        withAnimation { proxy.scrollTo(cid, anchor: .center) }
                    } else if let first = catalog.categories.first?.id {
                        withAnimation { proxy.scrollTo(first, anchor: .center) }
                    }
                }
                .onChange(of: selectedCategory ?? "") { _ in
                    if let sel = selectedCategory, let cid = catalog.categories.first(where: { $0.name == sel })?.id {
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
            let minColW: CGFloat = isPhone ? 95 : 120
            let maxCols = 4
            
            // Break up complex calculation
            let colCalculation = (availableWidth + spacing) / (minColW + spacing)
            let columnsCount = max(3, min(maxCols, Int(floor(colCalculation))))
            let totalSpacing = spacing * CGFloat(columnsCount - 1)
            let colW = floor((availableWidth - totalSpacing) / CGFloat(columnsCount))

            let cats = catalog.categories
            let hasCats = !cats.isEmpty
            let cyc = hasCats ? ([cats.last!] + cats + [cats.first!]) : []
            // If no categories came back, show all products on a single page
            let singlePageAll = !hasCats ? [Category(id: "all", name: "All", image: nil)] : []

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
                                        selectedProduct = p
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
                            if let top = topPair?.key { onTopVisibleChanged(top: top) }
                        }
                        .onReceive(store.$scrollToProductId.removeDuplicates()) { pid in
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
                                            selectedProduct = p
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
                                if let top = topPair?.key { onTopVisibleChanged(top: top) }
                            }
                            .onReceive(store.$scrollToProductId.removeDuplicates()) { pid in
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
    }

    
    private func onTopVisibleChanged(top: String) {
        if suppressScrollBroadcast { return }
        if top != topVisibleProductId {
            topVisibleProductId = top
            store.sendScrollTo(id: top)
        }
    }
}

private struct VisibleProductKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { a, b in min(a, b) })
    }
}


// MARK: - Temporary Product Detail Popup (will be moved to separate file)
struct ProductDetailPopup: View {
    @EnvironmentObject var localMode: LocalModeManager
    @Environment(\.dismiss) private var dismiss
    
    let product: Product
    let onAddToCart: (Product, Int, [String: Any]) -> Void
    let onDismiss: () -> Void
    
    @State private var quantity: Int = 1
    @State private var selectedModifiers: [String: Any] = [:]
    @State private var isLoading = false
    
    var totalPrice: Double {
        let basePrice = product.price * Double(quantity)
        return basePrice
    }
    
    var body: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let imageSide: CGFloat = isPad ? 420 : 320
        
        VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Product Details")
                        .font(.system(size: isPad ? 24 : 20, weight: .bold))
                        .foregroundColor(.primary)
                    
                    Spacer()
                    
                    Button(action: { onDismiss() }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.secondary)
                            .padding(10)
                            .background(Circle().fill(Color.gray.opacity(0.1)))
                    }
                    .buttonStyle(.plain)
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
                            Text(product.name)
                                .font(.system(size: isPad ? 28 : 24, weight: .bold))
                                .foregroundColor(.primary)
                            
                            Text(String(format: "%.3f KWD", product.price))
                                .font(.system(size: isPad ? 22 : 18, weight: .semibold))
                                .foregroundColor(.blue)
                                .monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        
                        // Quantity selector
                        VStack(spacing: 20) {
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
                            
                            // Add to cart button
                            Button(action: addToCart) {
                                HStack(spacing: 16) {
                                    Image(systemName: localMode.isLocalMode ? "cart.badge.plus" : "paperplane.fill")
                                        .font(.system(size: 20, weight: .semibold))
                                    
                                    Text(localMode.isLocalMode ? "Add to Local Cart" : "Send to Cashier")
                                        .font(.system(size: isPad ? 20 : 18, weight: .bold))
                                    
                                    Spacer()
                                    
                                    Text(String(format: "%.3f KWD", totalPrice))
                                        .font(.system(size: isPad ? 20 : 18, weight: .bold))
                                        .monospacedDigit()
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, isPad ? 32 : 24)
                                .padding(.vertical, isPad ? 20 : 16)
                                .background(
                                    RoundedRectangle(cornerRadius: 16)
                                        .fill(localMode.isLocalMode ? Color.orange : Color.blue)
                                        .shadow(color: (localMode.isLocalMode ? Color.orange : Color.blue).opacity(0.3), radius: 12, x: 0, y: 6)
                                )
                            }
                            .buttonStyle(.plain)
                            .scaleEffect(isLoading ? 0.95 : 1.0)
                            .opacity(isLoading ? 0.7 : 1.0)
                            .disabled(isLoading)
                            .animation(.easeInOut(duration: 0.1), value: isLoading)
                        }
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
    }
    
    private func addToCart() {
        isLoading = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            onAddToCart(product, quantity, selectedModifiers)
            isLoading = false
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
    let product: Product
    let width: CGFloat
    var onTap: (() -> Void)? = nil

    private var corner: CGFloat { DT.radius }
    private var innerPad: CGFloat { 10 }
    private var textBlockH: CGFloat { 72 }

    var body: some View {
        let imageSide = width - innerPad * 2
        ZStack {
            RoundedRectangle(cornerRadius: corner)
                .fill(DT.surface)
                .overlay(RoundedRectangle(cornerRadius: corner).stroke(DT.line, lineWidth: 1))
            VStack(spacing: 8) {
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: corner)
                    .frame(width: imageSide, height: imageSide)
                VStack(spacing: 3) {
                    let ar = (product.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
                    let en = product.name
                    if ar.isEmpty {
                        Text(en)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.clear)
                            .frame(width: imageSide)
                    } else {
                        Text(ar)
                            .font(.system(size: 14, weight: .semibold))
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
                    Text(String(format: "%.3f KWD", product.price))
                        .font(.system(size: 13, weight: .semibold))
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

// MARK: - Shared views
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

    let product: Product
    // Optional editing context when opened from an existing basket line
    var lineId: String? = nil
    var initialQty: Int? = nil
    var line: BasketLineUI? = nil

    @State private var qty: Int = 1

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
                        let ar = (product.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
                        if !ar.isEmpty {
                            Text(ar)
                                .font(.system(size: isPad ? 20 : 16, weight: .bold))
                                .foregroundColor(DT.ink)
                        }
                        Text(product.name)
                            .font(.system(size: isPad ? 22 : 17, weight: .bold))
                            .foregroundColor(DT.ink)
                        Text(String(format: "%.3f KWD", product.price))
                            .font(.system(size: isPad ? 18 : 15, weight: .semibold))
                            .foregroundColor(DT.acc)
                    }
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
                Stepper(value: $qty, in: 1...200) {
                    Text("Quantity: \(qty)")
                }
                .frame(maxWidth: 260)
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
                        store.addToBasket(product: product, qty: qty)
                    }
                }
                if store.selectedProductId != nil { store.sendOptionsClose() }
                dismiss()
            } label: {
                    HStack {
                        Image(systemName: "cart.fill")
                        Text("Add to order")
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
