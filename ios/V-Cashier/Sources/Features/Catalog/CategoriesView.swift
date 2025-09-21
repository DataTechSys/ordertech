import SwiftUI

struct CategoriesView: View {
    @EnvironmentObject var env: EnvironmentStore
    @State private var categories: [Category] = []
    @State private var error: String?

    var body: some View {
        List(categories) { c in
            NavigationLink(c.name) { ProductsGridView(categoryName: c.name) }
        }
        .overlay {
            if let e = error { Text(e).foregroundColor(.red).padding() }
        }
        .task {
            await load()
        }
        .navigationTitle("Categories")
    }

    private func load() async {
        do {
            categories = try await HttpClient(env: env).fetchCategories()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

