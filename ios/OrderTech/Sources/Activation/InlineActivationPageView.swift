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
            // Step 1: Try to register/claim via current base (env.baseURL) — supports local core-api token issuance
            do {
                var regComps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
                regComps.path = "/device/pair/register"
                if let regURL = regComps.url {
                    var reg = URLRequest(url: regURL)
                    reg.httpMethod = "POST"
                    reg.setValue("application/json", forHTTPHeaderField: "accept")
                    reg.setValue("application/json", forHTTPHeaderField: "content-type")
                    if !company.isEmpty { reg.setValue(company, forHTTPHeaderField: "x-tenant-id") }
                    let payload: [String: Any] = [
                        "code": code,
                        "role": "display",
                        "tenant_id": company
                    ]
                    reg.httpBody = try JSONSerialization.data(withJSONObject: payload)
                    let (data, resp) = try await URLSession.shared.data(for: reg)
                    if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            let status = (obj["status"] as? String ?? "").lowercased()
                            if status == "claimed", let token = obj["device_token"] as? String, !token.isEmpty {
                                let tidObj = (obj["tenant_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                                let tid = (tidObj?.isEmpty == false) ? tidObj! : company
                                await MainActor.run { env.tenantId = tid; env.deviceToken = token; success = true }
                                await activation.updateAfterActivation(env: env, app: app)
                                return
                            }
                        }
                    }
                }
            } catch {
                // ignore; will try app host below
            }
            // Step 1b: Try Admin app host as fallback
            do {
                if let regURL = URL(string: "https://app.ordertech.me/device/pair/register") {
                    var reg = URLRequest(url: regURL)
                    reg.httpMethod = "POST"
                    reg.setValue("application/json", forHTTPHeaderField: "accept")
                    reg.setValue("application/json", forHTTPHeaderField: "content-type")
                    if !company.isEmpty { reg.setValue(company, forHTTPHeaderField: "x-tenant-id") }
                    let payload: [String: Any] = [
                        "code": code,
                        "role": "display",
                        "tenant_id": company
                    ]
                    reg.httpBody = try JSONSerialization.data(withJSONObject: payload)
                    let (data, resp) = try await URLSession.shared.data(for: reg)
                    if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            let status = (obj["status"] as? String ?? "").lowercased()
                            if status == "claimed", let token = obj["device_token"] as? String, !token.isEmpty {
                                let tidObj = (obj["tenant_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                                let tid = (tidObj?.isEmpty == false) ? tidObj! : company
                                await MainActor.run { env.tenantId = tid; env.deviceToken = token; success = true }
                                await activation.updateAfterActivation(env: env, app: app)
                                return
                            }
                        }
                    }
                }
            } catch {
                // ignore; will poll status
            }

            // Step 2: Poll status on env.baseURL, then fallback to Admin host
            var attempts = 0
            while attempts < 40 {
                attempts += 1
                // Try base first
                do {
                    var comps = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
                    comps.path = "/device/pair/\(code)/status"
                    if let url = comps.url {
                        var req = URLRequest(url: url)
                        req.httpMethod = "GET"
                        if !company.isEmpty { req.setValue(company, forHTTPHeaderField: "x-tenant-id") }
                        req.setValue("application/json", forHTTPHeaderField: "accept")
                        let (data, resp) = try await URLSession.shared.data(for: req)
                        if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                            let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                            let status = (obj?["status"] as? String ?? "").lowercased()
                            let role = (obj?["role"] as? String ?? "").lowercased()
                            if !role.isEmpty && role != "display" { errorMsg = "This code is for a different device role (\(role.uppercased()))."; break }
                            if status == "claimed", let token = obj?["device_token"] as? String, !token.isEmpty {
                                let tidObj = (obj?["tenant_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                                let tid = (tidObj?.isEmpty == false) ? tidObj! : company
                                await MainActor.run { env.tenantId = tid; env.deviceToken = token; success = true }
                                await activation.updateAfterActivation(env: env, app: app)
                                return
                            }
                            if status == "expired" { errorMsg = "Code expired — generate a new code in Admin and try again."; break }
                        }
                    }
                } catch {
                    // ignore; try admin host
                }
                // Fallback: Admin host
                do {
                    var comps = URLComponents(string: "https://app.ordertech.me/device/pair/\(code)/status")!
                    var req = URLRequest(url: comps.url!)
                    req.httpMethod = "GET"
                    if !company.isEmpty { req.setValue(company, forHTTPHeaderField: "x-tenant-id") }
                    req.setValue("application/json", forHTTPHeaderField: "accept")
                    let (data, resp) = try await URLSession.shared.data(for: req)
                    if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                        let status = (obj?["status"] as? String ?? "").lowercased()
                        let role = (obj?["role"] as? String ?? "").lowercased()
                        if !role.isEmpty && role != "display" { errorMsg = "This code is for a different device role (\(role.uppercased()))."; break }
                        if status == "claimed", let token = obj?["device_token"] as? String, !token.isEmpty {
                            let tidObj = (obj?["tenant_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                            let tid = (tidObj?.isEmpty == false) ? tidObj! : company
                            await MainActor.run { env.tenantId = tid; env.deviceToken = token; success = true }
                            await activation.updateAfterActivation(env: env, app: app)
                            return
                        }
                        if status == "expired" { errorMsg = "Code expired — generate a new code in Admin and try again."; break }
                    }
                } catch {
                    // ignore
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
            if success == false { errorMsg = "Still pending. Ask Admin to link this code to this device." }
        } catch {
            errorMsg = "Activation failed: \(error.localizedDescription)"
        }
    }
}
