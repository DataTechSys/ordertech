import SwiftUI

final class ActivationBannerModel: ObservableObject {
    @Published var companyId: String = ""
    @Published var authToken: String = ""
    @Published var isSubmitting: Bool = false
    @Published var message: String? = nil

    func submit(env: EnvironmentStore) async {
        let comp = companyId.filter { $0.isNumber }
        let code = authToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard comp.count == 6, code.isEmpty == false else {
            await MainActor.run { self.message = "Enter a valid 6‑digit Company ID and Auth Token" }
            return
        }
        await MainActor.run { self.isSubmitting = true; self.message = nil }
        defer { Task { await MainActor.run { self.isSubmitting = false } } }
        // Try direct claim/register first
        if let direct = try? await ActivationAPI.claimOrRegister(companyId: comp, code: code, role: "cashier"),
           !direct.token.isEmpty, !direct.tenantId.isEmpty {
            await MainActor.run {
                env.deviceToken = direct.token
                env.tenantId = direct.tenantId
                self.message = "Activated"
            }
            await ActivationFlow.postClaim(env: env, tenantId: direct.tenantId)
            return
        }
        // Poll status on app.ordertech.me with x-tenant-id header
        let attempts = 40
        for i in 1...attempts {
            do {
                let resp = try await ActivationAPI.pairStatus(code: code, companyId: comp)
                let st = (resp.status ?? "").lowercased()
                let role = (resp.role ?? "").lowercased()
                if !role.isEmpty && role != "cashier" {
                    await MainActor.run { self.message = "This token is for a different device role (\(role))." }
                    return
                }
                if st == "claimed", let tok = resp.device_token, let tid = resp.tenant_id, !tok.isEmpty, !tid.isEmpty {
                    await MainActor.run {
                        env.deviceToken = tok
                        env.tenantId = tid
                        self.message = "Activated"
                    }
                    await ActivationFlow.postClaim(env: env, tenantId: resp.tenant_id)
                    return
                }
                if st == "expired" {
                    await MainActor.run { self.message = "Invalid or expired token — confirm Company ID and token in Admin, then try again." }
                    return
                }
                await MainActor.run { self.message = "Waiting for claim in Admin (attempt \(i)/\(attempts))…" }
            } catch {
                if i % 3 == 0 {
                    await MainActor.run { self.message = "Activation check failed: \(error.localizedDescription)" }
                }
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        await MainActor.run { self.message = "Still pending — open Admin → Devices, Add Device with this token for Cashier, then try again." }
    }
}

struct ActivationBannerView: View {
    @EnvironmentObject var env: EnvironmentStore
    @StateObject private var model = ActivationBannerModel()
    @FocusState private var focused: Field?
    private enum Field { case company, token }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Activate this device")
                .font(.headline)
                .foregroundColor(DT.ink)
            Text("Enter Company ID and Auth Token from Admin → Devices")
                .font(.caption)
                .foregroundColor(.secondary)

            VStack(spacing: 10) {
                HStack {
                    Text("Company ID")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                TextField("123456", text: Binding(
                    get: { model.companyId },
                    set: { newVal in model.companyId = newVal.filter { $0.isNumber }.prefix(6).description }
                ))
                .keyboardType(.numberPad)
                .textInputAutocapitalization(.never)
                .textContentType(.oneTimeCode)
                .focused($focused, equals: .company)
                .submitLabel(.next)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(DT.line, lineWidth: 1))

                HStack {
                    Text("Auth Token")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                TextField("e.g. 123456", text: Binding(
                    get: { model.authToken },
                    set: { newVal in model.authToken = newVal.filter { $0.isNumber } }
                ))
                    .keyboardType(.numberPad)
                    .textInputAutocapitalization(.never)
                    .textContentType(.oneTimeCode)
                    .focused($focused, equals: .token)
                    .submitLabel(.go)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(DT.line, lineWidth: 1))

                Button(action: { Task { await model.submit(env: env) } }) {
                    HStack {
                        if model.isSubmitting { ProgressView().scaleEffect(0.8) }
                        Text("Activate")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isSubmitting || model.companyId.filter{ $0.isNumber }.count != 6 || model.authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if let msg = model.message, !msg.isEmpty {
                Text(msg).font(.footnote).foregroundColor(.secondary)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DT.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.05), radius: 3, x: 0, y: 1)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Button("Done") { focused = nil }
                Spacer()
                let valid = model.companyId.filter { $0.isNumber }.count == 6 && model.authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                Button("Activate") { Task { await model.submit(env: env) } }
                    .disabled(model.isSubmitting || !valid)
            }
        }
    }
}
