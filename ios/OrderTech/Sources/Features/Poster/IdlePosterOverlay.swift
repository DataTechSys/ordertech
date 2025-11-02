import SwiftUI
import OrderTechCore

/// Full-screen idle poster overlay showing product grid grouped by category
struct IdlePosterOverlay: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var catalog: CatalogStore
    
    @State private var currentCategoryIndex = 0
    @State private var timer: Timer?
    
    let onDismiss: () -> Void
    
    private let columns = 2
    private let flipInterval: TimeInterval = 5.0
    
    var body: some View {
        ZStack {
            // Background
            Color.black.opacity(0.95)
                .ignoresSafeArea()
            
            // Content
            if !groupedCategories.isEmpty {
                VStack(spacing: 0) {
                    // Category title
                    categoryHeader
                        .padding(.top, 40)
                        .padding(.horizontal, 32)
                    
                    // Product grid
                    ScrollView {
                        productGrid
                            .padding(.horizontal, 32)
                            .padding(.vertical, 20)
                    }
                    
                    // Page indicator
                    pageIndicator
                        .padding(.bottom, 40)
                }
            } else {
                // Empty state
                VStack(spacing: 16) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 64))
                        .foregroundColor(.white.opacity(0.5))
                    Text("No products available")
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.7))
                }
            }
        }
        .onAppear {
            startAutoFlip()
        }
        .onDisappear {
            stopAutoFlip()
        }
        .onTapGesture {
            onDismiss()
        }
    }
    
    // MARK: - Category Header
    
    private var categoryHeader: some View {
        let category = currentCategory
        return HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(category.name)
                    .font(.system(size: 42, weight: .bold))
                    .foregroundColor(.white)
                Text("\(productsInCurrentCategory.count) items")
                    .font(.system(size: 18))
                    .foregroundColor(.white.opacity(0.7))
            }
            Spacer()
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
        .id("category-\(currentCategoryIndex)")
    }
    
    // MARK: - Product Grid
    
    private var productGrid: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let spacing: CGFloat = isPad ? 24 : 16
        let screenWidth = UIScreen.main.bounds.width
        let availableWidth = screenWidth - 64 // 32 padding on each side
        let itemWidth = (availableWidth - spacing) / CGFloat(columns)
        
        return LazyVGrid(
            columns: Array(repeating: GridItem(.fixed(itemWidth), spacing: spacing), count: columns),
            spacing: spacing
        ) {
            ForEach(productsInCurrentCategory, id: \.id) { product in
                ProductPosterCard(product: product, width: itemWidth)
            }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
        .id("grid-\(currentCategoryIndex)")
    }
    
    // MARK: - Page Indicator
    
    private var pageIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0..<groupedCategories.count, id: \.self) { index in
                Circle()
                    .fill(index == currentCategoryIndex ? Color.white : Color.white.opacity(0.3))
                    .frame(width: 8, height: 8)
                    .animation(.easeInOut(duration: 0.3), value: currentCategoryIndex)
            }
        }
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
        let index = currentCategoryIndex % groupedCategories.count
        return groupedCategories[index]
    }
    
    private var productsInCurrentCategory: [Product] {
        currentCategory.products
    }
    
    // MARK: - Auto Flip Logic
    
    private func startAutoFlip() {
        timer = Timer.scheduledTimer(withTimeInterval: flipInterval, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.5)) {
                flipToNextCategory()
            }
        }
    }
    
    private func stopAutoFlip() {
        timer?.invalidate()
        timer = nil
    }
    
    private func flipToNextCategory() {
        guard !groupedCategories.isEmpty else { return }
        currentCategoryIndex = (currentCategoryIndex + 1) % groupedCategories.count
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
