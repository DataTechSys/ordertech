import SwiftUI
import OrderTechCore

// Inline Activation Page used by DisplayApp pre-activation.
// Mirrors the Cashier inline activation layout and uses the shared ActivationManager and EnvironmentStore.
struct InlineActivationPageView: View {
    @EnvironmentObject var env: EnvironmentStore
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var activation: ActivationManager

    @State private var companyId: String = ""
    @State private var activationCode: String = ""
    @State private var isSubmitting = false
    @State private var errorMsg: String? = nil
    @State private var success = false
    @State private var brandLogoURL: URL? = nil
    @FocusState private var focused: Field?
    private enum Field { case company, code }

    private var isCompanyValid: Bool { companyId.filter { $0.isNumber }.count == 6 }
    private var isCodeValid: Bool { activationCode.filter { $0.isNumber }.count == 6 }
    private var canSubmit: Bool { isCompanyValid && isCodeValid && !isSubmitting }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                HStack {
                    Spacer()
                    VStack(spacing: 24) {
                        // Title + static OrderTech logo only (no tenant logo pre-activation)
                        VStack(spacing: 12) {
                            #if canImport(UIKit)
                            if let ui = UIImage(named: "DataTech-T1") ?? UIImage(named: "OrderTech2") {
                                Image(uiImage: ui)
                                    .resizable()
                                    .scaledToFit()
                                .frame(height: 64)
                            } else {
                                Text("OrderTech").font(.title3.weight(.semibold)).foregroundColor(.secondary)
                            }
                            #else
                            Text("OrderTech").font(.title3.weight(.semibold)).foregroundColor(.secondary)
                            #endif
                            Text("Activate this device")
                                .font(.largeTitle).bold()
                        }

                        // Card
                        VStack(spacing: 20) {
                            // Company ID (6 digits)
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Company ID (6 digits)")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                TextField("123456", text: Binding(
                                    get: { companyId },
                                    set: { newVal in companyId = newVal.filter { $0.isNumber }.prefix(6).description }
                                ))
                                .font(.system(size: 34, weight: .semibold, design: .monospaced))
                                .keyboardType(.numberPad)
                                .textInputAutocapitalization(.never)
                                .disableAutocorrection(true)
                                .focused($focused, equals: .company)
                                .submitLabel(.next)
                                .frame(height: 72)
                                .padding(.horizontal, 16)
                                .background(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(isCompanyValid ? Color.green.opacity(0.7) : Color.gray.opacity(0.4), lineWidth: 2)
                                )
                            }

                            // Activation Code (6 digits)
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Activation Code")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                TextField("123456", text: Binding(
                                    get: { activationCode },
                                    set: { newVal in activationCode = newVal.filter { $0.isNumber }.prefix(6).description }
                                ))
                                .font(.system(size: 34, weight: .semibold, design: .monospaced))
                                .keyboardType(.numberPad)
                                .textInputAutocapitalization(.never)
                                .disableAutocorrection(true)
                                .focused($focused, equals: .code)
                                .submitLabel(.go)
                                .frame(height: 72)
                                .padding(.horizontal, 16)
                                .background(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(isCodeValid ? Color.green.opacity(0.7) : Color.gray.opacity(0.4), lineWidth: 2)
                                )
                            }

                            // Errors / Success
                            if let e = errorMsg { Text(e).foregroundColor(.red).font(.callout).fixedSize(horizontal: false, vertical: true) }
                            if success { Text("Activated! Setting up…").foregroundColor(.green).font(.callout) }

                            // Submit
                            Button(action: { Task { await submit() } }) {
                                HStack(spacing: 10) {
                                    if isSubmitting { ProgressView().scaleEffect(0.9) }
                                    Text("Submit").font(.system(size: 22, weight: .bold))
                                }
                                .frame(maxWidth: .infinity, minHeight: 60)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                            .disabled(!canSubmit)
                        }
                        .padding(28)
                        .frame(maxWidth: 760)
                        .background(RoundedRectangle(cornerRadius: 20).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.gray.opacity(0.15), lineWidth: 1.5))
                    }
                    .frame(maxWidth: min(geo.size.width - 40, 820))
                    .offset(y: (UIDevice.current.userInterfaceIdiom == .pad || geo.size.width >= 700) ? -120 : -40)
                    Spacer()
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .background(Color(white: 0.96))
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Button("Done") { focused = nil }
                Spacer()
                Button("Submit") { Task { await submit() } }.disabled(!canSubmit)
            }
        }
    }

    private func submit() async {
        if isSubmitting { return }
        errorMsg = nil
        success = false
        guard isCompanyValid else { errorMsg = "Enter a valid 6-digit Company ID"; return }
        guard isCodeValid else { errorMsg = "Enter a valid Activation Code"; return }
        isSubmitting = true
        defer { isSubmitting = false }
        let company = companyId.filter { $0.isNumber }
        let code = activationCode.filter { $0.isNumber }
        
        do {
            // Use Foodics activation endpoint
            guard let url = URL(string: "https://app.ordertech.me/api/foodics/devices/activate") else {
                errorMsg = "Invalid URL"
                return
            }
            
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue("application/json", forHTTPHeaderField: "accept")
            
            let payload: [String: Any] = [
                "company_id": company,
                "activation_code": code
            ]
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                errorMsg = "Invalid response"
                return
            }
            
            print("[InlineActivation] Response status: \(httpResponse.statusCode)")
            if let responseString = String(data: data, encoding: .utf8) {
                print("[InlineActivation] Response body: \(responseString)")
            }
            
            if httpResponse.statusCode == 200 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let status = json["status"] as? String,
                   status.lowercased() == "claimed",
                   let token = json["device_token"] as? String {
                    print("[InlineActivation] Activation successful")
                    
                    // Extract Foodics token if available
                    let foodicsToken = json["foodics_token"] as? String
                    
                    await MainActor.run {
                        env.tenantId = company
                        env.deviceToken = token
                        if let foodicsToken = foodicsToken, !foodicsToken.isEmpty {
                            env.foodicsToken = foodicsToken
                            print("[InlineActivation] Foodics token saved: \(foodicsToken.prefix(20))...")
                        }
                        success = true
                    }
                    await activation.updateAfterActivation(env: env, app: app)
                    return
                } else {
                    print("[InlineActivation] JSON parsing failed or status != claimed")
                }
            } else if httpResponse.statusCode == 404 {
                errorMsg = "Invalid Company ID or Activation Code"
                return
            } else if httpResponse.statusCode == 400 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let error = json["error"] as? String {
                    errorMsg = error
                } else {
                    errorMsg = "Invalid codes"
                }
                return
            }
            
            errorMsg = "Activation failed. Please check your codes and try again."
        } catch {
            errorMsg = "Error: \(error.localizedDescription)"
        }
    }
}
