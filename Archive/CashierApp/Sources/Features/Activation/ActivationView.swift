import SwiftUI

#if DEBUG
struct ActivationView: View {
    @EnvironmentObject var env: EnvironmentStore
    @State private var code: String = ""
    @State private var status: String = ""
    @State private var isBusy = false
    @State private var companyId: String = "" // optional in DEBUG

    var body: some View {
        Form {
            Section("Company ID (optional)") {
                TextField("123456", text: Binding(
                    get: { companyId },
                    set: { newVal in companyId = newVal.filter { $0.isNumber }.prefix(6).description }
                ))
                .keyboardType(.numberPad)
                .textInputAutocapitalization(.never)
            }
            Section("Enter 6‑digit code") {
                TextField("123456", text: $code)
                    .keyboardType(.numberPad)
                    .textInputAutocapitalization(.never)
            }
            Button {
                Task { await claim() }
            } label: {
                if isBusy { ProgressView() } else { Text("Activate") }
            }
            .disabled(code.count != 6 || isBusy)
            if !status.isEmpty {
                Text(status).foregroundColor(.secondary)
            }
        }
        .navigationTitle("Activation (DEBUG)")
    }

    private func claim() async {
        guard code.count == 6 else { return }
        isBusy = true
        defer { isBusy = false }
        let attempts = 30 // ~60s at 2s intervals
        for i in 1...attempts {
            do {
                let resp = try await ActivationAPI.pairStatus(code: code, companyId: companyId.filter { $0.isNumber })
                if (resp.status ?? "").lowercased() == "claimed", let token = resp.device_token {
                    await MainActor.run {
                        env.deviceToken = token
                        env.tenantId = resp.tenant_id
                        status = "Activated"
                    }
                    await ActivationFlow.postClaim(env: env, tenantId: resp.tenant_id)
                    return
                }
                if resp.status == "expired" { status = "Code expired — generate a new code and try again."; return }
                status = "Waiting for claim in Admin (attempt \(i)/\(attempts))…"
            } catch {
                status = "Activation check failed (attempt \(i)/\(attempts)): \(error.localizedDescription)"
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        status = "Still pending — open Admin → Devices, Add Device with this code and role Cashier, then try again."
    }
}
#else
struct ActivationView: View {
    var body: some View { EmptyView() }
}
#endif

