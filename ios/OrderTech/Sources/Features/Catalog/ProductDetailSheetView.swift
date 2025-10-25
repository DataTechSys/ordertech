import SwiftUI
import OrderTechCore

struct CashierProductDetailSheetView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    let product: Product
    var lineId: String? = nil
    var initialQty: Int? = nil
    var lineName: String? = nil
    var lineUnitPrice: Double? = nil

    @State private var qty: Int = 1

    var body: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        VStack(spacing: 12) {
            content
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: isPad ? 620 : 520)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(alignment: .topTrailing) {
            Button(action: { session.sendOptionsClose(); dismiss() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .padding(8)
                    .background(Circle().fill(Color.gray.opacity(0.15)))
            }
            .buttonStyle(.plain)
            .padding(6)
        }
        .onAppear {
            print("[ProductDetailSheetView] onAppear - product: \(product.name), lineId: \(lineId ?? "nil"), initialQty: \(initialQty ?? -1)")
            if let q = initialQty, q > 0 { 
                print("[ProductDetailSheetView] Setting initial qty from \(qty) to \(q)")
                qty = q 
            }
            print("[ProductDetailSheetView] Final qty after onAppear: \(qty)")
        }
    }

    private var content: some View {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let imageSide: CGFloat = isPad ? 420 : 320
        return ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                // Photo on top, centered
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: 12, animated: true, overscan: 1.02)
                    .frame(width: imageSide, height: imageSide)
                    .frame(maxWidth: .infinity)

                // Name and price — prefer line details when editing
                VStack(alignment: .leading, spacing: 4) {
                    if let name = lineName, let unit = lineUnitPrice {
                        Text(name)
                            .font(.system(size: isPad ? 22 : 17, weight: .bold))
                            .foregroundColor(DT.ink)
                        Text(String(format: "%.3f KWD", unit))
                            .font(.system(size: isPad ? 18 : 15, weight: .semibold))
                            .foregroundColor(DT.acc)
                    } else {
                        let ar = (product.name_localized?["ar"] ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                        if !ar.isEmpty {
                            Text(ar)
                                .font(.system(size: isPad ? 20 : 16, weight: .bold))
                                .foregroundColor(DT.ink)
                        }
                        Text(product.name)
                            .font(.system(size: isPad ? 22 : 17, weight: .bold))
                            .foregroundColor(DT.ink)
                        Text(String(format: "%.3f KWD", product.price))
                            .font(.system(size: isPad ? 18 : 15, weight: .semibold))
                            .foregroundColor(DT.acc)
                    }
                }
                
                // Quantity and Actions moved to top
                actions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 12)
            .padding(.bottom, 4)
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            // Custom quantity stepper with trash icon when qty=1
            HStack {
                Text("Quantity")
                    .font(.system(size: 16, weight: .medium))
                
                Spacer()
                
                HStack(spacing: 12) {
                    // Minus/Trash button
                    Button(action: {
                        print("[ProductDetailSheetView] Minus button tapped, current qty: \(qty)")
                        if qty <= 1 {
                            // When qty is 1, trash button removes from basket
                            if let line = lineId {
                                print("[ProductDetailSheetView] Removing item with lineId: \(line)")
                                session.clearSuppressedPrefixes()
                                session.sendRemove(sku: line)
                                session.sendOptionsClose()
                                dismiss()
                            }
                        } else {
                            // Normal minus operation
                            let oldQty = qty
                            qty = max(1, qty - 1)
                            print("[ProductDetailSheetView] Decreased qty from \(oldQty) to \(qty)")
                            // Send real-time update to basket if editing existing line
                            if let line = lineId {
                                print("[ProductDetailSheetView] Sending setQty update: \(line) -> \(qty)")
                                session.sendSetQty(sku: line, qty: qty)
                            }
                        }
                    }) {
                        Image(systemName: qty <= 1 ? "trash.fill" : "minus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(qty <= 1 ? Color.red : Color.gray.opacity(0.7)))
                    }
                    .buttonStyle(.plain)
                    
                    // Quantity display
                    Text("\(qty)")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(minWidth: 30)
                    
                    // Plus button
                    Button(action: {
                        let oldQty = qty
                        qty = min(20, qty + 1)
                        print("[ProductDetailSheetView] Plus button tapped, increased qty from \(oldQty) to \(qty)")
                        // Send real-time update to basket if editing existing line
                        if let line = lineId {
                            print("[ProductDetailSheetView] Sending setQty update: \(line) -> \(qty)")
                            session.sendSetQty(sku: line, qty: qty)
                        }
                    }) {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(DT.acc))
                    }
                    .buttonStyle(.plain)
                }
            }
            if let line = lineId {
                // Editing existing line: Update and Remove
                Button {
                    session.clearSuppressedPrefixes()
                    session.sendSetQty(sku: line, qty: qty)
                    session.sendOptionsClose()
                    dismiss()
                } label: {
                    HStack {
                        Image(systemName: "square.and.pencil")
                        Text("Update quantity")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(DT.acc))
                    .foregroundColor(.white)
                }
                .buttonStyle(.plain)
                Button(role: .destructive) {
                    session.clearSuppressedPrefixes()
                    session.sendRemove(sku: line)
                    session.sendOptionsClose()
                    dismiss()
                } label: {
                    HStack {
                        Image(systemName: "trash")
                        Text("Remove from order")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.red.opacity(0.12)))
                    .foregroundColor(.red)
                }
                .buttonStyle(.plain)
            } else {
                // Adding new line
                Button {
                    session.clearSuppressedPrefixes()
                    for _ in 0..<qty {
                        session.sendAdd(sku: product.id, name: product.name, price: product.price)
                    }
                    session.sendOptionsClose()
                    dismiss()
                } label: {
                    HStack {
                        Image(systemName: "cart.fill")
                        Text("Add to order")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(DT.acc))
                    .foregroundColor(.white)
                }
                .buttonStyle(.plain)
            }
        }
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