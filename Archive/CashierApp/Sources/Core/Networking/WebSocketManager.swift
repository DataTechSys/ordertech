import Foundation
import Combine

// Minimal scaffolding; will be expanded to full typed events and handlers.
final class WebSocketManager: NSObject, ObservableObject {
    @Published var isConnected: Bool = false
    @Published var lastEventText: String = ""

    let events = PassthroughSubject<WSEvent, Never>()

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var url: URL?

    func connect(baseURL: URL) {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        comps.path = "/"
        guard let u = comps.url else { return }
        self.url = u
        let s = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = s
        let t = s.webSocketTask(with: u)
        self.task = t
        t.resume()
        receiveLoop()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session = nil
        isConnected = false
    }

    func send(json: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: json), let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    // Convenience senders
    func sendSubscribe(basketId: String) {
        send(json: ["type":"subscribe", "basketId": basketId])
    }
    func sendHello(basketId: String, role: String = "cashier", name: String? = nil, deviceId: String? = nil) {
        var j: [String: Any] = ["type": "hello", "basketId": basketId, "role": role]
        if let name = name { j["name"] = name }
        if let deviceId = deviceId { j["device_id"] = deviceId }
        send(json: j)
    }
    func sendBasketUpdate(basketId: String, op: BasketOp) {
        guard let data = try? JSONEncoder().encode(op),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        var j: [String: Any] = ["type": "basket:update", "basketId": basketId, "op": obj]
        send(json: j)
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure:
                DispatchQueue.main.async { self.isConnected = false }
            case .success(let msg):
                switch msg {
                case .string(let str):
                    DispatchQueue.main.async { self.lastEventText = str }
                    self.handleIncoming(text: str)
                case .data(let data):
                    let str = String(data: data, encoding: .utf8) ?? ""
                    DispatchQueue.main.async { self.lastEventText = str }
                    if !str.isEmpty { self.handleIncoming(text: str) }
                @unknown default:
                    break
                }
                DispatchQueue.main.async { self.isConnected = true }
            }
            self.receiveLoop()
        }
    }
    private func handleIncoming(text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            if let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let type = (dict["type"] as? String) ?? ""
                switch type {
                case "basket:sync", "basket:update":
                    if let ev = try? JSONDecoder().decode(IncomingBasketEnvelope.self, from: data) {
                        let wire = ev.basket ?? BasketWire(items: nil, total: nil, version: nil)
                        events.send(type == "basket:sync" ? .basketSync(wire) : .basketUpdate(wire))
                    } else {
                        events.send(.unknown(raw: dict))
                    }
                case "session:started":
                    let osn = dict["osn"] as? String
                    events.send(.sessionStarted(osn: osn))
                case "session:ended":
                    events.send(.sessionEnded)
                case "poster:status":
                    let active = (dict["active"] as? Bool) ?? false
                    events.send(.posterStatus(active: active))
                case "peer:status":
                    let status = (dict["status"] as? String) ?? ""
                    let name = dict["displayName"] as? String
                    events.send(.peerStatus(connected: status == "connected", displayName: name))
                case "rtc:status":
                    if let st = dict["status"] as? [String: Any], let disp = st["display"] as? [String: Any], let ts = disp["ts"] as? Double {
                        events.send(.rtcStatus(displayTs: ts))
                    } else {
                        events.send(.rtcStatus(displayTs: nil))
                    }
                case "error":
                    let message = dict["error"] as? String
                    events.send(.error(message: message))
                default:
                    events.send(.unknown(raw: dict))
                }
            }
        } catch {
            // ignore malformed
        }
    }
}

fileprivate struct IncomingBasketEnvelope: Decodable {
    let type: String?
    let basket: BasketWire?
}

extension WebSocketManager: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async { self.isConnected = true }
    }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        DispatchQueue.main.async { self.isConnected = false }
    }
}

