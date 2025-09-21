import SwiftUI

@main
struct CashierApp: App {
    @StateObject private var env = EnvironmentStore()
    @StateObject private var catalog = CatalogStore()
    @StateObject private var basket = BasketStore()
    @StateObject private var session = SessionStore()
    @StateObject private var subscription = SubscriptionManager()

    init() {
        // Increase URLCache to keep prefetched images
        let mem = 50 * 1024 * 1024 // 50 MB
        let disk = 200 * 1024 * 1024 // 200 MB
        URLCache.shared = URLCache(memoryCapacity: mem, diskCapacity: disk, directory: nil)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(env)
                .environmentObject(catalog)
                .environmentObject(basket)
                .environmentObject(session)
                .environmentObject(subscription)
                .onAppear { session.attach(basket: basket) }
        }
    }
}

