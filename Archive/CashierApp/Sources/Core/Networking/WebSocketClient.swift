import Foundation

final class WebSocketClient: NSObject {
    private var task: URLSessionWebSocketTask?
    private var url: URL?
    private var session: URLSession?

    func connect(baseURL: URL) {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        comps.path = "/"
        guard let url = comps.url else { return }
        self.url = url
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = session
        self.task = session.webSocketTask(with: url)
        self.task?.resume()
        self.receiveLoop()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session = nil
    }

    func send(text: String) {
        task?.send(.string(text)) { _ in }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            switch result {
            case .failure:
                break
            case .success:
                break
            }
            self?.receiveLoop()
        }
    }
}

extension WebSocketClient: URLSessionWebSocketDelegate {}

