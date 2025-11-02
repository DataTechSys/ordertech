import Foundation
import OrderTechCore

/// A stable, cacheable reference table that maps modifier group references to their available options (by SKU).
/// This provides a robust way to handle Foodics modifiers since `modifier_id` is not reliably returned by the API.
public struct ModifierReferenceTable: Codable {
    /// Maps modifier group reference (e.g., "hot_milk", "coffee_shot") to group metadata
    public var groups: [String: GroupEntry]
    
    /// Maps option SKU to option metadata
    public var options: [String: OptionEntry]
    
    /// Last updated timestamp
    public var lastUpdated: Date
    
    public struct GroupEntry: Codable {
        public let id: String
        public let name: String
        public let nameLocalized: String?
        public let reference: String
        public let sku: String?
        /// All option SKUs that belong to this group (active only)
        public var optionSKUs: [String]
        
        public init(id: String, name: String, nameLocalized: String?, reference: String, sku: String?, optionSKUs: [String]) {
            self.id = id
            self.name = name
            self.nameLocalized = nameLocalized
            self.reference = reference
            self.sku = sku
            self.optionSKUs = optionSKUs
        }
    }
    
    public struct OptionEntry: Codable {
        public let id: String
        public let name: String
        public let nameLocalized: String?
        public let sku: String
        public let price: Double
        public let groupReference: String // which group this option belongs to
        
        public init(id: String, name: String, nameLocalized: String?, sku: String, price: Double, groupReference: String) {
            self.id = id
            self.name = name
            self.nameLocalized = nameLocalized
            self.sku = sku
            self.price = price
            self.groupReference = groupReference
        }
    }
    
    public init(groups: [String: GroupEntry] = [:], options: [String: OptionEntry] = [:], lastUpdated: Date = Date()) {
        self.groups = groups
        self.options = options
        self.lastUpdated = lastUpdated
    }
    
    /// Build the reference table from Foodics API data and products
    /// This discovers options via two methods:
    /// 1. Options with `modifier_id` field set (direct group membership)
    /// 2. Options found in product `excluded_options_ids` (inferred group membership)
    public static func build(
        from modifierGroups: [OrderTechCore.FoodicsModifierGroup],
        options: [OrderTechCore.FoodicsModifierOption],
        products: [OrderTechCore.FoodicsProduct] = []
    ) -> ModifierReferenceTable {
        var table = ModifierReferenceTable()
        
        // Filter active groups with references
        let activeGroups = modifierGroups.filter { g in
            let active = (g.is_active ?? 1) == 1
            let ready = (g.is_ready ?? 1) == 1
            let notDeleted = (g.deleted_at == nil) || ((g.deleted_at ?? "").isEmpty)
            let hasRef = !(g.reference ?? "").isEmpty
            return active && ready && notDeleted && hasRef
        }
        
        // Filter active options with SKUs
        let activeOptions = options.filter { opt in
            let active = (opt.is_active ?? 1) == 1
            let ready = (opt.is_ready ?? 1) == 1
            let notDeleted = (opt.deleted_at == nil) || ((opt.deleted_at ?? "").isEmpty)
            let hasSKU = !(opt.sku ?? "").isEmpty
            return active && ready && notDeleted && hasSKU
        }
        
        // Build group reference → ID map and ID → reference map
        var groupIdByReference: [String: String] = [:]
        var groupRefById: [String: String] = [:]
        for group in activeGroups {
            if let ref = group.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !ref.isEmpty {
                groupIdByReference[ref] = group.id
                groupRefById[group.id] = ref
            }
        }
        
        // Build option ID → option lookup
        var optionById: [String: OrderTechCore.FoodicsModifierOption] = [:]
        for option in activeOptions {
            optionById[option.id] = option
        }
        
        // Map options to groups using product embeddings
        // Key insight: Products contain embedded modifiers with excluded_options_ids.
        // By collecting all mentioned option IDs (excluded OR implicitly included) per group, we infer group membership.
        var optionsByGroupRef: [String: Set<String>] = [:] // groupRef → Set of option IDs
        
        print("[ModifierReferenceTable] Analyzing \(products.count) products for option-to-group mapping...")
        
        // Build group ID to reference mapping first
        var groupIdToRef: [String: String] = [:]
        for group in activeGroups {
            if let ref = group.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !ref.isEmpty {
                groupIdToRef[group.id] = ref
            }
        }
        
        // For each product, collect ALL option IDs mentioned in each modifier group
        // This includes both excluded AND potentially included (default) options
        for product in products {
            guard let embeddedMods = product.modifiers, !embeddedMods.isEmpty else { continue }
            
            for mod in embeddedMods {
                // Get group reference
                guard let groupRef = mod.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                      !groupRef.isEmpty else { continue }
                
                // Collect excluded option IDs - these definitely belong to this group
                if let excludedIds = mod.pivot?.excluded_options_ids, !excludedIds.isEmpty {
                    for optId in excludedIds {
                        if optionById[optId] != nil {
                            optionsByGroupRef[groupRef, default: []].insert(optId)
                        }
                    }
                }
                
                // ALSO collect default/included option IDs - these are always available
                if let defaultIds = mod.pivot?.default_options_ids, !defaultIds.isEmpty {
                    for optId in defaultIds {
                        if optionById[optId] != nil {
                            optionsByGroupRef[groupRef, default: []].insert(optId)
                        }
                    }
                }
            }
        }
        
        // IMPORTANT: Also add any options that have modifier_id or embedded modifier pointing to the group
        // This catches options that are never excluded (always available)
        var optionsAddedViaModifierId = 0
        var optionsAddedViaEmbedded = 0
        var optionsWithoutAnyGroupInfo = 0
        
        for option in activeOptions {
            var added = false
            
            // Priority 1: Use embedded modifier object (from include=modifier)
            if let embeddedMod = option.modifier,
               let ref = embeddedMod.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
               !ref.isEmpty {
                let wasNew = !optionsByGroupRef[ref, default: []].contains(option.id)
                optionsByGroupRef[ref, default: []].insert(option.id)
                if wasNew { optionsAddedViaEmbedded += 1 }
                added = true
            }
            // Priority 2: Use modifier_id field
            else if let modId = option.modifier_id, !modId.isEmpty, let groupRef = groupIdToRef[modId] {
                let wasNew = !optionsByGroupRef[groupRef, default: []].contains(option.id)
                optionsByGroupRef[groupRef, default: []].insert(option.id)
                if wasNew { optionsAddedViaModifierId += 1 }
                added = true
            }
            
            if !added {
                optionsWithoutAnyGroupInfo += 1
            }
        }
        
        print("[ModifierReferenceTable] Options via embedded: \(optionsAddedViaEmbedded), via modifier_id: \(optionsAddedViaModifierId), without group info: \(optionsWithoutAnyGroupInfo)")
        print("[ModifierReferenceTable] Discovered \(optionsByGroupRef.values.flatMap { $0 }.count) total option assignments")
        
        print("[ModifierReferenceTable] Mapped \(optionsByGroupRef.count) groups")
        
        // Convert option IDs to option objects
        var optionsByGroupRefFinal: [String: [OrderTechCore.FoodicsModifierOption]] = [:]
        for (groupRef, optionIds) in optionsByGroupRef {
            let opts = optionIds.compactMap { optionById[$0] }
            if !opts.isEmpty {
                optionsByGroupRefFinal[groupRef] = opts
            }
        }
        
        // Build the table entries
        for group in activeGroups {
            guard let groupRef = group.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                  !groupRef.isEmpty else { continue }
            
            let groupOptions = optionsByGroupRefFinal[groupRef] ?? []
            let optionSKUs = groupOptions.compactMap { $0.sku }
            
            // Debug: Log detailed info for hot_milk group
            if groupRef == "hot_milk" {
                print("[ModifierReferenceTable] DEBUG hot_milk: found \(groupOptions.count) options")
                for opt in groupOptions {
                    print("[ModifierReferenceTable] DEBUG   - \(opt.name) (SKU: \(opt.sku ?? "none"))")
                }
            }
            
            table.groups[groupRef] = GroupEntry(
                id: group.id,
                name: group.name,
                nameLocalized: group.name_localized,
                reference: groupRef,
                sku: group.sku,
                optionSKUs: optionSKUs
            )
            
            // Add options to the table
            for option in groupOptions {
                guard let sku = option.sku else { continue }
                table.options[sku] = OptionEntry(
                    id: option.id,
                    name: option.name,
                    nameLocalized: option.name_localized,
                    sku: sku,
                    price: option.price ?? 0,
                    groupReference: groupRef
                )
            }
        }
        
        print("[ModifierReferenceTable] Built table with \(table.groups.count) groups and \(table.options.count) options")
        for (ref, group) in table.groups.sorted(by: { $0.key < $1.key }) {
            print("[ModifierReferenceTable]   \(ref): \(group.name) → \(group.optionSKUs.count) options")
        }
        
        return table
    }
    
    /// Build the reference table by fetching options per group from the Foodics API
    /// This ensures all options are discovered, including those never excluded
    @available(iOS 16.0, macOS 12.0, *)
    public static func buildFromAPI(
        client: OrderTechCore.FoodicsClient,
        modifierGroups: [OrderTechCore.FoodicsModifierGroup]
    ) async throws -> ModifierReferenceTable {
        var table = ModifierReferenceTable()
        
        // Filter active groups with references
        let activeGroups = modifierGroups.filter { g in
            let active = (g.is_active ?? 1) == 1
            let ready = (g.is_ready ?? 1) == 1
            let notDeleted = (g.deleted_at == nil) || ((g.deleted_at ?? "").isEmpty)
            let hasRef = !(g.reference ?? "").isEmpty
            return active && ready && notDeleted && hasRef
        }
        
        print("[ModifierReferenceTable] Building from API for \(activeGroups.count) active groups...")
        
        // Fetch options for each group
        for group in activeGroups {
            guard let groupRef = group.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                  !groupRef.isEmpty else { continue }
            
            do {
                let groupOptions = try await client.listModifierOptionsForGroup(groupId: group.id)
                
                // Filter active options with SKUs
                let activeOptions = groupOptions.filter { opt in
                    let active = (opt.is_active ?? 1) == 1
                    let ready = (opt.is_ready ?? 1) == 1
                    let notDeleted = (opt.deleted_at == nil) || ((opt.deleted_at ?? "").isEmpty)
                    let hasSKU = !(opt.sku ?? "").isEmpty
                    return active && ready && notDeleted && hasSKU
                }
                
                let optionSKUs = activeOptions.compactMap { $0.sku }
                
                print("[ModifierReferenceTable]   \(groupRef): \(group.name) → \(activeOptions.count) options")
                
                // Add group entry
                table.groups[groupRef] = GroupEntry(
                    id: group.id,
                    name: group.name,
                    nameLocalized: group.name_localized,
                    reference: groupRef,
                    sku: group.sku,
                    optionSKUs: optionSKUs
                )
                
                // Add option entries
                for option in activeOptions {
                    guard let sku = option.sku else { continue }
                    table.options[sku] = OptionEntry(
                        id: option.id,
                        name: option.name,
                        nameLocalized: option.name_localized,
                        sku: sku,
                        price: option.price ?? 0,
                        groupReference: groupRef
                    )
                }
            } catch {
                print("[ModifierReferenceTable] ERROR fetching options for group \(group.name) (\(group.id)): \(error)")
                // Continue with other groups even if one fails
            }
        }
        
        print("[ModifierReferenceTable] Built table with \(table.groups.count) groups and \(table.options.count) options")
        
        return table
    }
    
    /// Get options for a specific product based on its embedded modifiers and exclusion lists
    /// Respects all product-specific pivot fields:
    /// - `index`: Display order of modifier groups
    /// - `minimum_options` / `maximum_options`: Selection constraints
    /// - `excluded_options_ids`: Product-specific option exclusions
    /// - `default_options_ids`: Pre-selected options
    /// - `free_options`: Number of free option selections (parsed but not yet used in UI)
    public func resolveModifiersForProduct(
        embeddedModifiers: [OrderTechCore.FoodicsProduct.EmbeddedModifier]
    ) -> [Product.ModifierGroup] {
        // Create tuples with (index, ModifierGroup) to preserve sort order
        var groupsWithIndex: [(index: Int, group: Product.ModifierGroup)] = []
        
        for embeddedMod in embeddedModifiers {
            // Skip deleted or not-ready groups
            if let d = embeddedMod.deleted_at, !d.isEmpty { continue }
            if (embeddedMod.is_ready ?? 1) != 1 { continue }
            
            // Skip delivery groups
            let lname = embeddedMod.name.lowercased()
            let lref = (embeddedMod.reference ?? "").lowercased()
            if lname.contains("delivery") || lref.contains("delivery") { continue }
            
            // Find group in our reference table
            guard let groupRef = embeddedMod.reference?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                  !groupRef.isEmpty,
                  let groupEntry = groups[groupRef] else {
                print("[ModifierReferenceTable] WARN: No group found for ref=\(embeddedMod.reference ?? "nil") name=\(embeddedMod.name)")
                continue
            }
            
            // Get excluded option IDs from pivot
            let excludedIds = Set(embeddedMod.pivot?.excluded_options_ids ?? [])
            
            // Get all options for this group and filter out product-specific exclusions
            let availableOptions: [Product.ModifierOption] = groupEntry.optionSKUs.compactMap { sku in
                guard let optionEntry = options[sku] else { return nil }
                
                // Skip if this option is excluded for this specific product
                if excludedIds.contains(optionEntry.id) {
                    return nil
                }
                
                return Product.ModifierOption(
                    id: optionEntry.id,
                    name: optionEntry.name,
                    name_localized: optionEntry.nameLocalized,
                    price: optionEntry.price
                )
            }
            
            // Skip groups with no available options
            if availableOptions.isEmpty {
                print("[ModifierReferenceTable] WARN: Group \(groupEntry.name) has no available options after filtering")
                continue
            }
            
            // Debug Hot Milk specifically
            if lref == "hot_milk" || lname.contains("hot milk") {
                let totalInGroup = groupEntry.optionSKUs.count
                print("[ModifierReferenceTable][HotMilk] Group has \(totalInGroup) total options, \(excludedIds.count) excluded, \(availableOptions.count) available")
            }
            
            let modGroup = Product.ModifierGroup(
                id: groupEntry.id,
                name: groupEntry.name,
                name_localized: groupEntry.nameLocalized,
                required: (embeddedMod.pivot?.minimum_options ?? 0) > 0,
                min: embeddedMod.pivot?.minimum_options ?? 0,
                max: embeddedMod.pivot?.maximum_options ?? 1,
                default_option_ids: embeddedMod.pivot?.default_options_ids,
                options: availableOptions
            )
            
            // Use pivot index for sorting (default to large number if not specified)
            let sortIndex = embeddedMod.pivot?.index ?? 999
            #if DEBUG
            print("[ModifierReferenceTable] Group '\(groupEntry.name)' has index=\(sortIndex)")
            #endif
            groupsWithIndex.append((index: sortIndex, group: modGroup))
        }
        
        // Sort by index and return groups
        return groupsWithIndex.sorted(by: { $0.index < $1.index }).map { $0.group }
    }
}
