import Foundation
import OrderTechCore

// Backend DTOs used by Display app
struct RTCAuthToken: Decodable { let token: String?; let url: String? }

extension HttpClient {
    // Obtain an SFU access token (e.g., LiveKit) for the given basket (pair) and role
    func rtcToken(provider: String, basketId: String, role: String) async throws -> RTCAuthToken {
        struct Body: Encodable { let provider: String; let basketId: String; let role: String }
        let body = try JSONEncoder().encode(Body(provider: provider, basketId: basketId, role: role))
        return try await request("/rtc/token", method: "POST", body: body)
    }
}
