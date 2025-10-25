import Foundation

/// Build environment detection utilities
enum BuildEnv {
    /// Returns true if running on iOS Simulator, false on physical device
    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
}
