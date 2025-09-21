import SwiftUI

struct InlineActivationPageView: View {
    @EnvironmentObject var env: EnvironmentStore

    @State private var companyId: String = ""
    @State private var activationCode: String = ""
    @State private var isSubmitting = false
    @State private var errorMsg: String? = nil
    @State private var success = false
    @FocusState private var focused: Field?
    private enum Field { case company, code }

    private var isCompanyValid: Bool { companyId.filter { $0.isNumber }.count == 6 }
    private var isCodeValid: Bool { activationCode.filter { $0.isNumber }.count == 6 }
    private var canSubmit: Bool { isCompanyValid && isCodeValid && !isSubmitting }

    var body: some View {
        VStack(spacing: 0) {
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
                    if let e = errorMsg {
                        Text(e)
                            .foregroundColor(.red)
                            .font(.callout)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if success {
                        Text("Activated! Setting up…")
                            .foregroundColor(.green)
                            .font(.callout)
                    }

                    // Submit
                    Button(action: { Task { await submit() } }) {
                        HStack(spacing: 10) {
                            if isSubmitting { ProgressView().scaleEffect(0.9) }
                            Text("Submit")
                                .font(.system(size: 22, weight: .bold))
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
            Spacer(minLength: 0)
        }
        .padding(.top, 60)
        .padding(.horizontal, 40)
        .background(Color(white: 0.96))
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Button("Done") { focused = nil }
                Spacer()
                Button("Submit") { Task { await submit() } }
                    .disabled(!canSubmit)
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
            // Try direct claim/register first
            if let direct = try? await ActivationAPI.claimOrRegister(companyId: company, code: code, role: "cashier"),
               !direct.token.isEmpty, !direct.tenantId.isEmpty {
                await MainActor.run {
                    env.deviceToken = direct.token
                    env.tenantId = direct.tenantId
                    success = true
                }
                await ActivationFlow.postClaim(env: env, tenantId: direct.tenantId)
                return
            }
            // Poll status
            var attempts = 0
            while attempts < 40 {
                attempts += 1
                let resp = try await ActivationAPI.pairStatus(code: code, companyId: company)
                let st = (resp.status ?? "").lowercased()
                if st == "claimed", let tok = resp.device_token, let tid = resp.tenant_id, !tok.isEmpty, !tid.isEmpty {
                    await MainActor.run {
                        env.deviceToken = tok
                        env.tenantId = tid
                        success = true
                    }
                    await ActivationFlow.postClaim(env: env, tenantId: tid)
                    return
                }
                if st == "expired" { errorMsg = "Code expired — generate a new code in Admin and try again."; break }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
            if success == false { errorMsg = "Still pending. Ask Admin to link this code to this device." }
        } catch {
            errorMsg = "Activation failed: \(error.localizedDescription)"
        }
    }
}