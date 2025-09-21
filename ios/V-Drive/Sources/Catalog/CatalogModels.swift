import Foundation
import OrderTechCore
import SwiftUI
import CryptoKit

#if canImport(UIKit)
import UIKit
private typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
private typealias PlatformImage = NSImage
#endif

// Disk-backed image cache used by display image views & prefetcher
final class ImageDiskCache {
    static let shared = ImageDiskCache()

    private let folderURL: URL
    private let fm = FileManager.default

    private init() {
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first!
        folderURL = caches.appendingPathComponent("ImageCache", conformingTo: .directory)
        try? fm.createDirectory(at: folderURL, withIntermediateDirectories: true)
    }

    func hasImage(for url: URL) -> Bool {
        fm.fileExists(atPath: path(for: url).path)
    }

    func image(for url: URL) -> Image? {
        guard let data = try? Data(contentsOf: path(for: url)) else { return nil }
        #if canImport(UIKit)
        guard let ui = PlatformImage(data: data) else { return nil }
        return Image(uiImage: ui)
        #elseif canImport(AppKit)
        guard let ns = PlatformImage(data: data) else { return nil }
        return Image(nsImage: ns)
        #else
        return nil
        #endif
    }

    func store(data: Data, for url: URL) {
        let p = path(for: url)
        do { try data.write(to: p, options: .atomic) } catch { }
    }

    func cachedDataFromURLCache(url: URL) -> Data? {
        let req = URLRequest(url: url)
        return URLCache.shared.cachedResponse(for: req)?.data
    }

    func storeFromURLCacheOrDownload(url: URL) async {
        if hasImage(for: url) { return }
        if let data = cachedDataFromURLCache(url: url) {
            store(data: data, for: url)
            return
        }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 20
        if let (data, _) = try? await URLSession.shared.data(for: req) {
            store(data: data, for: url)
        }
    }

    private func path(for url: URL) -> URL {
        let key = url.absoluteString
        let hash = SHA256.hash(data: Data(key.utf8))
        let hex = hash.compactMap { String(format: "%02x", $0) }.joined()
        let ext = (url.pathExtension.isEmpty ? "img" : url.pathExtension)
        return folderURL.appendingPathComponent(hex).appendingPathExtension(ext)
    }
}

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

    // Ensure product.category_id and product.category_name are consistent with our categories list
    private func normalizeProductCategories() {
        guard !categories.isEmpty, !products.isEmpty else { return }
        // Build lookup maps
        var nameToId: [String:String] = [:]
        var idToName: [String:String] = [:]
        for c in categories {
            let key = c.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            nameToId[key] = c.id
            idToName[c.id] = c.name
        }
        // Normalize products
        var updated: [Product] = []
        updated.reserveCapacity(products.count)
        for p in products {
            var cid = p.category_id?.trimmingCharacters(in: .whitespacesAndNewlines)
            var cname = p.category_name?.trimmingCharacters(in: .whitespacesAndNewlines)

            // If we don't have an id but we have a name, resolve the id via category name
            if (cid == nil || cid!.isEmpty), let n = cname, !n.isEmpty {
                let key = n.lowercased()
                if let found = nameToId[key] { cid = found }
            }
            // If we don't have a name but we have an id, resolve the name via category id
            if (cname == nil || cname!.isEmpty), let id = cid, !id.isEmpty {
                if let found = idToName[id] { cname = found }
            }

            if cid != p.category_id || cname != p.category_name {
                let np = Product(id: p.id,
                                 name: p.name,
                                 name_localized: p.name_localized,
                                 price: p.price,
                                 image_url: p.image_url,
                                 category_id: cid,
                                 category_name: cname)
                updated.append(np)
            } else {
                updated.append(p)
            }
        }
        self.products = updated
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
                        // If already cached on disk, skip
                        if ImageDiskCache.shared.hasImage(for: u) { continue }
                        // Try URLCache first to avoid re-downloading if recently fetched
                        if let data = ImageDiskCache.shared.cachedDataFromURLCache(url: u) {
                            ImageDiskCache.shared.store(data: data, for: u)
                            continue
                        }
                        var req = URLRequest(url: u)
                        req.cachePolicy = .reloadIgnoringLocalCacheData
                        req.timeoutInterval = 20
                        if let (data, _) = try? await URLSession.shared.data(for: req) {
                            ImageDiskCache.shared.store(data: data, for: u)
                        }
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
        // Normalize product category fields before persisting and prefetching
        normalizeProductCategories()
        saveToCache()
        // Prefetch product images to disk so they are available offline
        await prefetchImages(env: env)
    }

    func loadAll(env: EnvironmentStore) async {
        // 1) Load any cached data first
        loadFromCache()
        let hadCache = !(categories.isEmpty && products.isEmpty)


        // If not activated (no device token), never fetch and never inject debug data — just keep cache on screen
        if (env.deviceToken ?? "").isEmpty {
            // If cache has products but no categories, derive categories by name for offline/preview
            if self.categories.isEmpty && !self.products.isEmpty {
                let names = Array(Set(self.products.compactMap { ($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }))
                    .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
                self.categories = names.map { Category(id: $0, name: $0, image: nil) }
                // Normalize product category references against derived categories before persisting
                normalizeProductCategories()
                saveToCache()
            }
            lastHeaders = [:]
            lastFetchedAt = Date()
            return
        }

        // 3) Try to fetch fresh data from Admin/Core API, but don't wipe cache if server is unreachable/unauthorized
        var fetchedCategories: [Category]? = nil
        var fetchedProducts: [Product]? = nil
        do { let c: [Category] = try await manualGet(env: env, path: "/categories"); fetchedCategories = c } catch { /* keep nil */ }
        do { let p: [Product] = try await manualGet(env: env, path: "/products"); fetchedProducts = p } catch { /* keep nil */ }

        if let c = fetchedCategories, !c.isEmpty {
            categories = c
        } else if !hadCache {
            categories = []
        }
        if let p = fetchedProducts, !p.isEmpty {
            products = p
        } else if !hadCache {
            products = []
        }

        lastHeaders = [:]
        lastFetchedAt = Date()

        #if DEBUG
        // Only inject debug sample when there was no cache and server provided nothing
        if !hadCache && categories.isEmpty && products.isEmpty {
            loadDebugSample()
        }
        #endif

        // If server didn't provide categories but products have category names, derive categories (all builds)
        if self.categories.isEmpty && !self.products.isEmpty {
            let names = Array(Set(self.products.compactMap { ($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }))
                .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            self.categories = names.map { Category(id: $0, name: $0, image: nil) }
        }

        // 3) Normalize and persist whatever we ended up with
        normalizeProductCategories()
        saveToCache()
    }

    func products(inCategoryName name: String?, env: EnvironmentStore) -> [Product] {
        guard let name = name, !name.isEmpty, name != "All" else { return products }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // Find the category object by name OR by id matching the provided string (case-insensitive)
        let cat: Category? = {
            if let exact = categories.first(where: { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(trimmed) == .orderedSame }) { return exact }
            if let byId = categories.first(where: { $0.id.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(trimmed) == .orderedSame }) { return byId }
            return nil
        }()
        // If we have a category, match products whose category_id OR category_name equals the category's id OR name.
        if let c = cat {
            let keys = Set([c.id, c.name].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
            let list = products.filter { p in
                let pid = (p.category_id ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let pname = (p.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                return keys.contains(pid) || keys.contains(pname)
            }
            return list
        }
        // If we couldn't even resolve a category, attempt a name-based match as a last resort
        let byName = products.filter { (($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(trimmed) == .orderedSame) || (($0.category_id ?? "").trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(trimmed) == .orderedSame) }
        if !byName.isEmpty { return byName }
        // If there is no category info at all in the dataset (no ids or names), degrade gracefully by showing all
        let haveAnyCategoryInfo = products.contains { p in
            let idOK = !(p.category_id?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            let nameOK = !(p.category_name?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            return idOK || nameOK
        }
        if !haveAnyCategoryInfo {
            return products
        }
        // Otherwise, show empty for this category (indicates mismatched mapping)
        return []
    }

    #if DEBUG
    private func loadDebugSample() {
        // Minimal demo dataset: 3 categories, ~15 products
        let demoCats: [Category] = [
            Category(id: "Burgers", name: "Burgers", image: nil),
            Category(id: "Sides", name: "Sides", image: nil),
            Category(id: "Drinks", name: "Drinks", image: nil)
        ]
        func prod(_ id: String, _ name: String, _ price: Double, _ cat: String) -> Product {
            Product(id: id, name: name, name_localized: nil, price: price, image_url: nil, category_id: cat, category_name: cat)
        }
        let demoProds: [Product] = [
            prod("p1", "Classic Burger", 1.900, "Burgers"),
            prod("p2", "Cheese Burger", 2.100, "Burgers"),
            prod("p3", "Double Burger", 2.900, "Burgers"),
            prod("p4", "Chicken Burger", 2.200, "Burgers"),
            prod("p5", "Veggie Burger", 1.700, "Burgers"),
            prod("p6", "Fries", 0.700, "Sides"),
            prod("p7", "Curly Fries", 0.900, "Sides"),
            prod("p8", "Onion Rings", 0.900, "Sides"),
            prod("p9", "Coleslaw", 0.600, "Sides"),
            prod("p10", "Nuggets (6)", 1.500, "Sides"),
            prod("p11", "Water", 0.300, "Drinks"),
            prod("p12", "Cola", 0.500, "Drinks"),
            prod("p13", "Orange Juice", 0.800, "Drinks"),
            prod("p14", "Iced Tea", 0.700, "Drinks"),
            prod("p15", "Milkshake", 1.300, "Drinks")
        ]
        self.categories = demoCats
        self.products = demoProds
        self.lastFetchedAt = Date()
    }
    #endif
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
