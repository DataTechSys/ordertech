import SwiftUI
#if canImport(UIKit)
import UIKit
#endif


struct CashierHomeView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var session: SessionStore
    @EnvironmentObject var subscription: SubscriptionManager
    @ObservedObject var basket: BasketStore
    @EnvironmentObject var catalog: CatalogStore
    var onShowSettings: () -> Void = {}

    @State private var brandLogoURL: URL?
    @State private var categories: [Category] = []
    @State private var selectedCategory: String?
    @State private var products: [Product] = []
    @State private var errorText: String?
    @State private var isLoadingProducts = false
    @State private var pageIndex: Int = 1

    // Session/UI state
    @State private var showDisplayPicker: Bool = false
    @State private var didShowPickerOnColdStart: Bool = false
    @State private var showStopConfirm: Bool = false

    // Modifiers flow state
    @State private var isLoadingModifiers = false
    @State private var selectedProduct: Product? = nil
    @State private var modifierGroups: [AnyCodableModifierGroup] = []
    @State private var didConfirmAdd: Bool = false
    @State private var lastPresentedProductId: String? = nil
    @State private var basketCountsOnOpen: [String: Int] = [:]

    var body: some View {
        GeometryReader { geo in
            content(geo: geo)
        }
        .task {
            await subscription.refresh(env: env)
            await initialLoad()
// Cold-start picker: only once, only when not activated and no active session
            if !didShowPickerOnColdStart && session.basketId == nil {
                if !(env.requireActivation && env.deviceToken == nil) {
                    showDisplayPicker = true
                }
                didShowPickerOnColdStart = true
            }
        }
        .onReceive(env.$reloadCounter) { _ in
            Task {
                await subscription.refresh(env: env)
                await initialLoad()
            }
        }
        .onChange(of: env.tenantId) { _ in
            Task {
                await subscription.refresh(env: env)
                await initialLoad()
            }
        }
        .onChange(of: env.baseURL) { _ in
            Task {
                await subscription.refresh(env: env)
                await initialLoad()
            }
        }
        .sheet(item: $selectedProduct, onDismiss: {
            // If needed, revert any remote adds for this product since opening the sheet
            if !didConfirmAdd, let pid = lastPresentedProductId {
                // Remove any items added for this product while the sheet was open
                removeRemoteAddsOnCancel(forProductIdPrefix: pid)
                // Also set qty back to snapshot where applicable
                revertRemoteAddsOnCancel(forProductIdPrefix: pid)
            }
            // Cleanup
            didConfirmAdd = false
            lastPresentedProductId = nil
            basketCountsOnOpen = [:]
            modifierGroups = []
            isLoadingModifiers = false
            session.clearSuppressedPrefixes()
        }) { product in
            NavigationStack {
                ModifiersView(product: product, groups: $modifierGroups, isLoading: $isLoadingModifiers, onCancel: {
                    selectedProduct = nil
                }, onAdd: { selectedOptions in
                    didConfirmAdd = true
                    add(product: product, with: selectedOptions)
                    // Allow WS basket mapping to show the added item
                    session.clearSuppressedPrefixes()
                    selectedProduct = nil
                })
                .environmentObject(env)
            }
        }
        .onChange(of: selectedProduct?.id ?? "") { _ in
            // Capture the presented product id to use on dismiss (after selectedProduct becomes nil)
            if let id = selectedProduct?.id { lastPresentedProductId = id }
        }
// Display picker when requested
        .sheet(isPresented: $showDisplayPicker) {
            DisplayPickerView()
        }
        // Confirm stopping the current session when tapping the status dot (when connected)
        .alert("Stop session?", isPresented: $showStopConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Stop", role: .destructive) {
                Task {
                    await session.stopRTC(env: env)
                    session.setBasket(id: nil)
                    // Do not auto-open the picker; return to normal screen
                }
            }
        } message: {
            Text("This will end the current session and disconnect from the display.")
        }
    }

    @ViewBuilder
    private func content(geo: GeometryProxy) -> some View {
        ZStack(alignment: .topTrailing) {
            DT.bg.ignoresSafeArea()
            VStack(spacing: DT.space2) {
                header
                if isCompact(geo) {
                    compactContent
                } else {
                    regularContent(geo: geo)
                }
                if let e = errorText { Text(e).foregroundColor(.red).font(.footnote) }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)

            // Floating video bubble: show only after session is actually connected
            if session.signalBars > 0 {
                FloatingVideoBubble()
                    .padding(.trailing, 8)
                    .padding(.top, 56)
            }

            // Centered activation overlay (activation) — only when not blocked by subscription
            if env.requireActivation && env.deviceToken == nil && subscription.state.isBlocking == false {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        VStack(spacing: 20) {
                            InlineActivationPageView()
                                .environmentObject(env)
                                .frame(maxWidth: 760)
                                .padding(.horizontal, 20)
                        }
                        .frame(maxWidth: min(geo.size.width - 40, 820))
                        Spacer()
                    }
                    .frame(width: geo.size.width)
                    // Move slightly upward on iPad for better visual balance
                    .offset(y: (UIDevice.current.userInterfaceIdiom == .pad || geo.size.width >= 700) ? -120 : -40)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .contentShape(Rectangle())
                .background(Color.clear)
                .ignoresSafeArea()
            }

        }
    }

    private func isCompact(_ geo: GeometryProxy) -> Bool {
        UIDevice.current.userInterfaceIdiom == .phone || geo.size.width < 700
    }

    @ViewBuilder
    private var compactContent: some View {
        VStack(spacing: 8) {
            HStack {
                categoryTabs
                Spacer(minLength: 0)
            }
            productsPager
        }
        .padding(DT.space2)
        .background(DT.surface)
        .clipShape(RoundedRectangle(cornerRadius: DT.radius))
        .overlay(
            RoundedRectangle(cornerRadius: DT.radius)
                .stroke(DT.line, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 6, x: 0, y: 3)
    }

    @ViewBuilder
    private func regularContent(geo: GeometryProxy) -> some View {
        VStack(spacing: DT.space) {
            categoryTabs
            productsPager
        }
        .padding(DT.space2)
        .background(DT.surface)
        .clipShape(RoundedRectangle(cornerRadius: DT.radius))
        .overlay(
            RoundedRectangle(cornerRadius: DT.radius)
                .stroke(DT.line, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 6, x: 0, y: 3)
    }


    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if subscription.state.isGrace {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
                        Text(graceText)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        Button("Refresh") { Task { await subscription.refresh(env: env) } }
                            .font(.footnote.weight(.semibold))
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.12)))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.orange.opacity(0.25), lineWidth: 1))
                }
                if subscription.state.isBlocking {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.fill").foregroundColor(.red)
                        Text(blockingText)
                            .font(.footnote.weight(.semibold))
                            .foregroundColor(.red)
                        Button("Refresh") { Task { await subscription.refresh(env: env) } }
                            .font(.footnote.weight(.semibold))
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.red.opacity(0.1)))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.red.opacity(0.25), lineWidth: 1))
                }
            }
            .padding(.horizontal)
            HStack {
                Button(action: { onShowSettings() }) {
                    if let url = brandLogoURL {
                        AsyncImage(url: url) { img in
                            img.resizable().scaledToFit()
                        } placeholder: { Color.clear }
                        .frame(height: 32)
                    } else {
                        #if canImport(UIKit)
                        if let ui = UIImage(named: "DataTech-T1") ?? UIImage(named: "OrderTech2") {
                            Image(uiImage: ui)
                                .resizable()
                                .scaledToFit()
                                .frame(height: 32)
                        } else {
                            Text("OrderTech Cashier").font(.headline)
                        }
                        #else
                        Text("OrderTech Cashier").font(.headline)
                        #endif
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Admin Settings")
                Spacer()
                // Basket button on top row (right corner)
                NavigationLink {
                    BasketSummaryView(basket: basket, provider: session.providerTag, bars: session.signalBars, onShowSettings: onShowSettings)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "cart")
                        Text(String(format: "%.3f", basket.total))
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Color.white))
                    .overlay(Capsule().stroke(DT.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Basket Summary")
// Connection status beside basket: tappable dot only (green when connected, orange otherwise)
                Button(action: {
                    if session.signalBars > 0 {
                        // Connected: ask to stop
                        showStopConfirm = true
                    } else {
                        // Not connected: open picker
                        showDisplayPicker = true
                    }
                }) {
StatusChipView(status: statusChipText, provider: (session.signalBars > 0 ? session.providerTag : nil), compact: true, dotOnly: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Connection status")
                // Keyboard shortcut: Cmd+E to end session (prompts confirmation if connected)
                Button("") {
                    if session.signalBars > 0 { showStopConfirm = true }
                }
                .keyboardShortcut("e", modifiers: .command)
                .frame(width: 0, height: 0)
                .opacity(0.001)
                .accessibilityHidden(true)
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private var categoryTabs: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(categories) { c in
                        let isSel = (c.name == (selectedCategory ?? c.name))
                        Button(action: { Task { await select(category: c.name) } }) {
                            // Adjust size for compact
                            let compact = UIScreen.main.bounds.width < 700
                            Text(c.name)
                                .font(.system(size: compact ? 13 : 15, weight: isSel ? .semibold : .regular))
                                .foregroundColor(isSel ? DT.acc : DT.ink)
                                .padding(.horizontal, compact ? 12 : 16)
                                .padding(.vertical, compact ? 6 : 8)
                                .background(isSel ? DT.acc.opacity(0.12) : DT.surface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(isSel ? DT.acc : DT.line, lineWidth: 1)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .id(c.id)
                    }
                }
            }
            .onAppear {
                // Center the selected chip initially
                if let sel = selectedCategory, let cid = categories.first(where: { $0.name == sel })?.id {
                    withAnimation { proxy.scrollTo(cid, anchor: .center) }
                } else if let first = categories.first?.id {
                    withAnimation { proxy.scrollTo(first, anchor: .center) }
                }
            }
            .onChange(of: selectedCategory ?? "") { _ in
                // Keep the selected chip centered as pages change
                if let sel = selectedCategory, let cid = categories.first(where: { $0.name == sel })?.id {
                    withAnimation { proxy.scrollTo(cid, anchor: .center) }
                }
            }
        }
        .overlay {
            if let e = errorText { Text(e).foregroundColor(.red).font(.footnote) }
        }
    }

private var statusChipText: String {
        if env.requireActivation && env.deviceToken == nil { return "UNPAIRED" }
        if session.signalBars > 0 { return "CONNECTED" }
        return "READY"
    }

    // Helper texts for subscription banners
    private var blockingText: String {
        if subscription.state == .suspended { return "Subscription suspended — contact Admin" }
        return "Subscription expired — renew in Admin"
    }
    private var graceText: String {
        if let until = subscription.graceUntil {
            let secs = Int(until.timeIntervalSinceNow)
            if secs > 0 {
                let days = secs / 86400
                let hours = (secs % 86400) / 3600
                if days > 0 { return "Grace ends in \(days)d \(hours)h" }
                let mins = (secs % 3600) / 60
                return hours > 0 ? "Grace ends in \(hours)h \(mins)m" : "Grace ends in \(mins)m"
            }
        }
        return "Subscription grace period active"
    }

    // Removed large bill area; basket is accessible as a top-row button

    private var productsPager: some View {
        ZStack {
            GeometryReader { proxy in
                let isCompact = UIScreen.main.bounds.width < 700
                let columnsCount = isCompact ? 3 : 4
                let spacing = DT.space2
                let horizontalPadding = DT.space2
                // Account for grid's horizontal padding to get the true content width
                let availableWidth = proxy.size.width - (horizontalPadding * 2)
                let totalSpacing = spacing * CGFloat(columnsCount - 1)
                let colW = max(isCompact ? 100 : 120, (availableWidth - totalSpacing) / CGFloat(columnsCount))

                let cats = categories
                let hasCats = !cats.isEmpty
                let cyc = hasCats ? ([cats.last!] + cats + [cats.first!]) : []

                TabView(selection: $pageIndex) {
                    ForEach(Array(cyc.enumerated()), id: \.offset) { pair in
                        let i = pair.offset
                        let c = pair.element
                        let list = catalog.products(inCategoryName: c.name, env: env)
                        ScrollView {
                            LazyVGrid(
                                columns: Array(repeating: GridItem(.fixed(colW), spacing: spacing, alignment: .top), count: columnsCount),
                                spacing: spacing
                            ) {
                                ForEach(list) { p in
                                    ProductTileView(product: p, width: colW)
                                        .environmentObject(env)
                                        .contentShape(Rectangle())
                                        .onTapGesture { Task { await onProductTapped(p) } }
                                }
                            }
                            .padding(.top, 6)
                            .padding(.horizontal, horizontalPadding)
                        }
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onAppear {
                    // Initialize to the first real item when categories load
                    if hasCats {
                        if let sel = selectedCategory, let idx = cats.firstIndex(where: { $0.name == sel }) {
                            pageIndex = idx + 1
                        } else {
                            pageIndex = 1
                        }
                    }
                }
                .onChange(of: selectedCategory ?? "") { _ in
                    // Keep pager in sync when category is chosen from tabs
                    if hasCats, let sel = selectedCategory, let idx = cats.firstIndex(where: { $0.name == sel }) {
                        let desired = idx + 1
                        if pageIndex != desired { pageIndex = desired }
                    }
                }
                .onChange(of: pageIndex) { newVal in
                    guard hasCats else { return }
                    let lastIndex = cats.count
                    if newVal == 0 {
                        // Wrapped to the leading duplicate (last real)
                        pageIndex = lastIndex
                        let name = cats[lastIndex - 1].name
                        Task { await select(category: name) }
                    } else if newVal == lastIndex + 1 {
                        // Wrapped to the trailing duplicate (first real)
                        pageIndex = 1
                        let name = cats[0].name
                        Task { await select(category: name) }
                    } else {
                        // Normal page change (1...lastIndex)
                        let actual = max(1, min(lastIndex, newVal)) - 1
                        let name = cats[actual].name
                        if selectedCategory != name {
                            Task { await select(category: name) }
                        }
                    }
                }
            }

            if isLoadingProducts {
                ProgressView("Loading products…")
                    .progressViewStyle(.circular)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white).shadow(radius: 8))
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func initialLoad() async {
        // Gate tenant-scoped data until device is activated
        if env.requireActivation && (env.deviceToken ?? "").isEmpty { return }
        await loadBrand()
        // Load full catalog once
        await catalog.loadAll(env: env)
        self.categories = catalog.categories
        // Select first category if nothing selected
        if selectedCategory == nil { selectedCategory = categories.first?.name }
        // Filter locally; if empty (mismatched category ids/names), fall back to all products
        var filtered = catalog.products(inCategoryName: selectedCategory, env: env)
        if filtered.isEmpty && !catalog.products.isEmpty {
            selectedCategory = nil
            filtered = catalog.products(inCategoryName: nil, env: env)
        }
        self.products = filtered
        // Prefetch images (fire-and-forget)
        Task.detached { [weak catalog, weak env] in
            guard let cat = catalog, let e = env else { return }
            await cat.prefetchImages(env: e)
        }
    }

    private func loadBrand() async {
        do {
            let b = try await HttpClient(env: env).fetchBrand()
            if let s = b.logo_url, !s.isEmpty {
                var url: URL? = nil
                if let tmp = URL(string: s), tmp.scheme != nil {
                    url = tmp
                } else if s.hasPrefix("/") {
                    var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false)
                    comps?.path = s
                    url = comps?.url
                } else {
                    url = env.baseURL.appendingPathComponent(s)
                }
                brandLogoURL = url
            }
        } catch { /* ignore for now */ }
    }

    private func loadCategories() async {
        do {
            categories = try await HttpClient(env: env).fetchCategories()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func select(category: String) async {
        selectedCategory = category
        isLoadingProducts = true
        defer { isLoadingProducts = false }
        // Filter locally from preloaded catalog (kept for compatibility)
        let list = catalog.products(inCategoryName: category, env: env)
        products = list
        // Mirror selection to display
        session.sendSelectCategory(name: category)
    }

    private func add(product: Product) {
        if let idx = basket.items.firstIndex(where: { $0.id == product.id }) {
            basket.items[idx].qty += 1
        } else {
            basket.items.append(BasketItem(id: product.id, name: product.name, price: product.price, qty: 1, imageURL: product.image_url))
        }
        // Emit basket update to backend (simple add)
        session.sendAdd(sku: product.id, name: product.name, price: product.price)
    }

    private func add(product: Product, with options: [AnyCodableModifierGroup.Option]) {
        // Build a unique key so different modifier selections are separate line items
        let ids = options.map { $0.id }.sorted().joined(separator: ";")
        let key = ids.isEmpty ? product.id : (product.id + ":" + ids)
        let extras = options.map { $0.name }.joined(separator: ", ")
        let name = extras.isEmpty ? product.name : (product.name + " (" + extras + ")")
        let delta = options.compactMap { $0.price }.reduce(0, +)
        let price = product.price + delta
        if let idx = basket.items.firstIndex(where: { $0.id == key }) {
            basket.items[idx].qty += 1
        } else {
            basket.items.append(BasketItem(id: key, name: name, price: price, qty: 1, imageURL: product.image_url))
        }
        // Emit basket update to backend with variant key
        session.sendAdd(sku: key, name: name, price: price)
    }

    @MainActor
    private func onProductTapped(_ p: Product) async {
        // Present sheet immediately, then load modifiers
        selectedProduct = p
        lastPresentedProductId = p.id
        // Snapshot basket counts for this product (base and variants) at sheet open
        basketCountsOnOpen = snapshotCountsForProduct(idPrefix: p.id)
        // Suppress incoming adds for matching SKUs while the sheet is open
        session.setSuppressedPrefixes([p.id] + alternateIds(from: p.id))
        isLoadingModifiers = true
        modifierGroups = []
        let tappedId = p.id
        do {
            var groups = try await HttpClient(env: env).fetchModifiers(for: tappedId)
            // Fallback: try alternate ids if no groups returned
            if groups.isEmpty {
                let alts = alternateIds(from: tappedId)
                for alt in alts where alt != tappedId {
                    do {
                        let resp: AnyModifierResponse = try await HttpClient(env: env).request("/products/\(alt)/modifiers")
                        if !resp.items.isEmpty { groups = resp.items; break }
                    } catch { /* try next */ }
                }
            }
            // Only apply results if still viewing the same product
            if selectedProduct?.id == tappedId {
                modifierGroups = groups
                isLoadingModifiers = false
            }
        } catch {
            if selectedProduct?.id == tappedId {
                modifierGroups = []
                isLoadingModifiers = false
            }
        }
    }

    private func snapshotCountsForProduct(idPrefix: String) -> [String: Int] {
        var counts: [String: Int] = [:]
        let prefixes = [idPrefix] + alternateIds(from: idPrefix)
        for it in basket.items {
            if prefixes.contains(where: { it.id == $0 || it.id.hasPrefix($0 + ":") || it.id.hasPrefix($0 + "#") }) {
                counts[it.id] = it.qty
            }
        }
        return counts
    }

    private func removeRemoteAddsOnCancel(forProductIdPrefix pid: String) {
        let prefixes = [pid] + alternateIds(from: pid)
        for it in basket.items {
            if prefixes.contains(where: { it.id == $0 || it.id.hasPrefix($0 + ":") || it.id.hasPrefix($0 + "#") }) {
                session.sendRemove(sku: it.id)
            }
        }
    }

    private func revertRemoteAddsOnCancel(forProductIdPrefix pid: String) {
        // Compare current counts vs snapshot and revert any increments
        var current: [String: Int] = [:]
        let prefixes = [pid] + alternateIds(from: pid)
        for it in basket.items {
            if prefixes.contains(where: { it.id == $0 || it.id.hasPrefix($0 + ":") || it.id.hasPrefix($0 + "#") }) {
                current[it.id] = it.qty
            }
        }
        let before = basketCountsOnOpen
        for (sku, nowQty) in current {
            let oldQty = before[sku] ?? 0
            if nowQty > oldQty {
                session.sendSetQty(sku: sku, qty: oldQty)
            }
        }
    }

    private func alternateIds(from id: String) -> [String] {
        var candidates: [String] = []
        // last component after '-' or ':'
        if let lastDash = id.split(separator: "-").last { candidates.append(String(lastDash)) }
        if let lastColon = id.split(separator: ":").last { let s = String(lastColon); if !candidates.contains(s) { candidates.append(s) } }
        // digits-only
        let digits = id.filter { $0.isNumber }
        if !digits.isEmpty && !candidates.contains(digits) { candidates.append(digits) }
        return candidates
    }
}

