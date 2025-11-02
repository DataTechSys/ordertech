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
        var operation: [String: Any] = [:]
        
        switch op {
        case .add:
            operation["action"] = "add"
        case .remove:
            operation["action"] = "remove"
        case .update:
            operation["action"] = "update"
        case .clear:
            operation["action"] = "clear"
        }
        
        let payload: [String: Any] = [
            "type": "basket:update",
            "basketId": basketId,
            "op": operation
        ]
        
        send(json: payload)
    }
}
