import SwiftUI

struct ProductsGridView: View {
    @EnvironmentObject var env: EnvironmentStore
    let categoryName: String?
    @State private var products: [Product] = []
    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                ForEach(products) { p in
                    VStack {
                        Rectangle().fill(.gray.opacity(0.2)).aspectRatio(1, contentMode: .fit)
                            .overlay(Text(p.image_url ?? "").font(.caption).foregroundColor(.secondary).padding(4), alignment: .bottomLeading)
                        Text(p.name).font(.subheadline).lineLimit(2)
                        Text(String(format: "%.3f KWD", p.price)).font(.footnote).foregroundColor(.secondary)
                    }
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(.gray.opacity(0.2)))
                }
            }.padding()
        }
        .task { await load() }
        .navigationTitle(categoryName ?? "Products")
    }
    private func load() async {
        do {
            products = try await HttpClient(env: env).fetchProducts(categoryName: categoryName)
        } catch { }
    }
}

