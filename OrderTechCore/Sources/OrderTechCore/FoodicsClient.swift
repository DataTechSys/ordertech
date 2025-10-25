import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@available(iOS 16.0, macOS 12.0, *)
public final class FoodicsClient {
    public let baseURL: URL
    private let token: String
    private let session: URLSession

    public init(baseURL: URL = URL(string: "https://api.foodics.com/v5")!, token: String, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if let s = session { self.session = s } else {
            let cfg = URLSessionConfiguration.default
            cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
            cfg.urlCache = nil
            cfg.httpShouldUsePipelining = true
            self.session = URLSession(configuration: cfg)
        }
    }

    // MARK: - Public list helpers

    public func listCategories(perPage: Int = 100) async throws -> [FoodicsCategory] {
        try await listAllWithVersionAndPathFallback(paths: [
            "/categories",
            "/menu/categories"
        ], perPage: perPage)
    }

public func listProducts(perPage: Int = 100) async throws -> [FoodicsProduct] {
        try await listAllWithVersionAndPathFallback(paths: [
            "/products?include=category,modifiers",
            "/menu/products?include=category,modifiers"
        ], perPage: perPage)
    }
    
    // Strict variant: do NOT fall back to a path that omits modifiers
    public func listProductsWithModifiersStrict(perPage: Int = 100) async throws -> [FoodicsProduct] {
        try await listAll(path: "/products?include=category,modifiers", perPage: perPage)
    }

    public func listModifierGroups(perPage: Int = 100) async throws -> [FoodicsModifierGroup] {
        try await listAllWithVersionAndPathFallback(paths: [
            "/modifiers",
            "/modifier_groups",
            "/menu/modifiers",
            "/menu/modifier_groups"
        ], perPage: perPage)
    }

    public func listModifierOptions(perPage: Int = 100) async throws -> [FoodicsModifierOption] {
        // Try with include=modifier first to get the modifier_id relationship
        try await listAllWithVersionAndPathFallback(paths: [
            "/modifier_options?include=modifier",
            "/modifier_options",
            "/modifiers/options?include=modifier",
            "/modifiers/options",
            "/menu/modifier_options?include=modifier",
            "/menu/modifier_options"
        ], perPage: perPage)
    }
    
    /// Fetch all modifier options for a specific modifier group
    public func listModifierOptionsForGroup(groupId: String, perPage: Int = 100) async throws -> [FoodicsModifierOption] {
        // Try different API path patterns to fetch options for a specific group
        try await listAllWithVersionAndPathFallback(paths: [
            "/modifiers/\(groupId)/options",
            "/modifier_groups/\(groupId)/options",
            "/modifiers/\(groupId)/modifier_options"
        ], perPage: perPage)
    }

    public func listProductModifierGroups(perPage: Int = 100) async throws -> [FoodicsProductModifierGroup] {
        // Endpoint naming varies across API versions; if completely unavailable, continue with empty
        do {
            return try await listAllWithVersionAndPathFallback(paths: [
                "/product_modifier_groups",
                "/product_modifiers",
                "/menu/product_modifier_groups"
            ], perPage: perPage)
        } catch let e as APIError where e.code == 404 {
            #if DEBUG
            print("[Foodics] product modifier links endpoint not available (404). Proceeding with empty assignments.")
            #endif
            return []
        }
    }

    public func listProductCategoryLinks(perPage: Int = 200) async throws -> [FoodicsProductCategoryLink] {
        // Try a variety of plausible endpoints across API versions.
        do {
            return try await listAllWithVersionAndPathFallback(paths: [
                "/product_categories",
                "/menu/product_categories",
                "/categories_products",
                "/products_categories"
            ], perPage: perPage)
        } catch let e as APIError where e.code == 404 {
            #if DEBUG
            print("[Foodics] product-category link endpoint not available (404). Proceeding without category links.")
            #endif
            return []
        }
    }

    // MARK: - Core listAll with pagination & retry

    private func listAll<T: Decodable>(path: String, perPage: Int) async throws -> [T] {
        // Extract include parameters from path to preserve across pagination
        let includeParams = extractIncludeParams(from: path)
        
        var url = makeURL(base: baseURL, path: path, page: 1, perPage: perPage)
        var out: [T] = []
        var guardCounter = 0
        while let u = url {
            guardCounter += 1; if guardCounter > 500 { break }
            let page: FoodicsPage<T> = try await request(u)
            out.append(contentsOf: page.data)
            if let next = page.links?.next, !next.isEmpty {
                url = addIncludeParams(to: URL(string: next), params: includeParams)
            } else {
                url = nil
            }
        }
        return out
    }

    private func listAll<T: Decodable>(base overrideBase: URL, path: String, perPage: Int) async throws -> [T] {
        // Extract include parameters from path to preserve across pagination
        let includeParams = extractIncludeParams(from: path)
        
        var url = makeURL(base: overrideBase, path: path, page: 1, perPage: perPage)
        var out: [T] = []
        var guardCounter = 0
        while let u = url {
            guardCounter += 1; if guardCounter > 500 { break }
            let page: FoodicsPage<T> = try await request(u)
            out.append(contentsOf: page.data)
            if let next = page.links?.next, !next.isEmpty {
                url = addIncludeParams(to: URL(string: next), params: includeParams)
            } else {
                url = nil
            }
        }
        return out
    }

    private func listAllWithVersionAndPathFallback<T: Decodable>(paths: [String], perPage: Int) async throws -> [T] {
        // Try current base (likely /v5) then an alternate base (/v2)
        var bases: [URL] = [baseURL]
        if let alt = alternateBaseURL(from: baseURL) { bases.append(alt) }
        var lastErr: Error? = nil
        for b in bases {
            for p in paths {
                do {
                    return try await listAll(base: b, path: p, perPage: perPage)
                } catch let e as APIError {
                    // Only continue on 404; otherwise bubble up
                    if e.code == 404 { lastErr = e; continue }
                    throw e
                } catch {
                    lastErr = error; continue
                }
            }
        }
        throw lastErr ?? APIError(message: "No matching endpoint on v5 or v2", code: 404)
    }

    private func extractIncludeParams(from path: String) -> [String] {
        guard path.contains("?"), let queryPart = path.split(separator: "?", maxSplits: 1).last else {
            return []
        }
        let pairs = String(queryPart).split(separator: "&")
        return pairs.compactMap { pair in
            let kv = pair.split(separator: "=", maxSplits: 1)
            if kv.count == 2 && kv[0] == "include" {
                return String(kv[1])
            }
            return nil
        }
    }
    
    private func addIncludeParams(to url: URL?, params: [String]) -> URL? {
        guard let url = url, !params.isEmpty else { return url }
        var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var queryItems = comps?.queryItems ?? []
        for param in params {
            queryItems.append(URLQueryItem(name: "include", value: param))
        }
        comps?.queryItems = queryItems
        return comps?.url
    }
    
    private func makeURL(base: URL, path: String, page: Int, perPage: Int) -> URL? {
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        // Preserve any path on base (e.g., "/v5") and append the requested relative path.
        let basePath = comps.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        
        // Split path into pathPart and existing query
        let pathComponents = path.split(separator: "?", maxSplits: 1)
        let pathPart = String(pathComponents.first ?? "")
        let existingQuery = pathComponents.count > 1 ? String(pathComponents[1]) : nil
        
        let rel = pathPart.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let combined = [basePath, rel].filter { !$0.isEmpty }.joined(separator: "/")
        comps.path = "/" + combined
        
        // Build query items
        var q: [URLQueryItem] = []
        
        // Add existing query parameters from path
        if let existingQuery = existingQuery {
            let pairs = existingQuery.split(separator: "&")
            for pair in pairs {
                let kv = pair.split(separator: "=", maxSplits: 1)
                if kv.count == 2 {
                    q.append(URLQueryItem(name: String(kv[0]), value: String(kv[1])))
                } else if kv.count == 1 {
                    q.append(URLQueryItem(name: String(kv[0]), value: nil))
                }
            }
        }
        
        // Add pagination
        q.append(URLQueryItem(name: "page", value: String(page)))
        q.append(URLQueryItem(name: "per_page", value: String(perPage)))
        comps.queryItems = q
        return comps.url
    }




    private func alternateBaseURL(from base: URL) -> URL? {
        // Replace '/v5' with '/v2' in path, or append '/v2' if none found
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        let p = comps.path
        if p.contains("/v5") {
            comps.path = p.replacingOccurrences(of: "/v5", with: "/v2")
        } else if !p.contains("/v2") {
            // Ensure trailing /v2
            if p.isEmpty || p == "/" { comps.path = "/v2" } else { comps.path = p.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                comps.path = "/" + comps.path + "/v2" }
        }
        return comps.url
    }

    private func request<T: Decodable>(_ url: URL) async throws -> T {
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await send(req)
    }

    private func send<T: Decodable>(_ req: URLRequest, attempt: Int = 0) async throws -> T {
        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response", code: nil) }
            #if DEBUG
            print("[Foodics] \(req.httpMethod ?? "GET") \(req.url?.absoluteString ?? "") -> \(http.statusCode)")
            #endif
            if (200..<300).contains(http.statusCode) {
                #if DEBUG
                // Log first product's raw JSON to see what fields Foodics actually returns
                if req.url?.absoluteString.contains("/products?") == true {
                    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let dataArray = json["data"] as? [[String: Any]],
                       let first = dataArray.first {
                        print("[Foodics] First product raw JSON: \(first)")
                    }
                }
                #endif
                let decoder = JSONDecoder()
                // Don't use convertFromSnakeCase - Foodics already uses snake_case
                return try decoder.decode(T.self, from: data)
            }
            // Retry policy for 429/5xx
            if (http.statusCode == 429 || (500..<600).contains(http.statusCode)) && attempt < 3 {
                let ra = (http.value(forHTTPHeaderField: "retry-after").flatMap { Int($0) }) ?? 0
                let backoff = min(pow(2.0, Double(attempt)) * 0.5, 8.0)
                try? await Task.sleep(nanoseconds: UInt64((Double(ra) + backoff) * 1_000_000_000))
                return try await send(req, attempt: attempt + 1)
            }
            throw APIError(message: "HTTP \(http.statusCode)", code: http.statusCode)
        } catch let e as APIError {
            if attempt < 3 { try? await Task.sleep(nanoseconds: 500_000_000); return try await send(req, attempt: attempt + 1) }
            throw e
        } catch {
            if attempt < 3 { try? await Task.sleep(nanoseconds: 500_000_000); return try await send(req, attempt: attempt + 1) }
            throw error
        }
    }
}