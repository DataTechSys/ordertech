import Foundation

struct APIError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class HttpClient {
    let env: EnvironmentStore
    init(env: EnvironmentStore) { self.env = env }

    // Raw fetch helper used by ActivationFlow to import manifest while preserving unknown fields
    func getRaw(_ path: String, fresh: Bool = false) async throws -> (Data, HTTPURLResponse) {
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathPart = String(parts.first ?? "")
        let queryPart = parts.count > 1 ? String(parts[1]) : nil
        let baseURL = await env.baseURL
        // Helper to build URL for a given pathPart and optional prefix
        func buildURL(pathPart: String, queryPart: String?, prefix: String?) -> URL? {
            var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            let rawPath = pathPart.hasPrefix("/") ? pathPart : "/" + pathPart
            if let prefix = prefix, !prefix.isEmpty {
                // Avoid double-prefix when already present
                if rawPath.hasPrefix("/api/") || rawPath.hasPrefix("/v1/") {
                    comps.path = rawPath
                } else {
                    comps.path = prefix + rawPath
                }
            } else {
                comps.path = rawPath
            }
            if let q = queryPart, !q.isEmpty { comps.percentEncodedQuery = q }
            return comps.url
        }
        // Build primary request
        guard let url = buildURL(pathPart: pathPart, queryPart: queryPart, prefix: nil) else { throw APIError(message: "Invalid URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if fresh { req.cachePolicy = .reloadIgnoringLocalCacheData }
        let tenant = await env.tenantId
        let token = await env.deviceToken
        if let tenant = tenant { req.setValue(tenant, forHTTPHeaderField: "x-tenant-id") }
        if let token = token { req.setValue(token, forHTTPHeaderField: "x-device-token") }
        req.setValue("application/json", forHTTPHeaderField: "accept")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response") }
            if (200..<300).contains(http.statusCode) { return (data, http) }
            if http.statusCode == 404 {
                // Try /api then /v1 fallback
                for prefix in ["/api", "/v1"] {
                    if let altURL = buildURL(pathPart: pathPart, queryPart: queryPart, prefix: prefix) {
                        var altReq = URLRequest(url: altURL)
                        altReq.httpMethod = "GET"
                        if fresh { altReq.cachePolicy = .reloadIgnoringLocalCacheData }
                        if let tenant = tenant { altReq.setValue(tenant, forHTTPHeaderField: "x-tenant-id") }
                        if let token = token { altReq.setValue(token, forHTTPHeaderField: "x-device-token") }
                        altReq.setValue("application/json", forHTTPHeaderField: "accept")
                        let (altData, altResp) = try await URLSession.shared.data(for: altReq)
                        if let altHttp = altResp as? HTTPURLResponse, (200..<300).contains(altHttp.statusCode) {
                            return (altData, altHttp)
                        }
                    }
                }
            }
            throw APIError(message: "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)")
        } catch {
            // Bubble up non-HTTP errors
            throw error
        }
    }

    func request<T: Decodable>(_ path: String,
                               method: String = "GET",
                               headers: [String: String] = [:],
                               body: Data? = nil,
                               decode type: T.Type = T.self,
                               allowAlternate: Bool = true) async throws -> T {
        // Build URL with optional query support in `path`
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathPart = String(parts.first ?? "")
        let queryPart = parts.count > 1 ? String(parts[1]) : nil

        // Access main-actor isolated EnvironmentStore values with await
        let baseURL = await env.baseURL
        // Helper to build URL for a given pathPart and optional prefix
        func buildURL(pathPart: String, queryPart: String?, prefix: String?) -> URL? {
            var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
            let rawPath = pathPart.hasPrefix("/") ? pathPart : "/" + pathPart
            if let prefix = prefix, !prefix.isEmpty {
                // Avoid double-prefix when already present
                if rawPath.hasPrefix("/api/") || rawPath.hasPrefix("/v1/") {
                    comps.path = rawPath
                } else {
                    comps.path = prefix + rawPath
                }
            } else {
                comps.path = rawPath
            }
            if let q = queryPart, !q.isEmpty { comps.percentEncodedQuery = q }
            return comps.url
        }
        guard let url = buildURL(pathPart: pathPart, queryPart: queryPart, prefix: nil) else { throw APIError(message: "Invalid URL") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        var allHeaders = headers
        let tenant = await env.tenantId
        let token = await env.deviceToken
        if let tenant = tenant { allHeaders["x-tenant-id"] = tenant }
        if let token = token { allHeaders["x-device-token"] = token }
        allHeaders["accept"] = "application/json"
        if body != nil { allHeaders["content-type"] = "application/json" }
        for (k, v) in allHeaders { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = body

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError(message: "No HTTP response") }
        if !(200..<300).contains(http.statusCode) {
            if allowAlternate && http.statusCode == 404 {
                // Try /api then /v1 prefixed paths transparently
                for prefix in ["/api", "/v1"] {
                    if let altURL = buildURL(pathPart: pathPart, queryPart: queryPart, prefix: prefix) {
                        var altReq = URLRequest(url: altURL)
                        altReq.httpMethod = method
                        for (k, v) in allHeaders { altReq.setValue(v, forHTTPHeaderField: k) }
                        altReq.httpBody = body
                        let (altData, altResp) = try await URLSession.shared.data(for: altReq)
                        if let altHttp = altResp as? HTTPURLResponse, (200..<300).contains(altHttp.statusCode) {
                            if T.self == Empty.self { return Empty() as! T }
                            return try JSONDecoder().decode(T.self, from: altData)
                        }
                    }
                }
            }
            throw APIError(message: "HTTP \(http.statusCode)")
        }
        if T.self == Empty.self { return Empty() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct Empty: Decodable {}

