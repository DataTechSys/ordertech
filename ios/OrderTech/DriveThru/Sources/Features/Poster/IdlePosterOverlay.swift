import SwiftUI
import OrderTechCore

/// Full-screen idle poster overlay with two modes: fullscreen shuffled products or category-based
struct IdlePosterOverlay: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var catalog: CatalogStore
    @AppStorage("OT.display.posterMode") private var posterMode: String = "fullscreen"
    @AppStorage("OT.display.posterFlipInterval") private var posterFlipInterval: Double = 15.0
    
    @State private var currentPageIndex = 0
    @State private var timer: Timer?
    
    let onDismiss: () -> Void
    
    private let columns = 2
    
    var body: some View {
        ZStack {
            // Background
            Color.black.opacity(0.95)
                .ignoresSafeArea()
            
            // Content based on mode
            if catalog.products.isEmpty {
                emptyState
            } else if posterMode == "fullscreen" {
                fullscreenMode
            } else {
                categoryMode
            }
        }
        .onAppear { startAutoFlip() }
        .onDisappear { stopAutoFlip() }
        .onTapGesture { onDismiss() }
    }
    
    // MARK: - Empty State
    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 64))
                .foregroundColor(.white.opacity(0.5))
            Text("No products available")
                .font(.title2)
                .foregroundColor(.white.opacity(0.7))
        }
    }
    
    // MARK: - Fullscreen Mode
    private var fullscreenMode: some View {
        GeometryReader { geo in
            fullscreenGrid(availableHeight: geo.size.height)
                .padding(.horizontal, 32)
                .padding(.vertical, 40)
        }
    }
    
    @ViewBuilder
    private func fullscreenGrid(availableHeight: CGFloat) -> some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let spacing: CGFloat = isPad ? 24 : 16
        let screenWidth = UIScreen.main.bounds.width
        let availableWidth = screenWidth - 64
        let verticalPadding: CGFloat = 80
        let availableContentHeight = availableHeight - verticalPadding
        
        let itemWidth = (availableWidth - spacing) / CGFloat(columns)
        let textHeight: CGFloat = 60
        let cardHeight = itemWidth + textHeight + 12
        
        let maxRows = Int(floor(availableContentHeight / (cardHeight + spacing)))
        let itemsPerPage = max(2, maxRows * columns)
        
        // Shuffle all products and paginate
        let shuffled = catalog.products.shuffled()
        let totalPages = max(1, Int(ceil(Double(shuffled.count) / Double(itemsPerPage))))
        let pageIndex = currentPageIndex % totalPages
        let startIdx = pageIndex * itemsPerPage
        let endIdx = min(startIdx + itemsPerPage, shuffled.count)
        let pageProducts = Array(shuffled[startIdx..<endIdx])
        
        LazyVGrid(
            columns: Array(repeating: GridItem(.fixed(itemWidth), spacing: spacing), count: columns),
            spacing: spacing
        ) {
            ForEach(pageProducts, id: \.id) { product in
                ProductPosterCard(product: product, width: itemWidth)
            }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
        .id("fullscreen-page-\(currentPageIndex)")
    }
    
    // MARK: - Category Mode
    private var categoryMode: some View {
        GeometryReader { geo in
            categoryGrid(availableHeight: geo.size.height)
                .padding(.horizontal, 32)
                .padding(.vertical, 40)
        }
    }
    
    @ViewBuilder
    private func categoryGrid(availableHeight: CGFloat) -> some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let spacing: CGFloat = isPad ? 24 : 16
        let screenWidth = UIScreen.main.bounds.width
        let availableWidth = screenWidth - 64
        let verticalPadding: CGFloat = 80
        let availableContentHeight = availableHeight - verticalPadding
        
        let itemWidth = (availableWidth - spacing) / CGFloat(columns)
        let textHeight: CGFloat = 60
        let cardHeight = itemWidth + textHeight + 12
        
        let maxRows = Int(floor(availableContentHeight / (cardHeight + spacing)))
        let maxItemsToShow = max(2, maxRows * columns)
        
        let visibleProducts = Array(productsInCurrentCategory.prefix(maxItemsToShow))
        
        LazyVGrid(
            columns: Array(repeating: GridItem(.fixed(itemWidth), spacing: spacing), count: columns),
            spacing: spacing
        ) {
            ForEach(visibleProducts, id: \.id) { product in
                ProductPosterCard(product: product, width: itemWidth)
            }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
        .id("category-\(currentPageIndex)")
    }
    
    // MARK: - Data Helpers
    private var groupedCategories: [(name: String, products: [Product])] {
        let categories = Dictionary(grouping: catalog.products) { product -> String in
            product.category ?? "Other"
        }
        return categories.map { (name: $0.key, products: $0.value) }
            .filter { !$0.products.isEmpty }
            .sorted { $0.name < $1.name }
    }
    
    private var currentCategory: (name: String, products: [Product]) {
        guard !groupedCategories.isEmpty else {
            return (name: "Products", products: [])
        }
        let index = currentPageIndex % groupedCategories.count
        return groupedCategories[index]
    }
    
    private var productsInCurrentCategory: [Product] {
        currentCategory.products
    }
    
    // MARK: - Auto Flip Logic
    private func startAutoFlip() {
        timer = Timer.scheduledTimer(withTimeInterval: posterFlipInterval, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.5)) { flipToNextPage() }
        }
    }
    
    private func stopAutoFlip() {
        timer?.invalidate(); timer = nil
    }
    
    private func flipToNextPage() {
        if posterMode == "fullscreen" {
            // Estimate items per page to compute total pages
            let isPad = UIDevice.current.userInterfaceIdiom == .pad
            let spacing: CGFloat = isPad ? 24 : 16
            let screenHeight = UIScreen.main.bounds.height
            let availableHeight = screenHeight - 80
            let screenWidth = UIScreen.main.bounds.width
            let availableWidth = screenWidth - 64
            let itemWidth = (availableWidth - spacing) / CGFloat(columns)
            let cardHeight = itemWidth + 60 + 12
            let maxRows = Int(floor(availableHeight / (cardHeight + spacing)))
            let itemsPerPage = max(2, maxRows * columns)
            let totalPages = max(1, Int(ceil(Double(catalog.products.count) / Double(itemsPerPage))))
            currentPageIndex = (currentPageIndex + 1) % totalPages
        } else {
            guard !groupedCategories.isEmpty else { return }
            currentPageIndex = (currentPageIndex + 1) % groupedCategories.count
        }
    }
}

// MARK: - Product Poster Card
private struct ProductPosterCard: View {
    @EnvironmentObject var env: EnvironmentStore
    let product: Product
    let width: CGFloat
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Product image
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
            
            // Product info
            VStack(alignment: .leading, spacing: 4) {
                Text(product.name)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                
                Text(String(format: "%.3f KWD", product.price))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.green.opacity(0.9))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
