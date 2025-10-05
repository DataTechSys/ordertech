import Foundation
import UIKit
import OrderTechCore

/// Service for managing LiveKit room pre-creation and heartbeats for DisplayApp
@MainActor
public final class LiveKitRoomService: ObservableObject {
    @Published public var roomStatus: RoomStatus = .idle
    @Published public var currentRoomName: String? = nil
    
    public enum RoomStatus: Equatable {
        case idle
        case creating
        case active
        case error(String)
        case cleanup
        
        public static func == (lhs: RoomStatus, rhs: RoomStatus) -> Bool {
            switch (lhs, rhs) {
            case (.idle, .idle), (.creating, .creating), (.active, .active), (.cleanup, .cleanup):
                return true
            case (.error(let lhsError), .error(let rhsError)):
                return lhsError == rhsError
            default:
                return false
            }
        }
    }
    
    struct RoomResponse: Codable {
        let ok: Bool
        let room: Room?
        let error: String?
        
        struct Room: Codable {
            let id: String
            let roomName: String
            let status: String
            let created: Bool
        }
    }
    
    struct HeartbeatResponse: Codable {
        let ok: Bool
        let roomName: String?
        let error: String?
    }
    
    struct APIError: Error {
        let message: String
        
        var localizedDescription: String {
            return message
        }
    }
    
    private let env: EnvironmentStore
    private let http: HttpClient
    private let deviceId: String
    
    // Use direct Cloud Run URL for API calls
    private let backendBaseURL = "https://ordertech-715493130630.me-central1.run.app"
    
    private var heartbeatTimer: Timer?
    private let heartbeatInterval: TimeInterval = 30.0 // Send heartbeat every 30 seconds
    private var isActive: Bool = false
    
    public init(env: EnvironmentStore, deviceId: String) {
        self.env = env
        self.http = HttpClient(env: env)
        self.deviceId = deviceId
    }
    
    /// Start room service - creates room and begins heartbeat
    public func startRoomService() async {
        guard !isActive else {
            print("[LiveKitRoomService] Room service already active")
            return
        }
        
        print("[LiveKitRoomService] Starting room service for device: \(deviceId)")
        roomStatus = .creating
        isActive = true
        
        do {
            // Create or register the room
            try await createRoom()
            
            // Start heartbeat timer
            startHeartbeat()
            
            roomStatus = .active
            print("[LiveKitRoomService] Room service started successfully")
        } catch {
            roomStatus = .error("Failed to create room: \(error.localizedDescription)")
            print("[LiveKitRoomService] Failed to start room service: \(error)")
            isActive = false
        }
    }
    
    /// Stop room service - cleanup room and stop heartbeat
    public func stopRoomService(reason: String = "app_stop") async {
        guard isActive else {
            print("[LiveKitRoomService] Room service not active")
            return
        }
        
        print("[LiveKitRoomService] Stopping room service, reason: \(reason)")
        roomStatus = .cleanup
        isActive = false
        
        // Stop heartbeat timer
        stopHeartbeat()
        
        // Cleanup room on server
        await cleanupRoom(reason: reason)
        
        roomStatus = .idle
        currentRoomName = nil
        print("[LiveKitRoomService] Room service stopped")
    }
    
    /// Force room cleanup without changing active state
    func forceCleanup(reason: String = "force_cleanup") async {
        print("[LiveKitRoomService] Force cleanup, reason: \(reason)")
        await cleanupRoom(reason: reason)
    }
    
    // MARK: - Private Methods
    
    private func createRoom() async throws {
        let payload: [String: Any] = [
            "displayDeviceId": deviceId,
            "roomName": deviceId, // Use device ID as room name
            "metadata": [
                "created_by": "display_app",
                "device_name": UIDevice.current.name,
                "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
            ]
        ]
        
        let data = try JSONSerialization.data(withJSONObject: payload)
        
        // Use direct URLRequest to backend since HttpClient might use different base URL
        var request = URLRequest(url: URL(string: "\(backendBaseURL)/rtc/room/create")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = env.deviceToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let tenantId = env.tenantId {
            request.setValue(tenantId, forHTTPHeaderField: "X-Tenant-Id")
        }
        request.httpBody = data
        
        let (responseData, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(RoomResponse.self, from: responseData)
        
        if response.ok, let room = response.room {
            currentRoomName = room.roomName
            print("[LiveKitRoomService] Room \(room.created ? "created" : "reused"): \(room.roomName)")
        } else {
            throw APIError(message: response.error ?? "Unknown room creation error")
        }
    }
    
    private func startHeartbeat() {
        stopHeartbeat() // Ensure no duplicate timers
        
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: heartbeatInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.sendHeartbeat()
            }
        }
        
        print("[LiveKitRoomService] Heartbeat timer started (interval: \(heartbeatInterval)s)")
    }
    
    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        print("[LiveKitRoomService] Heartbeat timer stopped")
    }
    
    private func sendHeartbeat() async {
        guard isActive else { return }
        
        do {
            let payload: [String: Any] = [
                "displayDeviceId": deviceId
            ]
            
            let data = try JSONSerialization.data(withJSONObject: payload)
            
            var request = URLRequest(url: URL(string: "\(backendBaseURL)/rtc/room/heartbeat")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let token = env.deviceToken {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            if let tenantId = env.tenantId {
                request.setValue(tenantId, forHTTPHeaderField: "X-Tenant-Id")
            }
            request.httpBody = data
            
            let (responseData, _) = try await URLSession.shared.data(for: request)
            let response = try JSONDecoder().decode(HeartbeatResponse.self, from: responseData)
            
            if response.ok {
                // Heartbeat successful - room is still active
                if let roomName = response.roomName {
                    currentRoomName = roomName
                }
            } else {
                print("[LiveKitRoomService] Heartbeat failed: \(response.error ?? "unknown error")")
                // Room might have been cleaned up - try to recreate
                if response.error?.contains("room_not_found") == true {
                    print("[LiveKitRoomService] Room not found - attempting to recreate")
                    try await createRoom()
                }
            }
        } catch {
            print("[LiveKitRoomService] Heartbeat request failed: \(error)")
            // Continue heartbeat attempts - transient network issues are common
        }
    }
    
    private func cleanupRoom(reason: String) async {
        do {
            let payload: [String: Any] = [
                "displayDeviceId": deviceId,
                "reason": reason
            ]
            
            let data = try JSONSerialization.data(withJSONObject: payload)
            
            var request = URLRequest(url: URL(string: "\(backendBaseURL)/rtc/room/cleanup")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let token = env.deviceToken {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            if let tenantId = env.tenantId {
                request.setValue(tenantId, forHTTPHeaderField: "X-Tenant-Id")
            }
            request.httpBody = data
            
            let (responseData, _) = try await URLSession.shared.data(for: request)
            let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] ?? [:]
            
            print("[LiveKitRoomService] Room cleanup completed: \(response)")
        } catch {
            print("[LiveKitRoomService] Room cleanup failed: \(error)")
            // Don't throw - cleanup failure shouldn't prevent app shutdown
        }
    }
    
    /// Get current room name for token requests
    public var roomName: String {
        return currentRoomName ?? deviceId
    }
    
    /// Check if room service is currently active
    public var isRoomActive: Bool {
        return isActive && roomStatus == .active
    }
}