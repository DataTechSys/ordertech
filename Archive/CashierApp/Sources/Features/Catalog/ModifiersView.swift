import SwiftUI

struct ModifiersView: View {
    @EnvironmentObject var env: EnvironmentStore
    let product: Product
    @Binding var groups: [AnyCodableModifierGroup]
    @Binding var isLoading: Bool
    var onCancel: () -> Void
    var onAdd: (_ selectedOptions: [AnyCodableModifierGroup.Option]) -> Void

    @State private var selection: [String: Set<String>] = [:] // group.id -> optionIDs

    var body: some View {
        Form {
            Section { productHeader }
            Group {
                ForEach(groups) { g in
                    Section(header: Text(g.group.name)) {
                    let opts = g.options
                    let columns = [GridItem(.adaptive(minimum: 96), spacing: 8)]
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                        ForEach(opts) { opt in
                            let isOn = selection[g.group.id, default: []].contains(opt.id)
                            Button(action: {
                                toggleOption(opt, in: g)
                            }) {
                                HStack(spacing: 6) {
                                    Text(opt.name)
                                        .font(.system(size: 15, weight: isOn ? .semibold : .regular))
                                    if let price = opt.price, price != 0 {
                                        Text(String(format: "+%.3f", price))
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundColor(DT.acc)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .frame(minWidth: 96)
                                .background(isOn ? DT.acc.opacity(0.12) : DT.surface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .stroke(isOn ? DT.acc : DT.line, lineWidth: 1)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if let minSel = minRequired(g), minSel > 0 {
                        Text("Select at least \(minSel)").font(.footnote).foregroundColor(.secondary)
                    }
                    }
                }
            }
            .id(groups.map { $0.id }.joined(separator: ","))
            Section {
                HStack {
                    Button("Close") { onCancel() }
                        .keyboardShortcut("w", modifiers: .command)
                    Spacer()
                    Button("Add • \(String(format: "%.3f KWD", totalPrice))") {
                        onAdd(selectedOptions())
                    }
                    .disabled(isLoading || !isValid())
                }
            }
        }
        .onAppear { initSelection() }
        .onChange(of: groups.map { $0.id }) { _ in initSelection() }
        .navigationTitle("Add Item")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(action: onCancel) { Image(systemName: "xmark") }
                    .keyboardShortcut("w", modifiers: .command)
            }
        }
        .overlay(loadingOverlay)
    }

    private func initSelection() {
        var initSel: [String: Set<String>] = [:]
        for g in groups {
            initSel[g.group.id] = []
        }
        selection = initSel
    }

    private func toggleOption(_ opt: AnyCodableModifierGroup.Option, in g: AnyCodableModifierGroup) {
        var set = selection[g.group.id, default: []]
        let maxSel = g.group.max_select ?? ((g.group.required ?? false) ? 1 : Int.max)
        if set.contains(opt.id) {
            set.remove(opt.id)
        } else {
            if maxSel == 1 { set.removeAll() }
            if set.count < maxSel { set.insert(opt.id) }
        }
        selection[g.group.id] = set
    }

    private func selectedOptions() -> [AnyCodableModifierGroup.Option] {
        var list: [AnyCodableModifierGroup.Option] = []
        for g in groups {
            let set = selection[g.group.id] ?? []
            for o in g.options where set.contains(o.id) {
                list.append(o)
            }
        }
        return list
    }

    private func minRequired(_ g: AnyCodableModifierGroup) -> Int? {
        if let n = g.group.min_select { return n }
        if g.group.required ?? false { return 1 }
        return nil
    }

    private func isValid() -> Bool {
        for g in groups {
            let selCount = Int(selection[g.group.id]?.count ?? 0)
            let minSel = g.group.min_select ?? ((g.group.required ?? false) ? 1 : 0)
            let maxSel = g.group.max_select ?? Int.max
            if selCount < minSel { return false }
            if selCount > maxSel { return false }
        }
        return true
    }

    private var totalDelta: Double {
        var sum: Double = 0
        for g in groups {
            let set = selection[g.group.id] ?? []
            for o in g.options where set.contains(o.id) {
                if let d = o.price { sum += d }
            }
        }
        return sum
    }

    private var totalPrice: Double { product.price + totalDelta }

    private func absoluteURL(_ raw: String) -> URL? {
        if let u = URL(string: raw), u.scheme != nil { return u }
        if raw.hasPrefix("/") {
            var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false)
            comps?.path = raw
            return comps?.url
        }
        return env.baseURL.appendingPathComponent(raw)
    }

    private var productHeader: some View {
        VStack(spacing: 12) {
            if let raw = product.image_url, let url = absoluteURL(raw) {
                SquareAsyncImage(url: url, cornerRadius: 10, animated: true, overscan: 1.03)
                    .frame(width: 360, height: 360)
            } else {
                SquareAsyncImage(url: nil, cornerRadius: 10, animated: false)
                    .frame(width: 360, height: 360)
            }
            let ar = (product.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
            if !ar.isEmpty {
                Text(ar)
                    .font(.title3).fontWeight(.bold)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            Text(product.name)
                .font(.headline)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text(String(format: "%.3f KWD", product.price))
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
    
    @ViewBuilder
    private var loadingOverlay: some View {
        if isLoading {
            ProgressView("Loading options…")
                .progressViewStyle(.circular)
                .padding()
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .shadow(radius: 8)
        }
    }
}

