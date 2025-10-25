import Foundation
import OrderTechCore

// Extensions to add helper methods for WebSocketManager
extension OrderTechCore.WebSocketManager {
    func sendSubscribe(basketId: String) {
        send(json: ["type": "subscribe", "basketId": basketId])
    }
    
    func sendHello(basketId: String, role: String, name: String) {
        send(json: ["type": "hello", "basketId": basketId, "role": role, "name": name])
    }
    
    func sendBasketUpdate(basketId: String, op: BasketOp) {
        var payload: [String: Any] = ["type": "basket:update", "basketId": basketId]
        
        switch op {
        case .add:
            payload["op"] = "add"
        case .remove:
            payload["op"] = "remove"
        case .update:
            payload["op"] = "update"
        case .clear:
            payload["op"] = "clear"
        }
        
        send(json: payload)
    }
}
