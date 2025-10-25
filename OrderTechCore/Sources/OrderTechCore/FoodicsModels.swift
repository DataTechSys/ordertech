import Foundation

// MARK: - Foodics v5 API minimal models
// These mirror the fields we consume in apps. Unknown fields are intentionally omitted.

public struct FoodicsPage<T: Decodable>: Decodable {
    public let data: [T]
    public let links: Links?
    public let meta: Meta?
    public struct Links: Decodable { public let first: String?; public let last: String?; public let prev: String?; public let next: String? }
    public struct Meta: Decodable { public let current_page: Int?; public let last_page: Int?; public let per_page: Int?; public let total: Int? }
}

public struct FoodicsCategory: Codable, Identifiable {
    public let id: String
    public let name: String
    public let name_localized: String?
    public let reference: String?
    public let image: String?
    public let is_active: Bool?
    public let deleted_at: String? // ISO timestamp or null

    private enum CodingKeys: String, CodingKey { case id, name, name_localized, reference, image, is_active, deleted_at }

    public init(id: String, name: String, name_localized: String?, reference: String?, image: String?, is_active: Bool?, deleted_at: String?) {
        self.id = id
        self.name = name
        self.name_localized = name_localized
        self.reference = reference
        self.image = image
        self.is_active = is_active
        self.deleted_at = deleted_at
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .id)
        let name = try c.decode(String.self, forKey: .name)
        let name_localized = try? c.decode(String.self, forKey: .name_localized)
        // reference may be String or Number
        var reference: String? = nil
        if let s = try? c.decode(String.self, forKey: .reference) {
            reference = s
        } else if let i = try? c.decode(Int.self, forKey: .reference) {
            reference = String(i)
        } else if let d = try? c.decode(Double.self, forKey: .reference) {
            // Drop trailing .0
            let str = String(d)
            reference = str.hasSuffix(".0") ? String(str.dropLast(2)) : str
        }
        let image = try? c.decode(String.self, forKey: .image)
        // is_active may be Bool/Int/String
        func boolish(_ key: CodingKeys) -> Bool? {
            if let b = try? c.decode(Bool.self, forKey: key) { return b }
            if let i = try? c.decode(Int.self, forKey: key) { return i != 0 }
            if let s = try? c.decode(String.self, forKey: key) {
                let ls = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if ls == "true" || ls == "1" { return true }
                if ls == "false" || ls == "0" { return false }
            }
            return nil
        }
        let is_active = boolish(.is_active)
        let deleted_at = try? c.decode(String.self, forKey: .deleted_at)
        self.init(id: id, name: name, name_localized: name_localized, reference: reference, image: image, is_active: is_active, deleted_at: deleted_at)
    }
}

public struct FoodicsProduct: Codable, Identifiable {
    public let id: String
    public let name: String
    public let name_localized: String?
    public let reference: String?
    public let image: String?
    public let price: Double?
    public let is_active: Bool?
    public let deleted_at: String? // ISO timestamp or null
    // Optional category hints when link table endpoints are unavailable
    public let category_reference: String?
    public let category_id: String?
    // Nested category object when using include=category
    public let category: EmbeddedCategory?
    // Nested modifiers array when using include=modifiers
    public let modifiers: [EmbeddedModifier]?
    
    public struct EmbeddedCategory: Codable {
        public let id: String
        public let name: String?
        public let reference: String?
    }
    
    public struct EmbeddedModifier: Codable {
        public let id: String
        public let name: String
        public let name_localized: String?
        public let reference: String?
        public let is_ready: Int?
        public let deleted_at: String?
        public let pivot: ModifierPivot?
        
        public struct ModifierPivot: Codable {
            public let minimum_options: Int?
            public let maximum_options: Int?
            public let excluded_options_ids: [String]?
            public let default_options_ids: [String]?
            public let free_options: Int?
            public let index: Int? // display order
            public let is_splittable_in_half: Int?
            public let unique_options: Int?
            
            private enum CodingKeys: String, CodingKey { 
                case minimum_options, maximum_options, excluded_options_ids, default_options_ids
                case free_options, index, is_splittable_in_half, unique_options
            }
            
            public init(minimum_options: Int?, maximum_options: Int?, excluded_options_ids: [String]?, default_options_ids: [String]?, free_options: Int? = nil, index: Int? = nil, is_splittable_in_half: Int? = nil, unique_options: Int? = nil) {
                self.minimum_options = minimum_options
                self.maximum_options = maximum_options
                self.excluded_options_ids = excluded_options_ids
                self.default_options_ids = default_options_ids
                self.free_options = free_options
                self.index = index
                self.is_splittable_in_half = is_splittable_in_half
                self.unique_options = unique_options
            }
            
            public init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                func intish(_ key: CodingKeys) -> Int? {
                    if let i = try? c.decode(Int.self, forKey: key) { return i }
                    if let s = try? c.decode(String.self, forKey: key) { return Int(s.trimmingCharacters(in: .whitespacesAndNewlines)) }
                    if let b = try? c.decode(Bool.self, forKey: key) { return b ? 1 : 0 }
                    return nil
                }
                let min = intish(.minimum_options)
                let max = intish(.maximum_options)
                let excluded = try? c.decode([String].self, forKey: .excluded_options_ids)
                let defaults = try? c.decode([String].self, forKey: .default_options_ids)
                let free = intish(.free_options)
                let idx = intish(.index)
                let splittable = intish(.is_splittable_in_half)
                let unique = intish(.unique_options)
                self.init(minimum_options: min, maximum_options: max, excluded_options_ids: excluded, default_options_ids: defaults, free_options: free, index: idx, is_splittable_in_half: splittable, unique_options: unique)
            }
        }
        
        private enum CodingKeys: String, CodingKey { case id, name, name_localized, reference, is_ready, deleted_at, pivot }
        
        public init(id: String, name: String, name_localized: String?, reference: String?, is_ready: Int?, deleted_at: String?, pivot: ModifierPivot?) {
            self.id = id
            self.name = name
            self.name_localized = name_localized
            self.reference = reference
            self.is_ready = is_ready
            self.deleted_at = deleted_at
            self.pivot = pivot
        }
        
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let id = try c.decode(String.self, forKey: .id)
            let name = try c.decode(String.self, forKey: .name)
            let name_localized = try? c.decode(String.self, forKey: .name_localized)
            let reference = try? c.decode(String.self, forKey: .reference)
            func intish(_ key: CodingKeys) -> Int? {
                if let i = try? c.decode(Int.self, forKey: key) { return i }
                if let b = try? c.decode(Bool.self, forKey: key) { return b ? 1 : 0 }
                if let s = try? c.decode(String.self, forKey: key) {
                    let ls = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    if let v = Int(ls) { return v }
                    if ls == "true" { return 1 }
                    if ls == "false" { return 0 }
                }
                return nil
            }
            let is_ready = intish(.is_ready)
            let deleted_at = try? c.decode(String.self, forKey: .deleted_at)
            let pivot = try? c.decode(ModifierPivot.self, forKey: .pivot)
            self.init(id: id, name: name, name_localized: name_localized, reference: reference, is_ready: is_ready, deleted_at: deleted_at, pivot: pivot)
        }
    }
    
    private enum CodingKeys: String, CodingKey {
        case id, name, name_localized, reference, image, price, is_active, deleted_at, category_reference, category_id, category, modifiers
    }
    
    public init(
        id: String,
        name: String,
        name_localized: String?,
        reference: String?,
        image: String?,
        price: Double?,
        is_active: Bool?,
        deleted_at: String?,
        category_reference: String?,
        category_id: String?,
        category: EmbeddedCategory?,
        modifiers: [EmbeddedModifier]?
    ) {
        self.id = id
        self.name = name
        self.name_localized = name_localized
        self.reference = reference
        self.image = image
        self.price = price
        self.is_active = is_active
        self.deleted_at = deleted_at
        self.category_reference = category_reference
        self.category_id = category_id
        self.category = category
        self.modifiers = modifiers
    }
    
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .id)
        let name = try c.decode(String.self, forKey: .name)
        let name_localized = try? c.decode(String.self, forKey: .name_localized)
        let reference = try? c.decode(String.self, forKey: .reference)
        let image = try? c.decode(String.self, forKey: .image)
        
        func decodeDoubleish(_ key: CodingKeys) -> Double? {
            if let d = try? c.decode(Double.self, forKey: key) { return d }
            if let i = try? c.decode(Int.self, forKey: key) { return Double(i) }
            if let s = try? c.decode(String.self, forKey: key) {
                let norm = s.trimmingCharacters(in: .whitespacesAndNewlines)
                return Double(norm)
            }
            return nil
        }
        let price = decodeDoubleish(.price)
        
        func decodeBoolish(_ key: CodingKeys) -> Bool? {
            if let b = try? c.decode(Bool.self, forKey: key) { return b }
            if let i = try? c.decode(Int.self, forKey: key) { return i != 0 }
            if let s = try? c.decode(String.self, forKey: key) {
                let ls = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if ls == "true" || ls == "1" { return true }
                if ls == "false" || ls == "0" { return false }
            }
            return nil
        }
        let is_active = decodeBoolish(.is_active)
        
        let deleted_at = try? c.decode(String.self, forKey: .deleted_at)
        let category_reference = try? c.decode(String.self, forKey: .category_reference)
        let category_id = try? c.decode(String.self, forKey: .category_id)
        let category = try? c.decode(EmbeddedCategory.self, forKey: .category)
        let modifiers = try? c.decode([EmbeddedModifier].self, forKey: .modifiers)
        
        self.init(
            id: id,
            name: name,
            name_localized: name_localized,
            reference: reference,
            image: image,
            price: price,
            is_active: is_active,
            deleted_at: deleted_at,
            category_reference: category_reference,
            category_id: category_id,
            category: category,
            modifiers: modifiers
        )
    }
    // Price at v5 may be exposed via price tags; we keep minimal fields and enrich from other endpoints later if needed.
}

// Link table: assigns a product to a category (many-to-many in some catalogs; we select primary during import)
public struct FoodicsProductCategoryLink: Codable, Identifiable {
    public let id: String // synthetic product_id:category_id
    public let product_id: String
    public let category_id: String

    public init(product_id: String, category_id: String) {
        self.product_id = product_id
        self.category_id = category_id
        self.id = product_id + ":" + category_id
    }
}

public struct FoodicsModifierGroup: Codable, Identifiable {
    public let id: String
    public let name: String
    public let name_localized: String?
    public let reference: String?
    public let sku: String?
    public let is_active: Int?
    public let is_ready: Int?
    public let deleted_at: String?
    
    private enum CodingKeys: String, CodingKey {
        case id, name, name_localized, reference, sku, is_active, is_ready, deleted_at
    }
    
    public init(id: String, name: String, name_localized: String?, reference: String?, sku: String?, is_active: Int?, is_ready: Int?, deleted_at: String?) {
        self.id = id
        self.name = name
        self.name_localized = name_localized
        self.reference = reference
        self.sku = sku
        self.is_active = is_active
        self.is_ready = is_ready
        self.deleted_at = deleted_at
    }
    
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.name = try c.decode(String.self, forKey: .name)
        self.name_localized = try? c.decode(String.self, forKey: .name_localized)
        self.reference = try? c.decode(String.self, forKey: .reference)
        self.sku = try? c.decode(String.self, forKey: .sku)
        
        func decodeIntish(_ key: CodingKeys) -> Int? {
            if let i = try? c.decode(Int.self, forKey: key) { return i }
            if let b = try? c.decode(Bool.self, forKey: key) { return b ? 1 : 0 }
            if let s = try? c.decode(String.self, forKey: key) {
                let ls = s.lowercased()
                if let v = Int(ls) { return v }
                if ls == "true" { return 1 }
                if ls == "false" { return 0 }
            }
            return nil
        }
        
        self.is_active = decodeIntish(.is_active)
        self.is_ready = decodeIntish(.is_ready)
        self.deleted_at = try? c.decode(String.self, forKey: .deleted_at)
    }
}

public struct FoodicsModifierOption: Codable, Identifiable {
    public let id: String
    public let name: String
    public let name_localized: String?
    public let reference: String?
    public let sku: String?
    public let price: Double?
    public let modifier_id: String?
    public let is_active: Int?
    public let is_ready: Int?
    public let deleted_at: String?
    public let modifier: FoodicsModifierGroup? // embedded when include=modifier
    
    private enum CodingKeys: String, CodingKey {
        case id, name, name_localized, reference, sku, price, modifier_id, is_active, is_ready, deleted_at, modifier
    }
    
    public init(id: String, name: String, name_localized: String?, reference: String?, sku: String?, price: Double?, modifier_id: String?, is_active: Int?, is_ready: Int?, deleted_at: String?, modifier: FoodicsModifierGroup? = nil) {
        self.id = id
        self.name = name
        self.name_localized = name_localized
        self.reference = reference
        self.sku = sku
        self.price = price
        self.modifier_id = modifier_id
        self.is_active = is_active
        self.is_ready = is_ready
        self.deleted_at = deleted_at
        self.modifier = modifier
    }
    
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.name = try c.decode(String.self, forKey: .name)
        self.name_localized = try? c.decode(String.self, forKey: .name_localized)
        self.reference = try? c.decode(String.self, forKey: .reference)
        self.sku = try? c.decode(String.self, forKey: .sku)
        // price can be number or string
        if let p = try? c.decode(Double.self, forKey: .price) {
            self.price = p
        } else if let s = try? c.decode(String.self, forKey: .price), let d = Double(s) {
            self.price = d
        } else {
            self.price = nil
        }
        self.modifier_id = try? c.decode(String.self, forKey: .modifier_id)
        // is_active and is_ready might be Int, Bool, or String
        func decodeIntish(_ key: CodingKeys) -> Int? {
            if let i = try? c.decode(Int.self, forKey: key) { return i }
            if let b = try? c.decode(Bool.self, forKey: key) { return b ? 1 : 0 }
            if let s = try? c.decode(String.self, forKey: key) {
                let ls = s.lowercased()
                if let v = Int(ls) { return v }
                if ls == "true" { return 1 }
                if ls == "false" { return 0 }
            }
            return nil
        }
        self.is_active = decodeIntish(.is_active)
        self.is_ready = decodeIntish(.is_ready)
        self.deleted_at = try? c.decode(String.self, forKey: .deleted_at)
        self.modifier = try? c.decode(FoodicsModifierGroup.self, forKey: .modifier)
    }
}

// Links a product to a modifier group with constraints
public struct FoodicsProductModifierGroup: Codable, Identifiable {
    public let id: String // synthetic "productId:groupId" or server id if provided
    public let product_id: String
    public let modifier_id: String // group id in API is often "modifier id" at v5
    public let min: Int?
    public let max: Int?
    public let required: Bool?

    public init(product_id: String, modifier_id: String, min: Int?, max: Int?, required: Bool?) {
        self.product_id = product_id
        self.modifier_id = modifier_id
        self.min = min
        self.max = max
        self.required = required
        self.id = product_id + ":" + modifier_id
    }
}

// Mapped relations for app UI
public struct FoodicsMappedGroup: Codable, Identifiable {
    public let id: String
    public let name: String
    public let required: Bool
    public let min: Int
    public let max: Int
    public let options: [FoodicsMappedOption]
}

public struct FoodicsMappedOption: Codable, Identifiable {
    public let id: String
    public let name: String
    public let price: Double?
}

// For caching product -> groups mapping as an array (Codable-friendly)
public struct FoodicsProductGroupsEntry: Codable {
    public let product_id: String
    public let groups: [FoodicsMappedGroup]
}
