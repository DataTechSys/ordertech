import SwiftUI
import OrderTechCore

// MARK: - Connection Status Indicator
struct LocalModeIndicator: View {
    let isActive: Bool
    @EnvironmentObject var store: DisplaySessionStore
    
    var body: some View {
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone
        
        if isActive {
            // Local Mode (offline)
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
                    .fill(Color.orange)
                    .shadow(color: Color.orange.opacity(0.3), radius: 2, x: 0, y: 1)
            )
            .transition(.scale.combined(with: .opacity))
            .animation(.spring(response: 0.4, dampingFraction: 0.8), value: isActive)
        } else if store.peersConnected {
            // Connected to cashier
            HStack(spacing: isPhone ? 4 : 6) {
                Image(systemName: "person.circle.fill")
                    .font(.system(size: isPhone ? 10 : 12, weight: .semibold))
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
        }
    }
    
    private var connectedUserName: String {
        // Try to extract first name from friendly name or use "CASHIER" as fallback
        let name = store.friendlyName
        
        // If we have a name, try to extract just the first part
        if !name.isEmpty {
            let parts = name.components(separatedBy: [" ", "-", "_"])
            if let firstName = parts.first, firstName.count > 1 {
                return firstName.uppercased()
            }
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
    
    @State private var selectedPaymentMethod: LocalModeManager.PaymentMethod = .cash
    @State private var showingConfirmation = false
    
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
                
                // Payment method selection
                paymentMethodSelection
                
                // Actions
                actionButtons
            }
            .frame(maxWidth: 500)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Color.black.opacity(0.2), radius: 20, x: 0, y: 10)
            .scaleEffect(showingConfirmation ? 0.95 : 1.0)
            .opacity(showingConfirmation ? 0.8 : 1.0)
            .animation(.easeInOut(duration: 0.2), value: showingConfirmation)
            
            // Confirmation overlay
            if showingConfirmation {
                ConfirmationOverlay(
                    total: localMode.localBasketTotals.total,
                    paymentMethod: selectedPaymentMethod,
                    onConfirm: {
                        localMode.selectedPaymentMethod = selectedPaymentMethod
                        localMode.confirmOrder()
                        showingConfirmation = false
                    },
                    onCancel: {
                        showingConfirmation = false
                    }
                )
                .transition(.scale.combined(with: .opacity))
            }
        }
        .onAppear {
            selectedPaymentMethod = localMode.selectedPaymentMethod
        }
    }
    
    private var header: some View {
        HStack {
            Text("Checkout")
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
            .frame(maxHeight: 200)
            
            Divider()
                .padding(.horizontal, 20)
            
            // Totals
            VStack(spacing: 4) {
                HStack {
                    Text("Subtotal")
                    Spacer()
                    Text(String(format: "%.3f KWD", localMode.localBasketTotals.subtotal))
                        .monospacedDigit()
                }
                
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
    
    private var paymentMethodSelection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Payment Method")
                .font(.headline)
                .padding(.horizontal, 20)
            
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 12) {
                ForEach(LocalModeManager.PaymentMethod.allCases, id: \.rawValue) { method in
                    PaymentMethodCard(
                        method: method,
                        isSelected: selectedPaymentMethod == method,
                        onTap: {
                            selectedPaymentMethod = method
                        }
                    )
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
            
            Button("Confirm Order") {
                showingConfirmation = true
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
    let line: BasketLineUI
    
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            // Product image placeholder or async image
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.gray.opacity(0.2))
                .frame(width: 40, height: 40)
                .overlay {
                    Image(systemName: "photo")
                        .foregroundColor(.gray)
                        .font(.system(size: 16))
                }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(line.name)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                
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