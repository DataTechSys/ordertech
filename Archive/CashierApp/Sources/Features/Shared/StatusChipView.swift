import SwiftUI

struct StatusChipView: View {
    let status: String // READY | CONNECTED | OFFLINE | UNPAIRED
    let provider: String? // P2P | Live | Twilio
    var compact: Bool = false
    var dotOnly: Bool = false // iPhone/iPad request: dot only (green when connected, orange otherwise)

    var body: some View {
        Group {
            if dotOnly {
                HStack(spacing: compact ? 6 : 8) {
                    Circle()
                        .fill(dotColor)
                        .frame(width: compact ? 10 : 12, height: compact ? 10 : 12)
                        .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 1))
                        .accessibilityLabel(status)
                    if let p = provider, !p.isEmpty {
                        Text(p.uppercased())
                            .font(.system(size: compact ? 11 : 13, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
            } else {
                HStack(spacing: compact ? 4 : 6) {
                    Text(status)
                        .font(compact ? .caption2 : .caption)
                        .fontWeight(.semibold)
                    if let p = provider, !p.isEmpty {
                        Text(p.uppercased())
                            .font(.system(size: compact ? 9 : 11, weight: .bold))
                            .padding(.horizontal, compact ? 3 : 4)
                            .padding(.vertical, compact ? 1.5 : 2)
                            .background(RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.85)))
                            .foregroundColor(.black)
                    }
                }
                .padding(.horizontal, compact ? 8 : 10)
                .padding(.vertical, compact ? 4 : 6)
                .background(
                    RoundedRectangle(cornerRadius: 999)
                        .fill(bgColor)
                )
                .foregroundColor(.white)
            }
        }
    }

    private var bgColor: Color {
        switch status.lowercased() {
        case "connected": return Color.green
        case "offline": return Color.red
        case "unpaired": return Color.orange
        default: return Color.gray
        }
    }

    private var dotColor: Color {
        // For the dot-only iOS requirement: green when connected, orange when not connected
        if status.lowercased() == "connected" { return Color.green }
        return Color.orange
    }
}

