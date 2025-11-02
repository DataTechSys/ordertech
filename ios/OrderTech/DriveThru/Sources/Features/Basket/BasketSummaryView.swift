import SwiftUI
import OrderTechCore
#if canImport(UIKit)
import UIKit
#endif

struct BasketSummaryView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var session: SessionStore
    @ObservedObject var basket: BasketStore
    @EnvironmentObject var catalog: CatalogStore
    var provider: String = "Live"
    var bars: Int = 0
    var onShowSettings: () -> Void = {}
    var showPayButton: Bool = true
    var showControlsButtons: Bool = true
    var showRemoveButtons: Bool = true
    var textScale: CGFloat = 1.0
    var onTapTotal: (() -> Void)? = nil
    var onTapItem: ((BasketItem) -> Void)? = nil
    var onEditItem: ((BasketItem) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header with title and status chip + bars
            HStack(alignment: .center) {
                Text("Order Summary")
                    .font(.system(size: 17 * textScale, weight: .semibold))
                Spacer()
            }
            .padding(.bottom, 4)

            // Items list
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(basket.items) { item in
                        SwipeableRow(
                            onEdit: { onEditItem?(item) ?? onTapItem?(item) },
                            onDelete: {
                                // Optimistic local removal; then send to server
                                basket.remove(id: item.id)
                                session.sendRemove(sku: item.id)
                            },
                            editColor: DT.acc,
                            deleteColor: .red.opacity(0.9)
                        ) {
                            HStack(alignment: .top, spacing: 6) {
                                SquareAsyncImage(url: resolveURL(for: item), cornerRadius: 6, animated: false)
                                    .frame(width: 32, height: 32)
                                // Left info block: Quantity, Name, Modifiers (if any)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text("x\(item.qty)")
                                    .font(.system(size: max(11, 12 * textScale)))
                                    .foregroundColor(.primary)
                                    .lineLimit(1)
                                    // Modifiers in front of item name (smaller), then item name (bold)
                                    let parts = splitName(item.name)
                                    if let mods = parts.1, !mods.isEmpty {
                                        (
                                            Text(mods)
                                                .font(.system(size: 11 * textScale))
                                                .foregroundColor(.secondary)
                                            + Text(" ")
                                            + Text(parts.0)
                                                .font(.system(size: 14 * textScale, weight: .bold))
                                        )
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                        .layoutPriority(1)
                                    } else {
                                        Text(parts.0)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                            .font(.system(size: 14 * textScale, weight: .bold))
                                            .layoutPriority(1)
                                    }
                                    // Unit price as the third row (smaller, not bold)
                                    Text(String(format: "%.3f KWD", item.price))
                                        .font(.system(size: 12 * textScale))
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                // Trailing: line total (right)
                                HStack(spacing: 6) {
                                    Text(String(format: "%.3f KWD", item.price * Double(item.qty)))
                                        .font(.system(size: 14 * textScale, weight: .semibold))
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { onTapItem?(item) }
                        }
                    }
                }
            }
            Divider()
            // Basket total row — tappable to open popup when handler provided
            Button(action: { onTapTotal?() }) {
                HStack {
                    Text("Basket").font(.system(size: 17 * textScale))
                    Spacer()
                    Text(String(format: "%.3f KWD", basket.total)).font(.system(size: 17 * textScale, weight: .bold))
                }
            }
            .buttonStyle(.plain)

            if showControlsButtons {
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
                if showPayButton {
                    Button("Pay") {
                        Task { await session.pay(env: env) }
                    }
                        .buttonStyle(ActionButtonStyle(prominent: true))
                }
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(UIColor.systemBackground))
                .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 2)
        )
    }

    private func absoluteURL(_ raw: String?) -> URL? {
        guard var raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        // Absolute URL — leave as-is
        if let u = URL(string: raw), u.scheme != nil { return u }
        // Split into path and query to avoid encoding '?' into the path
        var pathPart = raw
        var queryPart: String? = nil
        if let qIdx = raw.firstIndex(of: "?") {
            pathPart = String(raw[..<qIdx])
            queryPart = String(raw[raw.index(after: qIdx)...])
        }
        var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        if pathPart.hasPrefix("/") {
            comps.path = pathPart
        } else {
            let basePath = env.baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            comps.path = "/" + ([basePath, pathPart].filter { !$0.isEmpty }.joined(separator: "/"))
        }
        if let q = queryPart, !q.isEmpty { comps.percentEncodedQuery = q }
        return comps.url
    }
}

// MARK: - SwipeableRow (left=edit, right=delete, full swipe left = delete)
private struct SwipeableRow<Content: View>: View {
    @State private var offsetX: CGFloat = 0
    @State private var openSide: Side = .none
    @State private var isDeletionInProgress: Bool = false
    let onEdit: () -> Void
    let onDelete: () -> Void
    let editColor: Color
    let deleteColor: Color
    let maxReveal: CGFloat = 70
    let threshold: CGFloat = 45
    let fullSwipeThreshold: CGFloat = 120 // Full swipe threshold for immediate delete
    let content: () -> Content
    enum Side { case none, left, right }
    #if canImport(UIKit)
    private let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
    private let deleteFeedback = UINotificationFeedbackGenerator()
    #endif

    init(onEdit: @escaping () -> Void, onDelete: @escaping () -> Void, editColor: Color = .blue, deleteColor: Color = .red, @ViewBuilder content: @escaping () -> Content) {
        self.onEdit = onEdit
        self.onDelete = onDelete
        self.editColor = editColor
        self.deleteColor = deleteColor
        self.content = content
    }

    var body: some View {
        ZStack {
            // Background actions
            HStack {
                // Left (reveal on swipe right) - Edit
                HStack {
                    Image(systemName: "square.and.pencil")
                        .foregroundColor(.white)
                        .font(.system(size: 16, weight: .medium))
                }
                .frame(width: maxReveal)
                .frame(maxHeight: .infinity)
                .background(editColor)
                
                Spacer(minLength: 0)
                
                // Right (reveal on swipe left) - Delete
                HStack {
                    Image(systemName: "trash")
                        .foregroundColor(.white)
                        .font(.system(size: 16, weight: .medium))
                }
                .frame(width: max(maxReveal, abs(offsetX)), alignment: .trailing)
                .frame(maxHeight: .infinity)
                .background(deleteColor)
                .clipped()
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Foreground content with deletion animation
            content()
                .padding(.vertical, 4)
                .padding(.horizontal, 6)
                .background(Color.white)
                .scaleEffect(isDeletionInProgress ? 0.95 : 1.0)
                .opacity(isDeletionInProgress ? 0.8 : 1.0)
                .offset(x: offsetX)
                .gesture(drag)
                .animation(.spring(response: 0.35, dampingFraction: 0.8, blendDuration: 0.1), value: offsetX)
                .animation(.easeInOut(duration: 0.2), value: isDeletionInProgress)
                // Tappable action areas when revealed
                .overlay(alignment: .leading) {
                    if openSide == .left {
                        Button(action: {
                            #if canImport(UIKit)
                            impactFeedback.impactOccurred()
                            #endif
                            onEdit(); close()
                        }) {
                            Color.clear.frame(width: maxReveal, height: 1)
                        }
                        .frame(maxHeight: .infinity)
                    }
                }
                .overlay(alignment: .trailing) {
                    if openSide == .right {
                        Button(action: {
                            performDelete()
                        }) {
                            Color.clear.frame(width: maxReveal, height: 1)
                        }
                        .frame(maxHeight: .infinity)
                    }
                }
        }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .local)
            .onChanged { value in
                guard !isDeletionInProgress else { return }
                
                let t = value.translation.width
                let velocity = value.predictedEndTranslation.width - value.translation.width
                
                if openSide == .none {
                    // Allow extended swipe for full delete
                    let maxOffset = abs(t) > fullSwipeThreshold ? -200 : maxReveal
                    offsetX = clamp(t, -maxOffset, maxReveal)
                    
                    // Provide haptic feedback when crossing full swipe threshold
                    if abs(t) > fullSwipeThreshold && abs(offsetX) <= fullSwipeThreshold {
                        #if canImport(UIKit)
                        impactFeedback.impactOccurred()
                        #endif
                    }
                } else if openSide == .left { // left opened (edit), allow close or switch
                    offsetX = clamp(maxReveal + t, -maxReveal, maxReveal)
                } else if openSide == .right { // right opened (delete)
                    let maxOffset = abs(t) > fullSwipeThreshold ? -200 : maxReveal
                    offsetX = clamp(-maxReveal + t, -maxOffset, maxReveal)
                }
            }
            .onEnded { value in
                guard !isDeletionInProgress else { return }
                
                let t = value.translation.width
                let velocity = value.predictedEndTranslation.width - value.translation.width
                
                if openSide == .none {
                    // Check for full swipe delete (swipe left past threshold)
                    if t < -fullSwipeThreshold || (t < -threshold && velocity < -50) {
                        performDelete()
                    } else if t > threshold {
                        open(.left)
                    } else if t < -threshold {
                        open(.right)
                    } else {
                        close()
                    }
                } else if openSide == .left {
                    if t < -threshold { close() } else { open(.left) }
                } else if openSide == .right {
                    // Check for full swipe delete from revealed state
                    if t < -fullSwipeThreshold || (t < -threshold && velocity < -50) {
                        performDelete()
                    } else if t > threshold {
                        close()
                    } else {
                        open(.right)
                    }
                }
            }
    }
    
    private func performDelete() {
        guard !isDeletionInProgress else { return }
        
        isDeletionInProgress = true
        
        #if canImport(UIKit)
        deleteFeedback.notificationOccurred(.success)
        #endif
        
        // Animate off screen then delete
        withAnimation(.easeInOut(duration: 0.3)) {
            offsetX = -400
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            onDelete()
            // Reset state in case the item isn't immediately removed from the list
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isDeletionInProgress = false
                close()
            }
        }
    }

    private func open(_ side: Side) {
        openSide = side
        offsetX = (side == .left) ? maxReveal : (side == .right ? -maxReveal : 0)
    }
    
    private func close() {
        openSide = .none
        offsetX = 0
    }
    
    private func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
        min(max(v, lo), hi)
    }
}

private extension BasketSummaryView {
    func resolveURL(for item: BasketItem) -> URL? {
        // 1) Use image in item if provided
        if let u = absoluteURL(item.imageURL) { return u }
        // 2) Fallback to catalog using id and alternates
        let candidates = alternateIds(from: item.id)
        if let p = catalog.products.first(where: { candidates.contains($0.id) }) {
            return absoluteURL(p.image_url)
        }
        return nil
    }

    var statusText: String {
        if env.deviceToken == nil { return "UNPAIRED" }
        if bars > 0 { return "CONNECTED" }
        return "READY"
    }
    // Split a name like "Burger (Extra Cheese, No Onions)" into base and modifiers.
    func splitName(_ name: String) -> (String, String?) {
        guard let open = name.lastIndex(of: "("), let close = name.lastIndex(of: ")"), open < close else {
            return (name, nil)
        }
        let base = String(name[..<open]).trimmingCharacters(in: .whitespacesAndNewlines)
        let mods = String(name[name.index(after: open)..<close]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (base, mods.isEmpty ? nil : mods)
    }

    func alternateIds(from id: String) -> [String] {
        var set = Set<String>()
        set.insert(id)
        let comps1 = id.split(separator: ":").map(String.init)
        if let last = comps1.last { set.insert(last) }
        let comps2 = id.split(separator: "#").map(String.init)
        if let last = comps2.last { set.insert(last) }
        let comps3 = id.split(separator: "-").map(String.init)
        if let last = comps3.last { set.insert(last) }
        let digits = id.filter { $0.isNumber }
        if !digits.isEmpty { set.insert(digits) }
        return Array(set)
    }
}

