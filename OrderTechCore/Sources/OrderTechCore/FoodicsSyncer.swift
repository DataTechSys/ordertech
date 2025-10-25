import Foundation

@available(iOS 16.0, macOS 12.0, *)
public struct FoodicsSyncResult: Codable {
    public let categories: Int
    public let products: Int
    public let groups: Int
    public let options: Int
    public let assignments: Int
    public let syncedAt: Date
}

@available(iOS 16.0, macOS 12.0, *)
public enum FoodicsSyncer {
    public static func syncAll(token: String) async throws -> FoodicsSyncResult {
        let client = FoodicsClient(token: token)
        async let catsTask = client.listCategories(perPage: 200)
        async let prodsTask = client.listProducts(perPage: 200)
        async let groupsTask = client.listModifierGroups(perPage: 200)
        async let optsTask = client.listModifierOptions(perPage: 200)
        async let assignsTask = client.listProductModifierGroups(perPage: 200)
        async let prodCatTask = client.listProductCategoryLinks(perPage: 500)

        let (cats, prods, groups, opts, assigns, prodCats) = try await (catsTask, prodsTask, groupsTask, optsTask, assignsTask, prodCatTask)

        try FoodicsCacheStore.save(cats, as: "categories.json")
        try FoodicsCacheStore.save(prods, as: "products.json")
        try FoodicsCacheStore.save(groups, as: "modifier_groups.json")
        try FoodicsCacheStore.save(opts, as: "modifier_options.json")
        try FoodicsCacheStore.save(assigns, as: "product_modifier_groups.json")
        try FoodicsCacheStore.save(prodCats, as: "product_categories.json")

        // Build derived relations for quick lookup and cache them too
        let mapping = FoodicsRelations.buildProductGroups(products: prods, groups: groups, options: opts, assignments: assigns)
        let entries = mapping.map { FoodicsProductGroupsEntry(product_id: $0.key, groups: $0.value) }
        try FoodicsCacheStore.save(entries, as: "product_groups_map.json")

        return FoodicsSyncResult(
            categories: cats.count,
            products: prods.count,
            groups: groups.count,
            options: opts.count,
            assignments: assigns.count,
            syncedAt: Date()
        )
    }
}
