import SwiftUI

struct ProductTileView: View {
    @EnvironmentObject var env: EnvironmentStore
    @Environment(\.horizontalSizeClass) private var hSize
    let product: Product
    let width: CGFloat

    // Tweaks (adapt for compact)
    private var corner: CGFloat { DT.radius }
    private var textBlockH: CGFloat { (hSize == .compact) ? 60 : 72 }
    private var innerPad: CGFloat { (hSize == .compact) ? 8 : 10 }

    var body: some View {
        let compact = (hSize == .compact)
        let imageSide = width - innerPad * 2 // square inside the card
        ZStack {
            RoundedRectangle(cornerRadius: corner)
                .fill(DT.surface)
                .overlay(RoundedRectangle(cornerRadius: corner).stroke(DT.line, lineWidth: 1))
            VStack(spacing: compact ? 6 : 8) {
                // Square image area with built-in border strictly sized to imageSide
                SquareAsyncImage(url: absoluteURL(product.image_url), cornerRadius: corner)
                    .frame(width: imageSide, height: imageSide)

                // 3-layer info (Arabic, English, Price) with fixed height
                VStack(spacing: compact ? 2 : 3) {
                    let ar = (product.name_localized?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
                    let en = product.name
                    if ar.isEmpty {
                        // Reserve Arabic line height to keep all cards identical
                        Text(en)
                            .font(.system(size: compact ? 12 : 14, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.clear)
                            .frame(width: imageSide, alignment: .center)
                    } else {
                        Text(ar)
                            .font(.system(size: compact ? 12 : 14, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .multilineTextAlignment(.center)
                            .foregroundColor(DT.ink)
                            .frame(width: imageSide, alignment: .center)
                    }
                    Text(en)
                        .font(.system(size: compact ? 11 : 12, weight: .regular))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .multilineTextAlignment(.center)
                        .foregroundColor(DT.ink)
                        .frame(width: imageSide, alignment: .center)
                    Text(String(format: "%.3f KWD", product.price))
                        .font(.system(size: compact ? 12 : 13, weight: .semibold))
                        .foregroundColor(DT.acc)
                        .frame(width: imageSide)
                }
                .frame(height: textBlockH)
            }
            .padding(innerPad)
        }
        .frame(width: width, height: imageSide + (compact ? 6 : 8) + textBlockH + innerPad * 2)
        .shadow(color: .black.opacity(0.04), radius: 3, x: 0, y: 1)
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

