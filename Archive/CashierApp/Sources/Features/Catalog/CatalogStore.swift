import Foundation
import SwiftUI

@MainActor
final class CatalogStore: ObservableObject {
    @Published var categories: [Category] = []
    @Published var products: [Product] = []

    func loadAll(env: EnvironmentStore) async {
        do {
            let cats = try await HttpClient(env: env).fetchCategories()
            await MainActor.run { self.categories = cats }
        } catch {
            await MainActor.run { self.categories = [] }
        }
        do {
            let prods = try await HttpClient(env: env).fetchProducts(categoryName: nil)
            await MainActor.run { self.products = prods }
        } catch {
            await MainActor.run { self.products = [] }
        }
    }

    func products(inCategoryName name: String?, env: EnvironmentStore) -> [Product] {
        guard let name = name, !name.isEmpty else { return products }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cid = categories.first(where: { $0.name == trimmed })?.id {
            let byId = products.filter { ($0.category_id ?? "") == cid }
            if !byId.isEmpty { return byId }
        }
        // Case-insensitive name match fallback
        return products.filter {
            (($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                .caseInsensitiveCompare(trimmed) == .orderedSame)
        }
    }

    func prefetchImages(env: EnvironmentStore, concurrency: Int = 6) async {
        let base = await env.baseURL
        let urls: [URL] = products.compactMap { p in
            guard let raw = p.image_url, !raw.isEmpty else { return nil }
            return absoluteURL(base: base, raw: raw)
        }
        let unique = Array(Set(urls))
        guard !unique.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            // Launch "concurrency" workers pulling from a shared index
            let lock = NSLock()
            var i = 0
            func next() -> URL? {
                lock.lock(); defer { lock.unlock() }
                guard i < unique.count else { return nil }
                let u = unique[i]; i += 1; return u
            }
            for _ in 0..<max(1, concurrency) {
                group.addTask {
                    while let u = next() {
                        var req = URLRequest(url: u)
                        req.cachePolicy = .useProtocolCachePolicy
                        req.timeoutInterval = 25
                        _ = try? await URLSession.shared.data(for: req)
                    }
                }
            }
        }
    }
}

private func absoluteURL(base: URL, raw: String) -> URL? {
    if let u = URL(string: raw), u.scheme != nil { return u }
    if raw.hasPrefix("/") {
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)
        comps?.path = raw
        return comps?.url
    }
    return base.appendingPathComponent(raw)
}

