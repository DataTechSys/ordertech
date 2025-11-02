import Foundation
import OrderTechCore

// Backend DTOs used by Display app
struct RTCAuthToken: Decodable { let token: String?; let url: String? }

extension HttpClient {
    // Obtain an SFU access token (e.g., LiveKit) for the given basket (pair) and role
    func rtcToken(provider: String, basketId: String, role: String, deviceId: String? = nil) async throws -> RTCAuthToken {
        struct Body: Encodable { let provider: String; let basketId: String; let role: String; let deviceId: String? }
        let body = try JSONEncoder().encode(Body(provider: provider, basketId: basketId, role: role, deviceId: deviceId))
        return try await request("/rtc/token", method: "POST", body: body)
    }
}

// MARK: - Modifiers API and models (DisplayApp)
struct DisplayModifierResponse: Decodable { let items: [DisplayModifierGroup] }

struct DisplayModifierGroup: Decodable, Identifiable {
    let group: Group
    let options: [Option]
    struct Group: Decodable {
        let id: String
        let name: String
        let name_localized: String?
        let required: Bool?
        let min_select: Int?
        let max_select: Int?
        private enum CodingKeys: String, CodingKey { case id = "group_id", name, name_localized, required, min_select, max_select }
    }
    struct Option: Decodable, Identifiable {
        let id: String
        let name: String
        let name_localized: String?
        let price: Double?
        private enum CodingKeys: String, CodingKey { case id, name, name_localized, price }
        init(id: String, name: String, name_localized: String? = nil, price: Double?) { self.id = id; self.name = name; self.name_localized = name_localized; self.price = price }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.id = try c.decode(String.self, forKey: .id)
            self.name = try c.decode(String.self, forKey: .name)
            self.name_localized = try c.decodeIfPresent(String.self, forKey: .name_localized)
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
    func fetchModifiers(for productId: String) async throws -> [DisplayModifierGroup] {
        // Foodics-only mode: when a Foodics token exists, fetch directly from Foodics
        let tok = await env.foodicsToken
        if let token = tok, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if #available(iOS 16.0, *) {
                do {
                    let client = FoodicsClient(token: token)
                    // Fetch assignments, groups, and options once; then compose per-product
                    async let aTask = client.listProductModifierGroups()
                    async let gTask = client.listModifierGroups()
                    async let oTask = client.listModifierOptions()
                    let (assignments, groups, options) = try await (aTask, gTask, oTask)
                    // Map groups by id
                    let gById = Dictionary(uniqueKeysWithValues: groups.map { ($0.id, $0) })
                    // Compose DisplayModifierGroup for this product
                    var out: [DisplayModifierGroup] = []
                    for a in assignments where a.product_id == productId {
                        guard let g = gById[a.modifier_id] else { continue }
                        // Hide delivery groups entirely
                        let gn = g.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                        let gr = (g.reference ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                        if gn.contains("delivery") || gr.contains("delivery") { continue }
                        // Options for this group (ONLY active/ready and not soft-deleted)
                        let opts = options.filter { ($0.modifier_id ?? "") == g.id }
                            .filter { ($0.is_active ?? 1) != 0 }
                            .filter { ($0.is_ready ?? 1) != 0 }
                            .filter { ($0.deleted_at ?? "").isEmpty }
                            .map { DisplayModifierGroup.Option(id: $0.id, name: $0.name, name_localized: $0.name_localized, price: $0.price) }
                        // Skip empty groups
                        if opts.isEmpty { continue }
                        let minSel = a.min ?? ((a.required ?? false) ? 1 : nil)
                        let maxSel = a.max
                        let group = DisplayModifierGroup.Group(id: g.id, name: g.name, name_localized: g.name_localized, required: a.required, min_select: minSel, max_select: maxSel)
                        out.append(DisplayModifierGroup(group: group, options: opts))
                    }
                    return out
                } catch {
                    // Fall back to backend if Foodics call fails
                }
            }
        }
        return try await request("/products/\(productId)/modifiers", decode: DisplayModifierResponse.self).items
    }
    
    func fetchSubscription() async throws -> SubscriptionResponse {
        // Stub implementation - return default active state
        return SubscriptionResponse(tenantId: nil, features: [], state: "active", message: nil, expires_at: nil, grace_until: nil)
    }
    
    func fetchDeviceProfile() async throws -> DeviceProfile {
        return try await request("/device/profile")
    }
    
    func fetchProducts(categoryName: String?) async throws -> [Product] {
        struct ProductsResp: Decodable { let items: [Product]? }
        if let category = categoryName, !category.isEmpty {
            if let arr: [Product] = try? await request("/products?category=\(category)") { return arr }
            if let resp: ProductsResp = try? await request("/products?category=\(category)", decode: ProductsResp.self) { return resp.items ?? [] }
        } else {
            if let arr: [Product] = try? await request("/products") { return arr }
            if let resp: ProductsResp = try? await request("/products", decode: ProductsResp.self) { return resp.items ?? [] }
        }
        return []
    }
    
    func fetchCategories() async throws -> [Category] {
        struct CategoriesResp: Decodable { let items: [Category]? }
        if let arr: [Category] = try? await request("/categories") { return arr }
        if let resp: CategoriesResp = try? await request("/categories", decode: CategoriesResp.self) { return resp.items ?? [] }
        return []
    }
    
    func fetchBrand() async throws -> Brand {
        return try await request("/brand")
    }
    
    struct EmptyResponse: Codable {}
    
    func sessionStart(pairId: String) async throws {
        let _: EmptyResponse? = try? await request("/session/\(pairId)/start", method: "POST")
    }
    
    func sessionPay(pairId: String) async throws {
        let _: EmptyResponse? = try? await request("/session/\(pairId)/pay", method: "POST")
    }
    
    func sessionReset(pairId: String) async throws {
        let _: EmptyResponse? = try? await request("/session/\(pairId)/reset", method: "POST")
    }
    
    func presenceDisplays() async throws -> [DisplayPresenceItem] {
        struct Response: Decodable { let items: [DisplayPresenceItem] }
        let response: Response = try await request("/presence/displays")
        return response.items
    }
    
    func posterStart(pairId: String) async throws {
        let _: EmptyResponse? = try? await request("/session/\(pairId)/poster/start", method: "POST")
    }
    
    func posterStop(pairId: String) async throws {
        let _: EmptyResponse? = try? await request("/session/\(pairId)/poster/stop", method: "POST")
    }
    
    struct PosterStatusResponse: Codable {
        let poster_active: Bool?
    }
    
    func getPosterStatus(pairId: String) async throws -> PosterStatusResponse {
        return try await request("/session/\(pairId)/poster/status")
    }
    
    func deleteRTCSession(pairId: String, reason: String) async throws {
        let _: EmptyResponse? = try? await request("/rtc/session/\(pairId)?reason=\(reason)", method: "DELETE")
    }
    
    func getWebRTCConfig() async throws -> [String: Any] {
        // Stub - return empty config
        return [:]
    }
}
