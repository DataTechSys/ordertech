import Foundation

enum AppEnvironment: String, CaseIterable, Identifiable {
    case staging
    case production
    case custom
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .staging: return "Staging"
        case .production: return "Production"
        case .custom: return "Custom"
        }
    }
    var defaultBaseURL: URL {
        switch self {
        case .staging:
            return URL(string: "https://staging.your-ordertech.example")!
        case .production:
            return URL(string: "https://app.ordertech.me")!
        case .custom:
            return URL(string: "http://localhost:5050")!
        }
    }
}

