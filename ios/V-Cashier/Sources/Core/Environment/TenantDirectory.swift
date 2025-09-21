import Foundation

#if DEBUG
struct TenantRef: Identifiable, Hashable {
    let id: String
    let name: String
    let note: String?
}

enum TenantDirectory {
    // DEBUG-only quick references; not used in production builds
    static let known: [TenantRef] = [
        TenantRef(id: "f8578f9c-782b-4d31-b04f-3b2d890c5896", name: "Koobs", note: "Production")
    ]
}
#else
// In production, no static tenants are exposed
enum TenantDirectory {}
#endif

