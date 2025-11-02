import SwiftUI
import OrderTechCore

/// Full-screen poster overlay that covers the entire display
/// - Activates on double-click in bottom-left corner
/// - Disappears on double-click anywhere or when remote session starts
struct PosterOverlayView: View {
    @EnvironmentObject var env: EnvironmentStore
    @Binding var isPresented: Bool
    let onDismiss: () -> Void
    
    @State private var posterItems: [PosterItem] = []
    @State private var currentIndex: Int = 0
    @State private var isLoading: Bool = true
    @State private var rotationTimer: Timer?
    
    // Auto-rotation every 30 seconds if multiple posters
    private let rotationInterval: TimeInterval = 30.0
    
    var body: some View {
        ZStack {
            // Full-screen black background
            Color.black
                .ignoresSafeArea(.all)
            
            // Poster content
            if isLoading {
                loadingView
            } else if posterItems.isEmpty {
                fallbackView
            } else {
                posterContentView
            }
            
            // Invisible double-tap area covering the full screen
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(count: 2) {
                    dismissPoster()
                }
                .ignoresSafeArea(.all)
        }
        .onAppear {
            loadPosters()
            startRotationTimer()
        }
        .onDisappear {
            stopRotationTimer()
        }
    }
    
    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle())
                .scaleEffect(1.5)
                .foregroundColor(.white)
            
            Text("Loading poster...")
                .font(.title2)
                .foregroundColor(.white)
        }
    }
    
    private var fallbackView: some View {
        VStack(spacing: 24) {
            Image(systemName: "photo.artframe")
                .font(.system(size: 100))
                .foregroundColor(.white.opacity(0.6))
            
            VStack(spacing: 8) {
                Text("No Poster Available")
                    .font(.largeTitle.bold())
                    .foregroundColor(.white)
                
                Text("Upload posters in the admin panel to display them here")
                    .font(.title3)
                    .foregroundColor(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
            }
            
            Text("Double-tap to dismiss")
                .font(.caption)
                .foregroundColor(.white.opacity(0.6))
                .padding(.top, 32)
        }
        .padding(40)
    }
    
    private var posterContentView: some View {
        GeometryReader { geometry in
            let currentPoster = posterItems[currentIndex]
            
            ZStack {
                // Main poster image
                AsyncImage(url: URL(string: currentPoster.url)) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } placeholder: {
                    VStack(spacing: 16) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle())
                            .scaleEffect(1.2)
                            .foregroundColor(.white)
                        
                        Text("Loading poster...")
                            .font(.title3)
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
                
                // Poster indicator dots (if multiple posters)
                if posterItems.count > 1 {
                    VStack {
                        Spacer()
                        
                        HStack(spacing: 8) {
                            ForEach(posterItems.indices, id: \.self) { index in
                                Circle()
                                    .fill(index == currentIndex ? Color.white : Color.white.opacity(0.4))
                                    .frame(width: 8, height: 8)
                            }
                        }
                        .padding(.bottom, 50)
                    }
                }
                
                // Dismiss hint in corner
                VStack {
                    HStack {
                        Spacer()
                        
                        Text("Double-tap to dismiss")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.6))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial.opacity(0.3), in: Capsule())
                    }
                    
                    Spacer()
                }
                .padding(20)
            }
        }
    }
    
    private func loadPosters() {
        Task {
            await fetchPosters()
        }
    }
    
    @MainActor
    private func fetchPosters() async {
        isLoading = true
        
        do {
            // Get tenant ID from environment
            guard let tenantId = env.tenantId else {
                print("[PosterOverlay] No tenant ID available")
                isLoading = false
                return
            }
            
            // Build API URL for posters
            var components = URLComponents(url: env.baseURL, resolvingAgainstBaseURL: false)
            components?.path = "/admin/tenants/\(tenantId)/posters"
            
            guard let url = components?.url else {
                print("[PosterOverlay] Failed to build poster URL")
                isLoading = false
                return
            }
            
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            // Add authentication headers
            if let deviceToken = env.deviceToken, !deviceToken.isEmpty {
                request.setValue(deviceToken, forHTTPHeaderField: "X-Device-Token")
                // Also add admin token for poster endpoint access
                request.setValue("test-admin-token", forHTTPHeaderField: "x-admin-token")
                request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
            }
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                print("[PosterOverlay] Invalid response type")
                isLoading = false
                return
            }
            
            guard httpResponse.statusCode == 200 else {
                print("[PosterOverlay] HTTP error: \(httpResponse.statusCode)")
                isLoading = false
                return
            }
            
            let posterResponse = try JSONDecoder().decode(PosterResponse.self, from: data)
            self.posterItems = posterResponse.items
            self.currentIndex = 0
            
            print("[PosterOverlay] Loaded \(posterItems.count) posters")
            
        } catch {
            print("[PosterOverlay] Failed to load posters: \(error)")
        }
        
        isLoading = false
    }
    
    private func startRotationTimer() {
        guard posterItems.count > 1 else { return }
        
        rotationTimer = Timer.scheduledTimer(withTimeInterval: rotationInterval, repeats: true) { _ in
            withAnimation(.easeInOut(duration: 0.5)) {
                currentIndex = (currentIndex + 1) % posterItems.count
            }
        }
    }
    
    private func stopRotationTimer() {
        rotationTimer?.invalidate()
        rotationTimer = nil
    }
    
    private func dismissPoster() {
        onDismiss()
    }
}

// MARK: - Data Models

struct PosterItem: Codable, Identifiable {
    let object: String
    let url: String
    
    var id: String { object }
}

struct PosterResponse: Codable {
    let items: [PosterItem]
}

// MARK: - Preview

#Preview {
    PosterOverlayView(isPresented: .constant(true)) {
        print("Dismissed")
    }
    .environmentObject(EnvironmentStore())
}