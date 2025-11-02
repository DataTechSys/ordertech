import SwiftUI
import OrderTechCore

// MARK: - Connection Status Indicator
struct LocalModeIndicator: View {
    let isActive: Bool
    @EnvironmentObject var store: DisplaySessionStore
    
    var body: some View {
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone
        
        if store.peersConnected {
            // Connected to remote device - show device name only
            HStack(spacing: isPhone ? 4 : 6) {
                Circle()
                    .fill(Color.white)
                    .frame(width: isPhone ? 6 : 8, height: isPhone ? 6 : 8)
                Text(connectedUserName)
                    .font(.system(size: isPhone ? 9 : 11, weight: .bold))
                    .tracking(isPhone ? 0.3 : 0.5)
            }
            .foregroundColor(.white)
            .padding(.horizontal, isPhone ? 8 : 10)
            .padding(.vertical, isPhone ? 3 : 4)
            .background(
                Capsule()
                    .fill(Color.green)
                    .shadow(color: Color.green.opacity(0.3), radius: 2, x: 0, y: 1)
            )
            .transition(.scale.combined(with: .opacity))
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: store.peersConnected)
        } else {
            // Not connected - always show LOCAL
            HStack(spacing: isPhone ? 4 : 6) {
                Text("LOCAL")
                    .font(.system(size: isPhone ? 9 : 11, weight: .bold))
                    .tracking(isPhone ? 0.3 : 0.5)
            }
            .foregroundColor(.white)
            .padding(.horizontal, isPhone ? 8 : 10)
            .padding(.vertical, isPhone ? 3 : 4)
            .background(
                Capsule()
                    .fill(isActive ? Color.orange : Color.gray)
                    .shadow(color: (isActive ? Color.orange : Color.gray).opacity(0.3), radius: 2, x: 0, y: 1)
            )
            .transition(.scale.combined(with: .opacity))
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: !store.peersConnected)
        }
    }
    
    private var connectedUserName: String {
        // Priority 1: Use connected display name (for D2D connections)
        if let displayName = store.connectedDisplayName, !displayName.isEmpty {
            // Extract first name from display name
            let parts = displayName.components(separatedBy: [" ", "-", "_"])
            if let firstName = parts.first, firstName.count > 1 {
                return firstName.uppercased()
            }
            return displayName.uppercased()
        }
        
        // Priority 2: Use cashier name from database (fetched via fetchDisplayStatus)
        if let cashierName = store.lastCashierName, !cashierName.isEmpty {
            // Extract first name from cashier name
            let parts = cashierName.components(separatedBy: [" ", "-", "_"])
            if let firstName = parts.first, firstName.count > 1 {
                return firstName.uppercased()
            }
            return cashierName.uppercased()
        }
        
        // Priority 3: Use shortened connected display ID if available
        if let displayId = store.connectedDisplayId, !displayId.isEmpty {
            // Extract a shortened version of the device ID or use the last part
            let parts = displayId.components(separatedBy: ["-"])
            if let last = parts.last, last.count >= 4 {
                return last.prefix(8).uppercased()
            }
            return displayId.prefix(12).uppercased()
        }
        
        return "CASHIER"
    }
}

// MARK: - Checkout Button
struct LocalCheckoutButton: View {
    let basketTotal: Double
    let itemCount: Int
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Image(systemName: "creditcard")
                    .font(.system(size: 16, weight: .semibold))
                
                VStack(alignment: .leading, spacing: 2) {
                    Text("Checkout (\(itemCount) items)")
                        .font(.system(size: 14, weight: .semibold))
                    Text(String(format: "%.3f KWD", basketTotal))
                        .font(.system(size: 12))
                        .opacity(0.9)
                }
                
                Spacer()
                
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.blue)
                    .shadow(color: Color.blue.opacity(0.3), radius: 4, x: 0, y: 2)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Main Checkout Overlay
struct LocalCheckoutOverlay: View {
    @EnvironmentObject var localMode: LocalModeManager
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        ZStack {
            // Backdrop
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    localMode.cancelCheckout()
                }
            
            // Main content
            VStack(spacing: 0) {
                // Header
                header
                
                // Order summary
                orderSummary
                
                // Actions
                actionButtons
            }
            .frame(maxWidth: 800, maxHeight: 700)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Color.black.opacity(0.2), radius: 20, x: 0, y: 10)
        }
    }
    
    private var header: some View {
        HStack {
            Text("Confirm Your Order")
                .font(.title2.bold())
                .foregroundColor(.primary)
            
            Spacer()
            
            Button(action: {
                localMode.cancelCheckout()
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.secondary)
                    .padding(8)
                    .background(Circle().fill(Color.gray.opacity(0.1)))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Color.gray.opacity(0.05))
    }
    
    private var orderSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Order Summary")
                .font(.headline)
                .padding(.horizontal, 20)
            
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(localMode.localBasketLines) { line in
                        OrderLineView(line: line)
                    }
                }
                .padding(.horizontal, 20)
            }
            .frame(maxHeight: 400)
            
            Divider()
                .padding(.horizontal, 20)
            
            // Totals
            VStack(spacing: 4) {
                if localMode.localBasketTotals.tax > 0 {
                    HStack {
                        Text("Tax")
                        Spacer()
                        Text(String(format: "%.3f KWD", localMode.localBasketTotals.tax))
                            .monospacedDigit()
                    }
                }
                
                HStack {
                    Text("Total")
                        .font(.headline)
                    Spacer()
                    Text(String(format: "%.3f KWD", localMode.localBasketTotals.total))
                        .font(.headline.bold())
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.vertical, 16)
    }
    
    
    private var actionButtons: some View {
        HStack(spacing: 12) {
            Button("Cancel") {
                localMode.cancelCheckout()
            }
            .buttonStyle(SecondaryButtonStyle())
            
            Button("Send") {
                localMode.confirmOrder()
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(localMode.localBasketLines.isEmpty)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }
}

// MARK: - Order Line View
struct OrderLineView: View {
    @EnvironmentObject var env: EnvironmentStore
    let line: BasketLineUI
    
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            // Product image with AsyncImage
            Group {
                if let imageURL = line.imageURL, !imageURL.isEmpty, let url = absoluteURL(imageURL) {
                    AsyncImage(url: url) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .overlay {
                                ProgressView()
                            }
                    }
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.gray.opacity(0.2))
                        .overlay {
                            Image(systemName: "photo")
                                .foregroundColor(.gray)
                                .font(.system(size: 16))
                        }
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            
            VStack(alignment: .leading, spacing: 2) {
                Text(line.displayName)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(2)
                
                if !line.options.isEmpty {
                    Text(line.options.joined(separator: ", "))
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            
            Spacer()
            
            VStack(alignment: .trailing, spacing: 2) {
                Text("x\(line.qty)")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                
                Text(String(format: "%.3f KWD", line.lineTotal))
                    .font(.system(size: 14, weight: .semibold))
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
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

// MARK: - Payment Method Card
struct PaymentMethodCard: View {
    let method: LocalModeManager.PaymentMethod
    let isSelected: Bool
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                Image(systemName: method.icon)
                    .font(.system(size: 24))
                    .foregroundColor(isSelected ? .blue : .gray)
                
                Text(method.displayName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(isSelected ? .blue : .primary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? Color.blue.opacity(0.1) : Color.gray.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: isSelected ? 2 : 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .scaleEffect(isSelected ? 1.02 : 1.0)
        .animation(.easeInOut(duration: 0.1), value: isSelected)
    }
}

// MARK: - Confirmation Overlay
struct ConfirmationOverlay: View {
    let total: Double
    let paymentMethod: LocalModeManager.PaymentMethod
    let onConfirm: () -> Void
    let onCancel: () -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.green)
                
                Text("Confirm Order")
                    .font(.title2.bold())
                
                Text("Total: \(String(format: "%.3f KWD", total))")
                    .font(.title3)
                    .monospacedDigit()
                
                Text("Payment: \(paymentMethod.displayName)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            HStack(spacing: 16) {
                Button("Cancel", action: onCancel)
                    .buttonStyle(SecondaryButtonStyle())
                
                Button("Confirm", action: onConfirm)
                    .buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(30)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: Color.black.opacity(0.3), radius: 30, x: 0, y: 15)
    }
}

// MARK: - Receipt View
struct LocalReceiptView: View {
    @EnvironmentObject var localMode: LocalModeManager
    let receipt: LocalModeManager.LocalOrderReceipt
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    localMode.dismissReceipt()
                }
            
            VStack(spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading) {
                        Text("Order Complete!")
                            .font(.title2.bold())
                            .foregroundColor(.green)
                        
                        Text("Order #\(receipt.orderNumber)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {
                        localMode.dismissReceipt()
                    }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.secondary)
                            .padding(8)
                            .background(Circle().fill(Color.gray.opacity(0.1)))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                
                Divider()
                
                // Receipt details
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // Order details
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Items")
                                .font(.headline)
                            
                            ForEach(receipt.items) { item in
                                OrderLineView(line: item)
                            }
                        }
                        
                        Divider()
                        
                        // Totals
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Subtotal")
                                Spacer()
                                Text(String(format: "%.3f KWD", receipt.totals.subtotal))
                                    .monospacedDigit()
                            }
                            
                            if receipt.totals.tax > 0 {
                                HStack {
                                    Text("Tax")
                                    Spacer()
                                    Text(String(format: "%.3f KWD", receipt.totals.tax))
                                        .monospacedDigit()
                                }
                            }
                            
                            HStack {
                                Text("Total")
                                    .font(.headline)
                                Spacer()
                                Text(String(format: "%.3f KWD", receipt.totals.total))
                                    .font(.headline.bold())
                                    .monospacedDigit()
                            }
                        }
                        
                        Divider()
                        
                        // Payment and timestamp
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Payment Method")
                                Spacer()
                                Text(receipt.paymentMethod.displayName)
                            }
                            
                            HStack {
                                Text("Time")
                                Spacer()
                                Text(receipt.timestamp, style: .time)
                            }
                            
                            HStack {
                                Text("Date")
                                Spacer()
                                Text(receipt.timestamp, style: .date)
                            }
                        }
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
                
                // Action button
                Button("Done") {
                    localMode.dismissReceipt()
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
            .frame(maxWidth: 500, maxHeight: 600)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Color.black.opacity(0.2), radius: 20, x: 0, y: 10)
        }
    }
}

// MARK: - Button Styles
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.blue)
                    .opacity(configuration.isPressed ? 0.8 : 1.0)
            )
            .foregroundColor(.white)
            .font(.system(size: 16, weight: .semibold))
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.gray.opacity(0.1))
                    .opacity(configuration.isPressed ? 0.8 : 1.0)
            )
            .foregroundColor(.primary)
            .font(.system(size: 16, weight: .semibold))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.gray.opacity(0.3), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}