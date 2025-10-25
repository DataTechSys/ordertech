import SwiftUI

enum DT {
    // Colors (matching Cashier tokens)
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
