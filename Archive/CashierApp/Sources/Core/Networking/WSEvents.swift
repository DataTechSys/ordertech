import Foundation

// Lightweight event models for WebSocket cashier channel
// Extend as needed when we add UI mirroring and full RTC supervision.

enum WSEvent {
    case basketSync(BasketWire)
    case basketUpdate(BasketWire)
    case sessionStarted(osn: String?)
    case sessionEnded
    case posterStatus(active: Bool)
    case peerStatus(connected: Bool, displayName: String?)
    case rtcStatus(displayTs: TimeInterval?)
    case error(message: String?)
    case unknown(raw: [String: Any])
}

struct BasketWire: Decodable {
    struct Item: Decodable { let sku: String?; let id: String?; let name: String?; let price: Double?; let qty: Int?; let image_url: String? }
    let items: [Item]?
    let total: Double?
    let version: Int?
}

struct BasketOp: Encodable {
    let action: String // add | remove | setQty | clear
    let item: BasketItemBody?
    let qty: Int?
    init(add sku: String, name: String, price: Double) { self.action = "add"; self.item = .init(sku: sku, name: name, price: price); self.qty = 1 }
    init(remove sku: String) { self.action = "remove"; self.item = .init(sku: sku, name: nil, price: nil); self.qty = nil }
    init(setQty sku: String, qty: Int) { self.action = "setQty"; self.item = .init(sku: sku, name: nil, price: nil); self.qty = qty }
    static var clear: BasketOp { BasketOp(action: "clear", item: nil, qty: nil) }
    private init(action: String, item: BasketItemBody?, qty: Int?) { self.action = action; self.item = item; self.qty = qty }
}

struct BasketItemBody: Encodable { let sku: String; let name: String?; let price: Double? }

