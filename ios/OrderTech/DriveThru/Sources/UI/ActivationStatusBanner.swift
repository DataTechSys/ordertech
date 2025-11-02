import SwiftUI

struct ActivationStatusBanner: View {
    @ObservedObject private var activationPersistence: ActivationPersistence
    
    init(activationPersistence: ActivationPersistence) {
        self.activationPersistence = activationPersistence
    }
    
    var body: some View {
        if let record = activationPersistence.record, record.isInGrace {
            VStack(spacing: 4) {
                HStack {
                    Image(systemName: "wifi.exclamationmark")
                        .foregroundColor(.orange)
                    
                    Text("Offline (Grace Period)")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.orange)
                    
                    Spacer()
                    
                    if let graceUntil = record.graceUntil {
                        Text(timeUntil(graceUntil))
                            .font(.caption)
                            .foregroundColor(.orange.opacity(0.8))
                    }
                }
                
                Text("Device will remain active until server connection is restored")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.orange.opacity(0.1))
            .cornerRadius(8)
        }
    }
    
    private func timeUntil(_ date: Date) -> String {
        let interval = date.timeIntervalSince(Date())
        if interval <= 0 { return "Expired" }
        
        let hours = Int(interval) / 3600
        let minutes = (Int(interval) % 3600) / 60
        
        if hours > 0 {
            return "\(hours)h \(minutes)m remaining"
        } else {
            return "\(minutes)m remaining"
        }
    }
}