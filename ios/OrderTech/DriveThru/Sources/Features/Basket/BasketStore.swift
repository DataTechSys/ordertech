import Foundation

struct BasketItem: Identifiable, Hashable {
    let id: String
    var name: String
    var price: Double
    var qty: Int
    var imageURL: String?
}

@MainActor
final class BasketStore: ObservableObject {
    @Published var items: [BasketItem] = []
    var total: Double {
        items.reduce(0) { $0 + ($1.price * Double($1.qty)) }
    }

    func remove(id: String) {
        items.removeAll { $0.id == id }
    }
}

