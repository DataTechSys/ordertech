import SwiftUI

enum DT {
    // Colors (matching css/style.css)
    static let bg = Color(hex: 0xA3B1A4)
    static let surface = Color.white
    static let ink = Color(hex: 0x2D2A26)
    static let muted = Color(hex: 0xA3B1A4)
    static let acc = Color(hex: 0x718472)
    static let live = Color(hex: 0x718472)
    static let line = Color(hex: 0xE5E7EB)

    // Metrics
    static let radius: CGFloat = 14
    static let space: CGFloat = 8
    static let space2: CGFloat = 16
    static let space3: CGFloat = 24
}

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: alpha
        )
    }
}

struct TabButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(height: 42)
            .frame(minWidth: 0, maxWidth: .infinity)
            .padding(.horizontal, 12)
            .background(DT.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DT.line, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.04), radius: 2, x: 0, y: 1)
            .scaleEffect(configuration.isPressed ? 0.997 : 1)
    }
}

struct ActionButtonStyle: ButtonStyle {
    let prominent: Bool
    var height: CGFloat = 56
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .background(DT.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(prominent ? Color(hex: 0x16A34A) : DT.line, lineWidth: prominent ? 2 : 1)
            )
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.04), radius: 2, x: 0, y: 1)
            .scaleEffect(configuration.isPressed ? 0.997 : 1)
    }
}

