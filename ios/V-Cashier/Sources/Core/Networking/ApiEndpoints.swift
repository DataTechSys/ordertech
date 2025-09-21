import Foundation

struct Brand: Decodable {
    let display_name: String?
    let logo_url: String?
    let color_primary: String?
    let color_secondary: String?
}

struct Category: Decodable, Identifiable {
    let id: String
    let name: String
    let image: String?
}

struct Product: Decodable, Identifiable {
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

struct AnyModifierResponse: Decodable {
    let items: [AnyCodableModifierGroup]
}

struct AnyCodableModifierGroup: Decodable, Identifiable {
    let group: Group
    let options: [Option]
    struct Group: Decodable {
        let id: String
        let name: String
        let required: Bool?
        let min_select: Int?
        let max_select: Int?
        private enum CodingKeys: String, CodingKey { case id = "group_id", name, required, min_select, max_select }
    }
    struct Option: Decodable, Identifiable {
        let id: String
        let name: String
        let price: Double?
        private enum CodingKeys: String, CodingKey { case id, name, price }
        init(id: String, name: String, price: Double?) { self.id = id; self.name = name; self.price = price }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.id = try c.decode(String.self, forKey: .id)
            self.name = try c.decode(String.self, forKey: .name)
            if let d = try? c.decode(Double.self, forKey: .price) {
                self.price = d
            } else if let s = try? c.decode(String.self, forKey: .price), let d = Double(s) {
                self.price = d
            } else {
                self.price = nil
            }
        }
    }
    var id: String { group.id }
}

extension HttpClient {
    func fetchBrand() async throws -> Brand { try await request("/brand") }
    func fetchCategories() async throws -> [Category] { try await request("/categories") }
    func fetchProducts(categoryName: String? = nil) async throws -> [Product] {
        // Block if activation is required and not completed
        let requireActivation = await env.requireActivation
        let token = await env.deviceToken
        if requireActivation && (token ?? "").isEmpty { return [] }
        let path: String
        if let c = categoryName, !c.isEmpty {
            let esc = c.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? c
            path = "/products?category_name=\(esc)"
        } else {
            path = "/products"
        }
        return try await request(path)
    }
    func fetchModifiers(for productId: String) async throws -> [AnyCodableModifierGroup] {
        try await request("/products/\(productId)/modifiers", decode: AnyModifierResponse.self).items
    }
}

