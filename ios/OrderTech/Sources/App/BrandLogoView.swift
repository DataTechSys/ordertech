import SwiftUI
import OrderTechCore

struct BrandLogoView: View {
    @EnvironmentObject var env: EnvironmentStore
    var height: CGFloat = 28

    @State private var logoURL: URL? = nil
    @State private var triedFetch = false

    var body: some View {
        Group {
            if let url = logoURL {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFit()
                } placeholder: { Color.clear }
                .frame(height: height)
            } else {
                #if canImport(UIKit)
                if let ui = UIImage(named: "DataTech-T1") ?? UIImage(named: "OrderTech2") {
                    Image(uiImage: ui)
                        .resizable()
                        .scaledToFit()
                        .frame(height: height)
                } else {
                    Text("OrderTech Display").font(.headline)
                }
                #else
                Text("OrderTech Display").font(.headline)
                #endif
            }
        }
        .task { await loadBrand() }
    }

    private func loadBrand() async {
        if triedFetch { return }
        triedFetch = true
        do {
            let b: Brand = try await HttpClient(env: env).fetchBrand()
            if let s = b.logo_url, !s.isEmpty, let u = URL(string: s) {
                await MainActor.run { logoURL = u }
            }
        } catch {
            // Ignore; fall back to app logo
        }
    }
}
