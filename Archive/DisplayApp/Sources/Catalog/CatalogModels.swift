import Foundation
import OrderTechCore

struct TenantInfo: Codable { let tenant_id: String; let branch: String?; let display_name: String? }

struct Brand: Codable {
    let display_name: String?
    let logo_url: String?
    let color_primary: String?
    let color_secondary: String?
    // Optional short code fields; backend may use any of these
    let short_code: String?
    let code: String?
}

struct DeviceProfile: Decodable {
    let name: String?
    let display_name: String?
    let branch: String?
    // Admin fields we care about
    let tenant_name: String?
    let short_code: String?

    private enum CodingKeys: String, CodingKey {
        case name
        case display_name
        case branch
        // alternate keys
        case device_name
        case deviceName
        case displayName
        case branch_name
        case branchName
        case tenant_name
        case tenantName
        case company_name
        case companyName
        case short_code
        case shortCode
    }

    init(name: String?, display_name: String?, branch: String?, tenant_name: String?, short_code: String?) {
        self.name = name
        self.display_name = display_name
        self.branch = branch
        self.tenant_name = tenant_name
        self.short_code = short_code
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Prefer explicit keys, but accept alternates; write explicitly to keep the compiler fast
        var nm: String? = nil
        if let v = try? c.decodeIfPresent(String.self, forKey: .name) { nm = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .device_name) { nm = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .deviceName) { nm = v }

        var dn: String? = nil
        if let v = try? c.decodeIfPresent(String.self, forKey: .display_name) { dn = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .displayName) { dn = v }

        var br: String? = nil
        if let v = try? c.decodeIfPresent(String.self, forKey: .branch) { br = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .branch_name) { br = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .branchName) { br = v }

        var tn: String? = nil
        if let v = try? c.decodeIfPresent(String.self, forKey: .tenant_name) { tn = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .tenantName) { tn = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .company_name) { tn = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .companyName) { tn = v }

        var sc: String? = nil
        if let v = try? c.decodeIfPresent(String.self, forKey: .short_code) { sc = v }
        else if let v = try? c.decodeIfPresent(String.self, forKey: .shortCode) { sc = v }

        self.init(name: nm, display_name: dn, branch: br, tenant_name: tn, short_code: sc)
    }
}

struct Category: Codable, Identifiable {
    let id: String
    let name: String
    let image: String?
}

struct Product: Codable, Identifiable {
    let id: String
    let name: String
    let name_localized: String?
    let price: Double
    let image_url: String?
    let category_id: String?
    let category_name: String?

    private enum CodingKeys: String, CodingKey {
        case id, name, name_localized, price, image_url, category_id, category_name
    }

    init(id: String, name: String, name_localized: String?, price: Double, image_url: String?, category_id: String?, category_name: String?) {
        self.id = id
        self.name = name
        self.name_localized = name_localized
        self.price = price
        self.image_url = image_url
        self.category_id = category_id
        self.category_name = category_name
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.name = try c.decode(String.self, forKey: .name)
        self.name_localized = try? c.decode(String.self, forKey: .name_localized)
        if let p = try? c.decode(Double.self, forKey: .price) {
            self.price = p
        } else if let s = try? c.decode(String.self, forKey: .price), let p = Double(s) {
            self.price = p
        } else {
            self.price = 0
        }
        self.image_url = try? c.decode(String.self, forKey: .image_url)
        self.category_id = try? c.decode(String.self, forKey: .category_id)
        self.category_name = try? c.decode(String.self, forKey: .category_name)
    }
}

struct Manifest: Decodable { let brand: Brand?; let profile: DeviceProfile? }

extension HttpClient {
    func fetchBrand() async throws -> Brand { try await request("/brand") }
    func fetchDeviceProfile() async throws -> DeviceProfile { try await request("/device/profile") }
    func fetchManifest() async throws -> Manifest { try await request("/manifest") }
    func fetchCategories() async throws -> [Category] { try await request("/categories") }
    func fetchProducts(categoryName: String? = nil) async throws -> [Product] {
        let path: String
        if let c = categoryName, !c.isEmpty {
            let esc = c.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? c
            path = "/products?category_name=\(esc)"
        } else {
            path = "/products"
        }
        return try await request(path)
    }
}

@MainActor
final class CatalogStore: ObservableObject {
    @Published var categories: [Category] = []
    @Published var products: [Product] = []
    @Published var lastHeaders: [String:String] = [:]
    @Published var lastFetchedAt: Date? = nil

    func loadFromCache() {
        do {
            let cats: [Category] = try LocalCache.loadJSON([Category].self, from: "categories.json")
            let prods: [Product] = try LocalCache.loadJSON([Product].self, from: "products.json")
            self.categories = cats
            self.products = prods
        } catch { /* no cache yet */ }
    }

    func saveToCache() {
        do { try LocalCache.saveJSON(categories, to: "categories.json") } catch { }
        do { try LocalCache.saveJSON(products, to: "products.json") } catch { }
        LocalCache.lastSyncDate = Date()
    }

    private func prefetchImages(env: EnvironmentStore, concurrency: Int = 4) async {
        let base = env.baseURL
        let urls: [URL] = products.compactMap { p in
            guard let raw = p.image_url, !raw.isEmpty else { return nil }
            if let u = URL(string: raw), u.scheme != nil { return u }
            if raw.hasPrefix("/") {
                var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)
                comps?.path = raw
                return comps?.url
            }
            return base.appendingPathComponent(raw)
        }
        let unique = Array(Set(urls))
        guard !unique.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            let lock = NSLock(); var i = 0
            func next() -> URL? { lock.lock(); defer { lock.unlock() }; guard i < unique.count else { return nil }; let u = unique[i]; i += 1; return u }
            for _ in 0..<max(1, min(concurrency, 2)) { // cap concurrency to 2 to reduce load
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

    func syncAll(env: EnvironmentStore, deriveCategoriesIfEmpty: Bool = false) async {
        var cats: [Category] = []
        var prods: [Product] = []
        do { cats = try await manualGet(env: env, path: "/categories") } catch { cats = [] }
        do { prods = try await manualGet(env: env, path: "/products") } catch { prods = [] }
        self.categories = cats
        self.products = prods
        // Headers not tracked for manual path currently
        self.lastHeaders = [:]
        self.lastFetchedAt = Date()
        if deriveCategoriesIfEmpty && self.categories.isEmpty && !self.products.isEmpty {
            let names = Array(Set(self.products.compactMap { ($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }))
                .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            self.categories = names.map { Category(id: $0, name: $0, image: nil) }
        }
        saveToCache()
        // Prefetch disabled to reduce network load
        // await prefetchImages(env: env)
    }

    func loadAll(env: EnvironmentStore) async {
        // Always start with whatever is cached
        loadFromCache()
        // If not activated, keep cached menu and return (avoid wiping cache)
        guard let tok = env.deviceToken, !tok.isEmpty else {
            lastHeaders = [:]
            lastFetchedAt = Date()
            // keep cache as-is
            return
        }
        // Try to refresh from server using HttpClient (has path fallbacks like /api and /v1)
        let http = HttpClient(env: env)
        var newCats: [Category]? = nil
        var newProds: [Product]? = nil
        do {
            newCats = try await http.request("/categories", fresh: true)
        } catch {
            // leave nil to preserve cache
        }
        do {
            newProds = try await http.request("/products", fresh: true)
        } catch {
            // leave nil to preserve cache
        }
        if let c = newCats { categories = c }
        if let p = newProds { products = p }
        lastHeaders = http.lastResponseHeaders
        lastFetchedAt = Date()
        saveToCache()
    }

    func products(inCategoryName name: String?, env: EnvironmentStore) -> [Product] {
        guard let name = name, !name.isEmpty, name != "All" else { return products }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cid = categories.first(where: { $0.name == trimmed })?.id {
            let byId = products.filter { ($0.category_id ?? "") == cid }
            if !byId.isEmpty { return byId }
        }
        let byName = products.filter { (($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(trimmed) == .orderedSame) }
        if !byName.isEmpty { return byName }
        // Fallback: show all products if category mapping doesn’t match server dataset
        return products
    }
    private func manualGet<T: Decodable>(env: EnvironmentStore, path: String) async throws -> T {
        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.path = path
        guard let url = comps.url else { throw APIError(message: "invalid_url") }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if let tid = env.tenantId { req.setValue(tid, forHTTPHeaderField: "x-tenant-id") }
        if let tok = env.deviceToken {
            req.setValue(tok, forHTTPHeaderField: "x-device-token")
            req.setValue(tok, forHTTPHeaderField: "x-display-token")
            req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        }
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError(message: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)") }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
