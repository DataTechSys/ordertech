import SwiftUI
import OrderTechCore

struct DisplayHomeView: View {
    @EnvironmentObject var env: EnvironmentStore
    @ObservedObject var store: DisplaySessionStore

    // Layout ratios (tweakable)
    private let topHeightFraction: CGFloat = 1.0/3.0   // Top row ~1/3 of the page
    private let camWidthFraction: CGFloat = 1.0/3.0    // Camera box width in top row
    private let billWidthFraction: CGFloat = 2.0/3.0   // Bill box width in top row
    private let catWidthFraction: CGFloat = 1.0/3.0    // Categories box width in bottom row
    private let prodWidthFraction: CGFloat = 2.0/3.0   // Products box width in bottom row
    private var boxSpacing: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let totalW = geo.size.width
            let totalH = geo.size.height
            let topH = totalH * topHeightFraction
            let bottomH = totalH - topH

            VStack(spacing: boxSpacing) {
                // TOP ROW: [ Camera (1/3) | Bill (2/3) ]
                HStack(spacing: boxSpacing) {
                    CameraBoxView(peersConnected: store.peersConnected)
                        .frame(width: totalW * camWidthFraction, height: topH)
                    BillBoxView(lines: store.basketLines, totals: store.basketTotals)
                        .frame(width: totalW * billWidthFraction, height: topH)
                }
                .frame(height: topH)

                // BOTTOM FULL-WIDTH: Catalog (categories + products)
                CategoriesBoxView(preview: store.preview, poster: store.poster)
                    .frame(width: totalW, height: bottomH)
                .frame(height: bottomH)
            }
            .frame(width: totalW, height: totalH)
        }
        .padding(0)
        .background(Color(white: 0.96))
        .ignoresSafeArea()
    }
}

// Offline preview wrapper that reuses CategoriesBoxView without WS/preview/poster
struct OfflineMenuView: View {
    @EnvironmentObject var env: EnvironmentStore
    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 12) {
                CategoriesBoxView(preview: nil, poster: nil)
                    .frame(width: geo.size.width, height: geo.size.height)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .padding(0)
        .background(Color(white: 0.96))
    }
}

// MARK: - Top Left: Camera with PIP
private struct CameraBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    #if canImport(WebRTC)
    @EnvironmentObject var storeService: WebRTCService
    #endif
    let peersConnected: Bool
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.black)
                #if canImport(WebRTC)
                if let remote = storeService.remoteVideoTrack {
                    RTCRemoteVideoView(track: remote)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    HStack(spacing: 8) {
                        Image(systemName: peersConnected ? "video.fill" : "video.slash").foregroundColor(.white)
                        Text(peersConnected ? "Remote camera connected" : "Waiting for cashier…")
                            .foregroundColor(.white).font(.subheadline)
                    }
                }
                #else
                HStack(spacing: 8) {
                    Image(systemName: peersConnected ? "video.fill" : "video.slash").foregroundColor(.white)
                    Text(peersConnected ? "Remote camera connected" : "Waiting for cashier…")
                        .foregroundColor(.white).font(.subheadline)
                }
                #endif
            }

            // Local camera PIP
            #if canImport(WebRTC)
            if let local = storeService.localVideoTrack {
                RTCLocalVideoView(track: local)
                    .frame(width: 180, height: 120)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.6), lineWidth: 1))
                    .padding(10)
            }
            #endif
        }
    }
}

// MARK: - Top Right: Bill (Order + Totals)
private struct BillBoxView: View {
    let lines: [BasketLineUI]
    let totals: BasketTotalsUI
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Bill").font(.headline)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 10)

            Divider().padding(.bottom, 6)

            // Order lines
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(lines) { line in
                        HStack(alignment: .top) {
                            Text("\(line.qty)×").monospacedDigit()
                            VStack(alignment: .leading, spacing: 2) {
                                Text(line.name).font(.subheadline)
                                if !line.options.isEmpty {
                                    Text(line.options.joined(separator: ", "))
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                            Text(currency(line.lineTotal)).monospacedDigit()
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 4)
                        Divider()
                    }
                }
            }

            // Totals footer
            VStack(spacing: 6) {
                HStack { Text("Subtotal"); Spacer(); Text(currency(totals.subtotal)).monospacedDigit() }
                Divider()
                HStack { Text("Total").font(.headline); Spacer(); Text(currency(totals.total)).font(.headline).monospacedDigit() }
            }
            .padding()
            .background(Color.white.opacity(0.8))
        }
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Bottom Left: Catalog (Categories + Products) to match Cashier iPad design
private struct CategoriesBoxView: View {
    @EnvironmentObject var env: EnvironmentStore
    @StateObject private var catalog = CatalogStore()
    @State private var selectedCategory: String? = nil
    @State private var pageIndex: Int = 1

    let preview: PreviewState?
    let poster: PosterState?

    // Removed debug controls in production build

    var body: some View {
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
        .padding(0)
        .task { await initialLoad() }
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
        .background(Color.clear)
    }

    private var productsPager: some View {
        GeometryReader { proxy in
            let columnsCount = 3
            let spacing: CGFloat = 0
            let horizontalPadding: CGFloat = 0
            let availableWidth = proxy.size.width - (horizontalPadding * 2)
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
                    ScrollView {
                        LazyVGrid(
                            columns: Array(repeating: GridItem(.fixed(colW), spacing: spacing, alignment: .top), count: columnsCount),
                            spacing: spacing
                        ) {
                            ForEach(list) { p in
                                ProductTile(product: p, width: colW).environmentObject(env)
                            }
                        }
                        .padding(.top, 6)
                        .padding(.horizontal, horizontalPadding)
                    }
                    .scrollContentInsets(.never)
                    .refreshable { await refreshAll() }
                } else {
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
                                ProductTile(product: p, width: colW)
                                    .environmentObject(env)
                            }
                        }
                        .padding(.top, 6)
                        .padding(.horizontal, horizontalPadding)
                    }
                    .scrollContentInsets(.never)
                    .refreshable { await refreshAll() }
                    .tag(i)
                    }
                }
            }
.tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea(.container, edges: .horizontal)
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

    private func refreshAll() async {
        await catalog.loadAll(env: env)
        // Reset selection to a valid category if needed
        if let sel = selectedCategory, catalog.categories.contains(where: { $0.name == sel }) {
            // Keep current selection
            if let idx = catalog.categories.firstIndex(where: { $0.name == sel }) { pageIndex = idx + 1 }
        } else if let first = catalog.categories.first?.name {
            selectedCategory = first
            pageIndex = 1
        } else {
            selectedCategory = nil
            pageIndex = 1
        }
    }
}


// MARK: - Product tile adapted from Cashier
private struct ProductTile: View {
    @EnvironmentObject var env: EnvironmentStore
    let product: Product
    let width: CGFloat

    private var corner: CGFloat { DT.radius }
    private var innerPad: CGFloat { 0 }
    private var textBlockH: CGFloat { 72 }

    var body: some View {
        let imageSide = width - innerPad * 2
        ZStack {
            VStack(spacing: 6) {
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: 0)
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
        .shadow(color: .clear, radius: 0, x: 0, y: 0)
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
