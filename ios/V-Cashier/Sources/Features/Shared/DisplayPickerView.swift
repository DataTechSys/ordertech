import SwiftUI

struct DisplayPickerView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    @State private var items: [DisplayPresenceItem] = []
    @State private var isLoading = false
    @State private var errorText: String?
    @State private var timerActive = true
    @State private var filterAvailableOnly = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Choose Display")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                }
        }
        .task { await load() }
        .onAppear { timerActive = true }
        .onDisappear { timerActive = false }
        .task(id: timerActive) {
            // Periodic refresh every 5 seconds while the sheet is visible
            while timerActive {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                await load(silent: true)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && items.isEmpty {
            ProgressView("Loading displays…")
                .progressViewStyle(.circular)
        } else if let e = errorText, items.isEmpty {
            VStack(spacing: 12) {
                Text(e).foregroundColor(.red)
                Button("Retry") { Task { await load() } }
            }.padding()
        } else {
            VStack(spacing: 8) {
                // Filter control
                Picker("Filter", selection: $filterAvailableOnly) {
                    Text("All").tag(false)
                    Text("Available").tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                if visibleItemCount > 0 {
                    List {
                        ForEach(filteredBranchKeys, id: \.self) { branch in
                            Section(header: Text(branch.isEmpty ? "Unassigned" : branch)) {
                                let list = sorted(groupedByBranch[branch] ?? [])
                                let visible = filterAvailableOnly ? list.filter { isAvailable($0) } : list
                                ForEach(visible) { d in
                                    let state = availability(for: d)
                                    Button(action: { Task { await start(with: d.id) } }) {
                                        VStack(alignment: .leading, spacing: 6) {
                                            HStack(spacing: 12) {
                                                Text(d.name?.isEmpty == false ? d.name! : d.id)
                                                    .font(.body.weight(.semibold))
                                                    .foregroundColor(.white)
                                                    .lineLimit(1)
                                                    .truncationMode(.tail)
                                                Spacer()
                                                if isCurrentConnected(d) {
                                                    Image(systemName: "checkmark.circle.fill")
                                                        .foregroundColor(.white)
                                                        .imageScale(.medium)
                                                }
                                                Text(state.label)
                                                    .font(.caption)
                                                    .padding(.horizontal, 8)
                                                    .padding(.vertical, 4)
                                                    .background(Capsule().fill(Color.white.opacity(0.85)))
                                                    .foregroundColor(.black)
                                            }
                                            if state.label == "Offline", let t = lastSeenText(d.last_seen) {
                                                Text("Last seen \\(t)")
                                                    .font(.caption2)
                                                    .foregroundColor(.white.opacity(0.9))
                                            }
                                        }
                                        .padding(.vertical, 10)
                                        .padding(.horizontal, 12)
                                        .background(RoundedRectangle(cornerRadius: 12).fill(state.bg))
                                    }
                                    .disabled(!state.isAvailable)
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await load() }
                } else {
                    Text(filterAvailableOnly ? "No available displays" : "No displays found")
                        .padding()
                }
            }
        }
    }

    private var groupedByBranch: [String: [DisplayPresenceItem]] {
        Dictionary(grouping: items, by: { ($0.branch ?? "").isEmpty ? ($0.branch_id ?? "") : ($0.branch ?? "") })
    }

    private var filteredBranchKeys: [String] {
        let keys = groupedByBranch.keys.sorted()
        return keys.filter { branch in
            let list = sorted(groupedByBranch[branch] ?? [])
            let visible = filterAvailableOnly ? list.filter { isAvailable($0) } : list
            return !visible.isEmpty
        }
    }

    private var visibleItemCount: Int {
        if filterAvailableOnly { return items.filter { isAvailable($0) }.count }
        return items.count
    }

    private func sorted(_ list: [DisplayPresenceItem]) -> [DisplayPresenceItem] {
        list.sorted { a, b in
            // Availability rank: Available(0), Busy(1), Offline(2)
            func rank(_ d: DisplayPresenceItem) -> Int {
                let isOnline = d.online ?? false
                let isBusy = d.busy ?? false
                if isOnline && !isBusy { return 0 }
                if isOnline && isBusy { return 1 }
                return 2
            }
            let ra = rank(a), rb = rank(b)
            if ra != rb { return ra < rb }
            // Then by name
            let an = (a.name?.isEmpty == false ? a.name! : a.id)
            let bn = (b.name?.isEmpty == false ? b.name! : b.id)
            return an.localizedCaseInsensitiveCompare(bn) == .orderedAscending
        }
    }

    private func lastSeenText(_ iso: String?) -> String? {
        guard let iso = iso, !iso.isEmpty else { return nil }
        // Try ISO8601 first; if it fails, just show the raw string
        if let date = ISO8601DateFormatter().date(from: iso) {
            let delta = Date().timeIntervalSince(date)
            if delta < 60 { return "just now" }
            let mins = Int(delta/60)
            if mins < 60 { return "\(mins)m ago" }
            let hours = Int(delta/3600)
            if hours < 24 { return "\(hours)h ago" }
            let days = Int(delta/86400)
            return "\(days)d ago"
        }
        return iso
    }

    private func availability(for d: DisplayPresenceItem) -> (isAvailable: Bool, bg: Color, label: String) {
        let isOnline = d.online ?? false
        let isBusy = d.busy ?? false
        if isOnline && isBusy { return (false, Color.orange.opacity(0.85), "Busy") }
        if isOnline { return (true, Color.green.opacity(0.85), "Available") }
        return (false, Color.gray.opacity(0.5), "Offline")
    }

    private func isAvailable(_ d: DisplayPresenceItem) -> Bool {
        let isOnline = d.online ?? false
        let isBusy = d.busy ?? false
        return isOnline && !isBusy
    }

    private func isCurrentConnected(_ d: DisplayPresenceItem) -> Bool {
        return (session.signalBars > 0) && (d.id == (session.basketId ?? ""))
    }

    private func load(silent: Bool = false) async {
        if !silent { isLoading = true }
        defer { if !silent { isLoading = false } }
        do {
            let client = HttpClient(env: env)
            items = try await client.presenceDisplays()
            errorText = nil
        } catch {
            if !silent { errorText = error.localizedDescription }
        }
    }

    private func start(with pairId: String) async {
        await session.startSessionWithPairId(env: env, pairId: pairId)
        dismiss()
    }
}
