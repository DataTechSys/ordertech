import SwiftUI

struct BasketSummaryView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var session: SessionStore
    @ObservedObject var basket: BasketStore
    var provider: String = "P2P"
    var bars: Int = 0
    var onShowSettings: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header with title and status chip + bars
            HStack(alignment: .center) {
                Text("Order Summary")
                    .font(.headline)
                Spacer()
            }
            .padding(.bottom, 4)

            // Items list
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(basket.items) { item in
                        HStack(spacing: 8) {
                            SquareAsyncImage(url: absoluteURL(item.imageURL), cornerRadius: 6, animated: false)
                                .frame(width: 40, height: 40)
                            Text("x\(item.qty)")
                                .font(.subheadline).fontWeight(.semibold)
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(Capsule().fill(Color.gray.opacity(0.15)))
                                .overlay(Capsule().stroke(Color.gray.opacity(0.3), lineWidth: 1))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).lineLimit(1)
                                Text(String(format: "%.3f KWD", item.price)).font(.caption).foregroundColor(.secondary)
                            }
                            Spacer()
                            HStack(spacing: 6) {
                                Text(String(format: "%.3f KWD", item.price * Double(item.qty)))
                                Button(action: {
                                    // Optimistic local removal first to avoid visual re-introduction
                                    basket.remove(id: item.id)
                                    session.sendRemove(sku: item.id)
                                }) {
                                    Image(systemName: "trash").foregroundColor(.red)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            Divider()
            HStack {
                Text("Total")
                Spacer()
                Text(String(format: "%.3f KWD", basket.total)).bold()
            }
            .font(.headline)

            HStack(spacing: 10) {
                Button("Reset") {
                    Task { await session.reset(env: env) }
                }
                    .buttonStyle(ActionButtonStyle(prominent: false))
                Button(session.posterActive ? "Stop Poster" : "Poster") {
                    Task { await session.togglePoster(env: env) }
                }
                    .buttonStyle(ActionButtonStyle(prominent: false))
                Button(session.micMuted ? "Unmute" : "Mute") {
                    session.toggleMute()
                }
                    .buttonStyle(ActionButtonStyle(prominent: false))
                Spacer(minLength: 0)
                Button("Pay") {
                    Task { await session.pay(env: env) }
                }
                    .buttonStyle(ActionButtonStyle(prominent: true))
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(UIColor.systemBackground))
                .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 2)
        )
    }

    private func absoluteURL(_ raw: String?) -> URL? {
        guard let raw = raw, !raw.isEmpty else { return nil }
        if let u = URL(string: raw), u.scheme != nil { return u }
        if raw.hasPrefix("/") {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false)
            comps?.path = raw
            return comps?.url
        }
        return env.baseURL.appendingPathComponent(raw)
    }
}

