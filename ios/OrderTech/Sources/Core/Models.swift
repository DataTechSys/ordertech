import Foundation

// MARK: - Product Models
public struct Product: Codable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let name_localized: [String: String]?
    public let price: Double
    public let imageURL: String?
    public let category: String?
    public let category_id: String?
    public let category_name: String?
    public let description: String?
    public let modifiers: [ModifierGroup]?
    
    // Convenience property for snake_case API compatibility
    public var image_url: String? { imageURL }
    
    public struct ModifierGroup: Codable, Identifiable, Equatable {
        public let id: String
        public let name: String
        public let name_localized: String?
        public let required: Bool
        public let min: Int
        public let max: Int
        public let default_option_ids: [String]? // defaults from pivot
        public let options: [ModifierOption]
        
        public init(id: String, name: String, name_localized: String? = nil, required: Bool, min: Int, max: Int, default_option_ids: [String]? = nil, options: [ModifierOption]) {
            self.id = id
            self.name = name
            self.name_localized = name_localized
            self.required = required
            self.min = min
            self.max = max
            self.default_option_ids = default_option_ids
            self.options = options
        }
    }
    
    public struct ModifierOption: Codable, Identifiable, Equatable {
        public let id: String
        public let name: String
        public let name_localized: String?
        public let price: Double
        
        public init(id: String, name: String, name_localized: String? = nil, price: Double) {
            self.id = id
            self.name = name
            self.name_localized = name_localized
            self.price = price
        }
    }
    
    enum CodingKeys: String, CodingKey {
        case id, name, name_localized, price, category, category_id, category_name, description, modifiers
        case imageURL = "image_url"
    }
    
    public init(id: String, name: String, price: Double, imageURL: String? = nil, category: String? = nil, category_id: String? = nil, category_name: String? = nil, description: String? = nil, name_localized: [String: String]? = nil, modifiers: [ModifierGroup]? = nil) {
        self.id = id
        self.name = name
        self.name_localized = name_localized
        self.price = price
        self.imageURL = imageURL
        self.category = category
        self.category_id = category_id
        self.category_name = category_name
        self.description = description
        self.modifiers = modifiers
    }
}

// MARK: - Category Models
public struct Category: Codable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let reference: String?
    
    public init(id: String, name: String, reference: String? = nil) {
        self.id = id
        self.name = name
        self.reference = reference
    }
}

// MARK: - Brand Model
public struct Brand: Codable {
    public let name: String?
    public let logo_url: String?
    public let primary_color: String?
    public let secondary_color: String?
    
    public init(name: String? = nil, logo_url: String? = nil, primary_color: String? = nil, secondary_color: String? = nil) {
        self.name = name
        self.logo_url = logo_url
        self.primary_color = primary_color
        self.secondary_color = secondary_color
    }
}

// MARK: - Modifier Models
public struct AnyCodableModifierGroup: Codable, Identifiable {
    public let group: Group
    public var options: [Option]
    
    public struct Group: Codable {
        public let id: String
        public let name: String
        public let required: Bool?
        public let min_select: Int?
        public let max_select: Int?
        
        public init(id: String, name: String, required: Bool? = nil, min_select: Int? = nil, max_select: Int? = nil) {
            self.id = id
            self.name = name
            self.required = required
            self.min_select = min_select
            self.max_select = max_select
        }
    }
    
    public struct Option: Codable, Identifiable, Equatable {
        public let id: String
        public let name: String
        public let price: Double
        public var isSelected: Bool
        
        public init(id: String, name: String, price: Double, isSelected: Bool = false) {
            self.id = id
            self.name = name
            self.price = price
            self.isSelected = isSelected
        }
    }
    
    public var id: String { group.id }
    
    public init(group: Group, options: [Option]) {
        self.group = group
        self.options = options
    }
}

// MARK: - Display Presence
public struct DisplayPresenceItem: Codable, Identifiable {
    public let id: String
    public let name: String?
    public let branch: String?
    public let branch_id: String?
    public let online: Bool?
    public let busy: Bool?
    public let last_seen: String?
    
    public init(id: String, name: String? = nil, branch: String? = nil, branch_id: String? = nil, online: Bool? = nil, busy: Bool? = nil, last_seen: String? = nil) {
        self.id = id
        self.name = name
        self.branch = branch
        self.branch_id = branch_id
        self.online = online
        self.busy = busy
        self.last_seen = last_seen
    }
}

// MARK: - WebSocket Event Models
public enum WSEvent: Codable {
    case unknown
    case basketSync(BasketWire)
    case basketUpdate(BasketWire)
    case posterStatus(String)
    case rtcStatus(String)
    case uiSelectCategory(String)
    case uiShowOptions(String)
    case uiScrollTo(String)
    case uiOptionsClose
    case uiOptionsCancel
    case sessionStarted
    case sessionEnded
    case selectCategory(String)
    case selectProduct(String)
    case showOptions(String)
    case closeOptions
    case scrollTo(String)
    
    enum CodingKeys: String, CodingKey {
        case type, data
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        
        switch type {
        case "basket:sync":
            let wire = try container.decode(BasketWire.self, forKey: .data)
            self = .basketSync(wire)
        case "basket:update":
            let wire = try container.decode(BasketWire.self, forKey: .data)
            self = .basketUpdate(wire)
        case "poster:status":
            let status = try container.decode(String.self, forKey: .data)
            self = .posterStatus(status)
        case "rtc:status":
            let status = try container.decode(String.self, forKey: .data)
            self = .rtcStatus(status)
        case "ui:selectCategory":
            let name = try container.decode(String.self, forKey: .data)
            self = .uiSelectCategory(name)
        case "ui:showOptions":
            let id = try container.decode(String.self, forKey: .data)
            self = .uiShowOptions(id)
        case "ui:scrollTo":
            let id = try container.decode(String.self, forKey: .data)
            self = .uiScrollTo(id)
        case "ui:optionsClose":
            self = .uiOptionsClose
        case "ui:optionsCancel":
            self = .uiOptionsCancel
        case "session:started":
            self = .sessionStarted
        case "session:ended":
            self = .sessionEnded
        case "basket":
            let wire = try container.decode(BasketWire.self, forKey: .data)
            self = .basketSync(wire)
        case "selectCategory":
            let name = try container.decode(String.self, forKey: .data)
            self = .selectCategory(name)
        case "selectProduct":
            let id = try container.decode(String.self, forKey: .data)
            self = .selectProduct(id)
        case "showOptions":
            let id = try container.decode(String.self, forKey: .data)
            self = .showOptions(id)
        case "closeOptions":
            self = .closeOptions
        case "scrollTo":
            let id = try container.decode(String.self, forKey: .data)
            self = .scrollTo(id)
        default:
            self = .unknown
        }
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        
        switch self {
        case .unknown:
            try container.encode("unknown", forKey: .type)
        case .basketSync(let wire):
            try container.encode("basket:sync", forKey: .type)
            try container.encode(wire, forKey: .data)
        case .basketUpdate(let wire):
            try container.encode("basket:update", forKey: .type)
            try container.encode(wire, forKey: .data)
        case .posterStatus(let status):
            try container.encode("poster:status", forKey: .type)
            try container.encode(status, forKey: .data)
        case .rtcStatus(let status):
            try container.encode("rtc:status", forKey: .type)
            try container.encode(status, forKey: .data)
        case .uiSelectCategory(let name):
            try container.encode("ui:selectCategory", forKey: .type)
            try container.encode(name, forKey: .data)
        case .uiShowOptions(let id):
            try container.encode("ui:showOptions", forKey: .type)
            try container.encode(id, forKey: .data)
        case .uiScrollTo(let id):
            try container.encode("ui:scrollTo", forKey: .type)
            try container.encode(id, forKey: .data)
        case .uiOptionsClose:
            try container.encode("ui:optionsClose", forKey: .type)
        case .uiOptionsCancel:
            try container.encode("ui:optionsCancel", forKey: .type)
        case .sessionStarted:
            try container.encode("session:started", forKey: .type)
        case .sessionEnded:
            try container.encode("session:ended", forKey: .type)
        case .selectCategory(let name):
            try container.encode("selectCategory", forKey: .type)
            try container.encode(name, forKey: .data)
        case .selectProduct(let id):
            try container.encode("selectProduct", forKey: .type)
            try container.encode(id, forKey: .data)
        case .showOptions(let id):
            try container.encode("showOptions", forKey: .type)
            try container.encode(id, forKey: .data)
        case .closeOptions:
            try container.encode("closeOptions", forKey: .type)
        case .scrollTo(let id):
            try container.encode("scrollTo", forKey: .type)
            try container.encode(id, forKey: .data)
        }
    }
}

// MARK: - Basket Models
public struct BasketWire: Codable {
    public let items: [BasketItemWire]?
    public let totals: BasketTotals?
    public let version: Int?
    
    public init(items: [BasketItemWire]? = nil, totals: BasketTotals? = nil, version: Int? = nil) {
        self.items = items
        self.totals = totals
        self.version = version
    }
}

public struct BasketItemWire: Codable, Identifiable {
    public let id: String?
    public let sku: String?
    public let name: String?
    public let price: Double?
    public let qty: Int?
    public let quantity: Int?
    public let imageURL: String?
    public let image_url: String?
    
    public init(id: String? = nil, sku: String? = nil, name: String? = nil, price: Double? = nil, qty: Int? = nil, quantity: Int? = nil, imageURL: String? = nil, image_url: String? = nil) {
        self.id = id
        self.sku = sku
        self.name = name
        self.price = price
        self.qty = qty
        self.quantity = quantity
        self.imageURL = imageURL
        self.image_url = image_url
    }
}

public struct BasketTotals: Codable {
    public let subtotal: Double
    public let tax: Double
    public let total: Double
    
    public init(subtotal: Double, tax: Double, total: Double) {
        self.subtotal = subtotal
        self.tax = tax
        self.total = total
    }
}

public struct BasketItemBody: Codable {
    public let sku: String
    public let name: String
    public let price: Double
    public let imageURL: String?
    public let modifiers: [Modifier]?
    
    public struct Modifier: Codable {
        public let id: String
        public let name: String
        public let price: Double
        
        public init(id: String, name: String, price: Double) {
            self.id = id
            self.name = name
            self.price = price
        }
    }
    
    public init(sku: String, name: String, price: Double, imageURL: String? = nil, modifiers: [Modifier]? = nil) {
        self.sku = sku
        self.name = name
        self.price = price
        self.imageURL = imageURL
        self.modifiers = modifiers
    }
}

public enum BasketOp: String, Codable {
    case add
    case remove
    case update
    case clear
}

// MARK: - Device Profile
public struct DeviceProfile: Codable {
    public let device_id: String
    public let display_name: String?
    public let branch: String?
    public let short_code: String?
    
    public init(device_id: String, display_name: String? = nil, branch: String? = nil, short_code: String? = nil) {
        self.device_id = device_id
        self.display_name = display_name
        self.branch = branch
        self.short_code = short_code
    }
}

// MARK: - Subscription Models
public struct SubscriptionResponse: Codable {
    public let tenantId: String?
    public let features: [String]?
    public let state: String?
    public let message: String?
    public let expires_at: String?
    public let grace_until: String?
    
    public init(tenantId: String? = nil, features: [String]? = nil, state: String? = nil, message: String? = nil, expires_at: String? = nil, grace_until: String? = nil) {
        self.tenantId = tenantId
        self.features = features
        self.state = state
        self.message = message
        self.expires_at = expires_at
        self.grace_until = grace_until
    }
}

// MARK: - Message Priority
public enum MessagePriority: Int, Codable {
    case low = 0
    case normal = 1
    case high = 2
}

// MARK: - Notifications
public extension Notification.Name {
    static let cashierConnectionStabilized = Notification.Name("cashierConnectionStabilized")
}

// MARK: - Tenant Info
public struct TenantInfo: Codable {
    public let tenant_id: String
    public let branch: String
    public let display_name: String
    
    public init(tenant_id: String, branch: String, display_name: String) {
        self.tenant_id = tenant_id
        self.branch = branch
        self.display_name = display_name
    }
}

// MARK: - Manifest
public struct Manifest: Codable {
    public let tenant_id: String?
    public let brand: Brand?
    public let profile: ManifestProfile?
    
    public struct ManifestProfile: Codable {
        public let display_name: String?
        public let branch: String?
        public let device_name: String?
        
        public init(display_name: String? = nil, branch: String? = nil, device_name: String? = nil) {
            self.display_name = display_name
            self.branch = branch
            self.device_name = device_name
        }
    }
    
    public init(tenant_id: String? = nil, brand: Brand? = nil, profile: ManifestProfile? = nil) {
        self.tenant_id = tenant_id
        self.brand = brand
        self.profile = profile
    }
}
