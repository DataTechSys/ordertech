import Foundation
import SwiftUI

struct BasketLineUI: Identifiable, Equatable {
    let id: String
    let name: String
    let qty: Int
    let unitPrice: Double
    let lineTotal: Double
    var options: [String] = []
    var imageURL: String? = nil
}

struct BasketTotalsUI: Equatable {
    var subtotal: Double
    var tax: Double
    var total: Double

    static let zero = BasketTotalsUI(subtotal: 0, tax: 0, total: 0)
}

struct PreviewState: Equatable {
    var name: String
    var price: Double
    var imageURL: String?
    var options: [String] = []
}

struct PosterState: Equatable {
    var title: String
    var message: String
    var imageURL: String?
}
