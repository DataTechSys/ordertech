import Foundation
import OrderTechCore

/// Stub SessionStore for DriveThru - not used in local-only mode
/// DriveThru uses LocalModeManager for all basket operations
@MainActor
final class SessionStore: ObservableObject {
    @Published var posterActive: Bool = false
    @Published var micMuted: Bool = false
    
    // Stub methods - DriveThru doesn't use remote sessions
    func sendRemove(sku: String) {}
    func sendAdd(sku: String, name: String, price: Double, imageURL: String? = nil, options: [String]? = nil, modifiers: Any? = nil) {}
    func sendSetQty(sku: String, qty: Int) {}
    func sendOptionsClose() {}
    func clearSuppressedPrefixes() {}
    func reset(env: EnvironmentStore) async {}
    func togglePoster(env: EnvironmentStore) async {}
    func toggleMute() { micMuted.toggle() }
    func pay(env: EnvironmentStore) async {}
}
