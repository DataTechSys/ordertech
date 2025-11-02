import Foundation

enum AppEnvironment: String, CaseIterable, Identifiable {
    case staging
    case production
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .staging: return "Staging"
        case .production: return "Production"
        }
    }
    var defaultBaseURL: URL {
        switch self {
        case .staging:
            return URL(string: "https://staging.your-ordertech.example")!
        case .production:
            return URL(string: "https://app.ordertech.me")!
        }
    }
}

