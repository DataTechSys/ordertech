import Foundation
import OrderTechCore
import SwiftUI

@MainActor
final class CatalogStore: ObservableObject {
    @Published var categories: [Category] = []
    @Published var products: [Product] = []
    @Published var isLoading: Bool = false
    @Published var loadingProgress: String = ""
    
    // Always use Foodics as the data source
    private let dataSource: String = "Foodics"
    
    func syncAll(env: EnvironmentStore) async {
        await loadAll(env: env, forceRefresh: true)
    }

    func loadAll(env: EnvironmentStore, forceRefresh: Bool = false) async {
        isLoading = true
        loadingProgress = "Initializing..."
        
        print("[CatalogStore] loadAll: starting from Foodics, baseURL=\(env.baseURL), forceRefresh=\(forceRefresh)")
        
        // Check if we need to sync (daily or manual force refresh)
        let shouldSync = forceRefresh || shouldSyncToday()
        
        if !shouldSync {
            print("[CatalogStore] Using cached data from today - no sync needed")
            loadingProgress = "Loading from cache..."
            await loadFromCache()
            
            // Prefetch images in background after loading cached data
            if !products.isEmpty {
                Task.detached { [products] in
                    await self.prefetchImages(env: env)
                }
            }
            isLoading = false
            loadingProgress = ""
            return
        }
        
        print("[CatalogStore] Syncing fresh data from Foodics")
        loadingProgress = "Syncing from Foodics..."
        
        // Always load from Foodics
        await loadFromFoodics(env: env)
        
        // Cache results locally
        if !products.isEmpty {
            try? LocalCache.saveJSON(products, to: "products.json")
        }
        if !categories.isEmpty {
            try? LocalCache.saveJSON(categories, to: "categories.json")
        }
        LocalCache.lastSyncDate = Date()
        
        // Prefetch images after fresh sync
        if !products.isEmpty {
            loadingProgress = "Downloading images..."
            await prefetchImages(env: env)
        }
        
        isLoading = false
        loadingProgress = ""
    }
    
    private func shouldSyncToday() -> Bool {
        guard let lastSync = LocalCache.lastSyncDate else {
            print("[CatalogStore] No previous sync date - sync needed")
            return true
        }
        
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let lastSyncDay = calendar.startOfDay(for: lastSync)
        
        let needsSync = today > lastSyncDay
        if needsSync {
            print("[CatalogStore] Last sync was \(lastSync), sync needed for new day")
        }
        return needsSync
    }
    
    private func loadFromCache() async {
        await loadCategoriesFromCache()
        await loadProductsFromCache()
    }
    
    private func loadFromOrderTechDB(env: EnvironmentStore) async {
        print("[CatalogStore] Loading from OrderTech DB...")
        do {
            let cats = try await HttpClient(env: env).fetchCategories()
            print("[CatalogStore] Loaded \(cats.count) categories from DB")
            await MainActor.run { self.categories = cats }
        } catch {
            print("[CatalogStore] fetchCategories failed: \(error)")
            await loadCategoriesFromCache()
        }
        do {
            let prods = try await HttpClient(env: env).fetchProducts(categoryName: nil)
            print("[CatalogStore] Loaded \(prods.count) products from DB")
            await MainActor.run { self.products = prods }
        } catch {
            print("[CatalogStore] fetchProducts failed: \(error)")
            await loadProductsFromCache()
        }
    }
    
    private func loadFromFoodics(env: EnvironmentStore) async {
        print("[CatalogStore] Loading from Foodics...")
        guard let token = env.foodicsToken, !token.isEmpty else {
            print("[CatalogStore] No Foodics token available, falling back to cache")
            await loadCategoriesFromCache()
            await loadProductsFromCache()
            return
        }
        
        if #available(iOS 16.0, macOS 12.0, *) {
            do {
                let client = OrderTechCore.FoodicsClient(token: token)
                // Fetch categories from Foodics
                let foodicsCategories = try await client.listCategories()
                
                // Filter: keep ONLY active and not deleted categories; treat missing is_active as active (Foodics may omit it)
                let activeCategories = foodicsCategories.filter {
                    (($0.is_active == true) || ($0.is_active == nil)) && $0.deleted_at == nil
                }
                print("[CatalogStore] Filtered to \(activeCategories.count) active categories (from \(foodicsCategories.count) total)")
                
                let cats = activeCategories.map { fc in
                    Category(id: fc.id, name: fc.name, reference: fc.reference)
                }
                print("[CatalogStore] Loaded \(cats.count) categories from Foodics")
                await MainActor.run { self.categories = cats }
                
                // Fetch products from Foodics (strictly include modifiers)
                let foodicsProducts: [OrderTechCore.FoodicsProduct]
                do {
                    foodicsProducts = try await client.listProductsWithModifiersStrict()
                } catch {
                    // Fallback to general list if strict path fails
                    foodicsProducts = try await client.listProducts()
                }
                // Debug: how many products include embedded modifiers
                let withMods = foodicsProducts.filter { ($0.modifiers?.isEmpty == false) }.count
                print("[CatalogStore] Products with embedded modifiers: \(withMods)/\(foodicsProducts.count)")
                
                // Build category lookup maps (both by ID and reference)
                var categoryByReference: [String: Category] = [:]
                for cat in cats {
                    if let ref = cat.reference, !ref.isEmpty {
                        categoryByReference[ref] = cat
                    }
                }
                var categoryById: [String: Category] = [:]
                for cat in cats {
                    categoryById[cat.id] = cat
                }
                print("[CatalogStore] Category references: \(categoryByReference.keys.joined(separator: ", "))")
                
                // Try to fetch product-category links (might not be available)
                var productCategoryMap: [String: String] = [:]
                do {
                    let links = try await client.listProductCategoryLinks()
                    print("[CatalogStore] Loaded \(links.count) product-category links from Foodics")
                    for link in links {
                        productCategoryMap[link.product_id] = link.category_id
                    }
                } catch {
                    print("[CatalogStore] Product-category links not available, using reference-based mapping")
                }
                
                // Debug: Check first 3 products' is_active and deleted_at status
                for (i, fp) in foodicsProducts.prefix(3).enumerated() {
                    print("[CatalogStore] Product[\(i)] \(fp.name) is_active=\(fp.is_active?.description ?? "nil"), deleted_at=\(fp.deleted_at ?? "nil"), name_localized=\(fp.name_localized ?? "nil")")
                }
                
                // Build modifier reference table for stable caching
                loadingProgress = "Loading modifier reference table..."
                var modifierTable: ModifierReferenceTable? = nil
                var modifierOptions: [OrderTechCore.FoodicsModifierOption] = []
                
                do {
                    // Fetch all modifier options with include=modifier to get modifier_id
                    modifierOptions = try await client.listModifierOptions()
                    let allGroups = try await client.listModifierGroups()
                    
                    // Build reference table from groups, options, AND products
                    // This discovers options via:
                    // 1. modifier_id field (for options that have it)
                    // 2. Product exclusion lists (for options without modifier_id)
                    modifierTable = ModifierReferenceTable.build(
                        from: allGroups,
                        options: modifierOptions,
                        products: foodicsProducts
                    )
                    
                    print("[CatalogStore] Built modifier reference table: \(modifierTable?.groups.count ?? 0) groups, \(modifierTable?.options.count ?? 0) options")
                    
                    // Cache the table for next launch
                    if let table = modifierTable {
                        try? LocalCache.saveJSON(table, to: "modifier_reference_table.json")
                    }
                } catch {
                    print("[CatalogStore] Failed to build modifier table: \(error). Trying cached table...")
                    // Try to load cached table
                    modifierTable = try? LocalCache.loadJSON(ModifierReferenceTable.self, from: "modifier_reference_table.json")
                    if modifierTable != nil {
                        print("[CatalogStore] Using cached modifier reference table")
                    } else {
                        print("[CatalogStore] No modifier table available - modifiers will be unavailable")
                    }
                }
                
                // Build options by group id for accurate assignment (ONLY active, ready, not deleted)
                let activeOnlyOptions = modifierOptions.filter { opt in
                    let active = (opt.is_active ?? 1) == 1
                    let ready = (opt.is_ready ?? 1) == 1
                    let notDeleted = (opt.deleted_at == nil) || ((opt.deleted_at ?? "").isEmpty)
                    return active && ready && notDeleted
                }
                print("[CatalogStore] Active modifier options: \(activeOnlyOptions.count)/\(modifierOptions.count)")
                var optionsByGroupId = [String: [OrderTechCore.FoodicsModifierOption]]()
                for option in activeOnlyOptions {
                    if let gid = option.modifier_id, !gid.isEmpty {
                        optionsByGroupId[gid, default: []].append(option)
                    }
                }
                // Fetch modifier groups to resolve canonical ids by reference/name (ONLY active/ready)
                var groupIdByRef = [String: String]()
                var groupIdByName = [String: String]()
                do {
                    let allGroups = try await client.listModifierGroups()
                    print("[CatalogStore] Fetched \(allGroups.count) total modifier groups")
                    
                    // Filter: keep ONLY active and ready groups, not deleted
                    let activeGroups = allGroups.filter { g in
                        let active = (g.is_active ?? 1) == 1
                        let ready = (g.is_ready ?? 1) == 1
                        let notDeleted = (g.deleted_at == nil) || ((g.deleted_at ?? "").isEmpty)
                        return active && ready && notDeleted
                    }
                    print("[CatalogStore] Active modifier groups: \(activeGroups.count)/\(allGroups.count)")
                    
                    for g in activeGroups {
                        let ref = (g.reference ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                        if !ref.isEmpty { groupIdByRef[ref] = g.id }
                        let name = g.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                        if !name.isEmpty { groupIdByName[name] = g.id }
                    }
                    
                    // Log sample groups to verify we have SKU and all fields
                    #if DEBUG
                    if let firstGroup = activeGroups.first {
                        print("[CatalogStore] Sample modifier group: id=\(firstGroup.id), name=\(firstGroup.name), ref=\(firstGroup.reference ?? "nil"), sku=\(firstGroup.sku ?? "nil")")
                    }
                    if let gid = groupIdByRef["hot_milk"] {
                        let assignedCount = optionsByGroupId[gid]?.count ?? 0
                        print("[CatalogStore][Milk] resolved groupIdByRef[hot_milk]=\(gid) with \(assignedCount) options assigned via modifier_id")
                    }
                    #endif
                } catch {
                    #if DEBUG
                    print("[CatalogStore] listModifierGroups failed: \(error)")
                    #endif
                }
                
                // Filter: keep ONLY active and not deleted products
                let activeProducts = foodicsProducts.filter {
                    ($0.is_active == true) && (($0.deleted_at == nil) || (($0.deleted_at ?? "").isEmpty))
                }
                print("[CatalogStore] Filtered to \(activeProducts.count) active products (from \(foodicsProducts.count) total)")
                
                // Build products with async modifier fetching
                var prods: [Product] = []
                for (index, fp) in activeProducts.enumerated() {
                    var catId: String? = nil
                    var catName: String? = nil
                    
                    // Priority 1: Use embedded category object (from include=category)
                    if let embeddedCat = fp.category {
                        catId = embeddedCat.id
                        catName = embeddedCat.name
                    }
                    // Priority 2: Use link table if available
                    else if let linkCatId = productCategoryMap[fp.id] {
                        catId = linkCatId
                        catName = categoryById[linkCatId]?.name
                    }
                    // Priority 3: Use category_reference
                    else if let catRef = fp.category_reference, !catRef.isEmpty,
                            let matchedCat = categoryByReference[catRef] {
                        catId = matchedCat.id
                        catName = matchedCat.name
                    }
                    // Priority 4: Use direct category_id
                    else if let directCatId = fp.category_id {
                        catId = directCatId
                        catName = categoryById[directCatId]?.name
                    }
                    
                    // Debug first 3 products
                    if index < 3 {
                        let modCount = fp.modifiers?.count ?? 0
                        print("[CatalogStore] Product[\(index)] name=\(fp.name), price=\(fp.price ?? 0), modifiers=\(modCount), name_localized=\(fp.name_localized ?? "nil"), image=\(fp.image ?? "nil"), category_reference=\(fp.category_reference ?? "nil"), category_id=\(fp.category_id ?? "nil") → matched_catId=\(catId ?? "nil")")
                    }
                    
                    // Build name_localized dictionary properly
                    var nameLocalized: [String: String]? = nil
                    if let arName = fp.name_localized, !arName.isEmpty {
                        nameLocalized = ["ar": arName]
                    }
                    
                // Map modifiers for this product using the ModifierReferenceTable
                    var modifiers: [Product.ModifierGroup]? = nil
                    if let embeddedMods = fp.modifiers, !embeddedMods.isEmpty, let table = modifierTable {
                        // Use the reference table to resolve modifiers with stable references
                        let resolvedGroups = table.resolveModifiersForProduct(embeddedModifiers: embeddedMods)
                        
                        // Debug Hot Milk specifically
                        for group in resolvedGroups {
                            let gName = group.name.lowercased()
                            if gName.contains("hot milk") || gName.contains("hot_milk") {
                                print("[CatalogStore][HotMilk] Product \(fp.name) has \(group.options.count) hot milk options")
                            }
                        }
                        
                        if !resolvedGroups.isEmpty { modifiers = resolvedGroups }
                    }
                    
                    prods.append(Product(
                        id: fp.id,
                        name: fp.name,
                        price: fp.price ?? 0,
                        imageURL: fp.image,
                        category: catId,
                        category_id: catId,
                        category_name: catName,
                        description: nil, // Description not available in FoodicsProduct
                        name_localized: nameLocalized,
                        modifiers: modifiers
                    ))
                }
                
                let withCategory = prods.filter { $0.category_id != nil }
                let withoutCategory = prods.count - withCategory.count
                print("[CatalogStore] Loaded \(prods.count) products from Foodics (\(withCategory.count) with category, \(withoutCategory) without)")
                await MainActor.run { self.products = prods }
            } catch {
                print("[CatalogStore] Foodics sync failed: \(error)")
                await loadCategoriesFromCache()
                await loadProductsFromCache()
            }
        } else {
            print("[CatalogStore] FoodicsClient requires iOS 16.0+, falling back to cache")
            await loadCategoriesFromCache()
            await loadProductsFromCache()
        }
    }
    
    private func loadCategoriesFromCache() async {
        if let cached: [Category] = try? LocalCache.loadJSON([Category].self, from: "categories.json") {
            print("[CatalogStore] Loaded \(cached.count) categories from cache")
            await MainActor.run { self.categories = cached }
        } else {
            await MainActor.run { self.categories = [] }
        }
    }
    
    private func loadProductsFromCache() async {
        if let cached: [Product] = try? LocalCache.loadJSON([Product].self, from: "products.json") {
            print("[CatalogStore] Loaded \(cached.count) products from cache")
            await MainActor.run { self.products = cached }
        } else {
            await MainActor.run { self.products = [] }
        }
    }

    /// Returns active categories that have at least one product
    var categoriesWithProducts: [Category] {
        categories.filter { category in
            // Check if any product belongs to this category
            products.contains { product in
                product.category_id == category.id
            }
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
        let byName = products.filter {
            (($0.category_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                .caseInsensitiveCompare(trimmed) == .orderedSame)
        }
        if !byName.isEmpty { return byName }
        
        // If no products have category mappings, show all products for first category to avoid empty UI
        let anyWithCategory = products.first(where: { $0.category_id != nil }) != nil
        if !anyWithCategory && categories.first?.name == trimmed {
            print("[CatalogStore] No category mappings found - showing all \(products.count) products under first category")
            return products
        }
        return []
    }

    func prefetchImages(env: EnvironmentStore, concurrency: Int = 4) async {
        let base = await env.baseURL
        let urls: [URL] = products.compactMap { p in
            guard let raw = p.image_url, !raw.isEmpty else { return nil }
            return absoluteURL(base: base, raw: raw)
        }
        let unique = Array(Set(urls))
        guard !unique.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            let lock = NSLock(); var i = 0
            func next() -> URL? { lock.lock(); defer { lock.unlock() }; guard i < unique.count else { return nil }; let u = unique[i]; i += 1; return u }
            for _ in 0..<max(1, min(concurrency, 3)) {
                group.addTask {
                    while let u = next() {
                        // If already cached on disk, skip
                        if ImageDiskCache.shared.hasImage(for: u) { continue }
                        // Try URLCache-first to avoid extra network
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

