import SwiftUI
import OrderTechCore

struct SquareAsyncImage: View {
    let url: URL?
    var cornerRadius: CGFloat = 6
    var animated: Bool = true
    // Slight overscan to hide white margins inside source images
    var overscan: CGFloat = 1.0

    @State private var cachedURLString: String? = nil
    @State private var cachedImage: Image? = nil

    var body: some View {
        GeometryReader { geo in
            let rect = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            let txn = animated ? Transaction(animation: .easeIn(duration: 0.15)) : Transaction(animation: nil)
            let fade: AnyTransition = animated ? .opacity : .identity
            ZStack {
                rect.fill(Color.gray.opacity(0.12))
                if let url = url {
                    AsyncImage(url: url, transaction: txn) { phase in
                        switch phase {
                        case .empty:
                            if let cachedImage, cachedURLString == url.absoluteString {
                                cachedImage
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .scaleEffect(overscan)
                                    .clipped()
                            } else {
                                Color.gray.opacity(0.1)
                                    .frame(width: geo.size.width, height: geo.size.height)
                            }
                        case .success(let img):
                            img
                                .resizable()
                                .scaledToFill()
                                .frame(width: geo.size.width, height: geo.size.height)
                                .scaleEffect(overscan)
                                .clipped()
                                .transition(fade)
                                .onAppear {
                                    cachedURLString = url.absoluteString
                                    cachedImage = img
                                }
                        case .failure:
                            Image(systemName: "photo")
                                .resizable()
                                .scaledToFit()
                                .frame(width: geo.size.width * 0.5, height: geo.size.height * 0.5)
                                .foregroundColor(.secondary)
                        @unknown default:
                            Color.gray.opacity(0.1)
                                .frame(width: geo.size.width, height: geo.size.height)
                        }
                    }
                } else {
                    Image(systemName: "photo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: geo.size.width * 0.5, height: geo.size.height * 0.5)
                        .foregroundColor(.secondary)
                }
            }
            .clipShape(rect)
            .overlay(rect.strokeBorder(DT.line, lineWidth: 1))
        }
    }
}
