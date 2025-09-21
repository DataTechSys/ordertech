import SwiftUI

struct NetBarsView: View {
    let bars: Int // 0...3
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<4, id: \.self) { i in
                let active = i < bars
                Capsule()
                    .fill(active ? Color.green : Color.gray.opacity(0.35))
                    .overlay(
                        LinearGradient(colors: [Color.green.opacity(0.9), .green], startPoint: .top, endPoint: .bottom)
                            .clipShape(Capsule())
                            .opacity(active ? 1 : 0)
                    )
                    .frame(width: 5, height: CGFloat(5 + i*6))
                    .shadow(color: active ? Color.green.opacity(0.25) : .clear, radius: 1, x: 0, y: 0.5)
            }
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.1)))
    }
}

