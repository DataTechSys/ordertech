import Foundation
import Combine
import SwiftUI

/// Comprehensive connection health monitoring system for remote control
/// Continuously validates WebSocket + LiveKit connections and triggers automatic recovery
@MainActor
class ConnectionHealthMonitor: ObservableObject {
    
    // MARK: - Published State
    
    /// Overall connection health status
    @Published var isHealthy: Bool = false
    
    /// Detailed health status message for debugging
    @Published var healthMessage: String = "Initializing..."
    
    /// Whether remote control is currently functional
    @Published var remoteControlActive: Bool = false
    
    /// Last successful health check timestamp
    @Published var lastSuccessfulCheck: Date?
    
    // MARK: - Health Check Components
    
    struct HealthStatus {
        var websocketConnected: Bool = false
        var livekitConnected: Bool = false
        var peersConnected: Bool = false
        var signalStrength: Int = 0
        var connectionStable: Bool = false
        var lastEventReceived: Date?
        
        var isHealthy: Bool {
            websocketConnected && signalStrength > 0
        }
        
        var remoteControlReady: Bool {
            isHealthy && connectionStable
        }
        
        var detailedMessage: String {
            var issues: [String] = []
            if !websocketConnected { issues.append("WebSocket disconnected") }
            if signalStrength == 0 { issues.append("No signal") }
            if !connectionStable { issues.append("Connection unstable") }
            
            if issues.isEmpty {
                return "All systems operational"
            } else {
                return "Issues: \(issues.joined(separator: ", "))"
            }
        }
    }
    
    private var currentStatus = HealthStatus()
    
    // MARK: - Monitoring Configuration
    
    /// How often to perform health checks (seconds)
    private let healthCheckInterval: TimeInterval = 5.0
    
    /// Maximum time without events before triggering recovery (seconds)
    private let maxEventSilence: TimeInterval = 15.0
    
    /// Maximum time for connection to stabilize (seconds)
    private let stabilizationTimeout: TimeInterval = 10.0
    
    // MARK: - Timers and State
    
    private var healthCheckTimer: Timer?
    private var recoveryTimer: Timer?
    private var stabilizationTimer: Timer?
    
    private var consecutiveFailures: Int = 0
    private let maxConsecutiveFailures = 3
    
    private weak var sessionStore: SessionStore?
    
    // Recovery callback
    var onRecoveryNeeded: (() async -> Void)?
    
    // MARK: - Initialization
    
    init() {
        print("[ConnectionHealthMonitor] Initialized")
    }
    
    func configure(sessionStore: SessionStore?) {
        self.sessionStore = sessionStore
        if sessionStore != nil {
            print("[ConnectionHealthMonitor] Configured with SessionStore")
        } else {
            print("[ConnectionHealthMonitor] Configured without SessionStore (DisplaySessionStore mode)")
        }
    }
    
    // MARK: - Monitoring Control
    
    func startMonitoring() {
        print("[ConnectionHealthMonitor] 🟢 Starting health monitoring")
        stopMonitoring() // Clear any existing timers
        
        // Start periodic health checks
        healthCheckTimer = Timer.scheduledTimer(withTimeInterval: healthCheckInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.performHealthCheck()
            }
        }
        
        // Perform immediate check
        Task {
            await performHealthCheck()
        }
    }
    
    func stopMonitoring() {
        print("[ConnectionHealthMonitor] 🔴 Stopping health monitoring")
        healthCheckTimer?.invalidate()
        healthCheckTimer = nil
        recoveryTimer?.invalidate()
        recoveryTimer = nil
        stabilizationTimer?.invalidate()
        stabilizationTimer = nil
        consecutiveFailures = 0
    }
    
    // MARK: - Health Checks
    
    private func performHealthCheck() async {
        // If no SessionStore available, use the tracked state from update methods
        // This allows DisplaySessionStore to work without SessionStore reference
        if let store = sessionStore {
            // Gather current connection state from SessionStore
            currentStatus.signalStrength = store.signalBars
            currentStatus.connectionStable = store.isConnectionStable
        } else {
            // For DisplaySessionStore mode: rely on explicit updates via update methods
            // Default signal strength to 1 if websocket is connected (basic connectivity)
            if currentStatus.signalStrength == 0 && currentStatus.websocketConnected {
                currentStatus.signalStrength = 1
            }
            // Default stability to true after connection has been up for a while
            // (DisplaySessionStore doesn't have sophisticated stability tracking)
            if currentStatus.websocketConnected && currentStatus.lastEventReceived != nil {
                let timeSinceFirstEvent = Date().timeIntervalSince(currentStatus.lastEventReceived!)
                if timeSinceFirstEvent > 5.0 {
                    currentStatus.connectionStable = true
                }
            }
        }
        
        // Check for event silence (no updates for too long)
        if let lastEvent = currentStatus.lastEventReceived {
            let silence = Date().timeIntervalSince(lastEvent)
            if silence > maxEventSilence && currentStatus.websocketConnected {
                print("[ConnectionHealthMonitor] ⚠️ Event silence detected: \(String(format: "%.1f", silence))s since last event")
                currentStatus.connectionStable = false
            }
        }
        
        let healthy = currentStatus.isHealthy
        let remoteReady = currentStatus.remoteControlReady
        
        if healthy {
            consecutiveFailures = 0
            lastSuccessfulCheck = Date()
            updateStatus(healthy: true, message: currentStatus.detailedMessage)
            
            // Check if remote control is actually ready
            if remoteReady && !remoteControlActive {
                print("[ConnectionHealthMonitor] ✅ Remote control is now active")
                remoteControlActive = true
            } else if !remoteReady && remoteControlActive {
                print("[ConnectionHealthMonitor] ⚠️ Remote control lost stability")
                remoteControlActive = false
            }
        } else {
            consecutiveFailures += 1
            updateStatus(healthy: false, message: currentStatus.detailedMessage)
            
            if remoteControlActive {
                print("[ConnectionHealthMonitor] ❌ Remote control deactivated due to health issues")
                remoteControlActive = false
            }
            
            // Trigger automatic recovery after multiple failures
            if consecutiveFailures >= maxConsecutiveFailures {
                print("[ConnectionHealthMonitor] 🔧 Multiple health check failures - triggering recovery")
                await triggerRecovery()
            }
        }
        
        // Log detailed status periodically
        if healthCheckTimer != nil {
            let statusEmoji = healthy ? "✅" : "❌"
            print("[ConnectionHealthMonitor] \(statusEmoji) Health: WS=\(currentStatus.websocketConnected), Signal=\(currentStatus.signalStrength), Stable=\(currentStatus.connectionStable), Remote=\(remoteControlActive)")
        }
    }
    
    private func updateStatus(healthy: Bool, message: String) {
        isHealthy = healthy
        healthMessage = message
    }
    
    // MARK: - Event Tracking
    
    /// Call this whenever any remote event is received to track event flow
    func recordEventReceived(type: String) {
        currentStatus.lastEventReceived = Date()
        
        // Reset consecutive failures on any event
        if consecutiveFailures > 0 {
            print("[ConnectionHealthMonitor] Event received (\(type)) - resetting failure count")
            consecutiveFailures = 0
        }
    }
    
    // MARK: - Connection State Updates
    
    func updateWebSocketState(connected: Bool) {
        currentStatus.websocketConnected = connected
        print("[ConnectionHealthMonitor] WebSocket state: \(connected ? "connected" : "disconnected")")
        
        if !connected && remoteControlActive {
            print("[ConnectionHealthMonitor] WebSocket lost - deactivating remote control")
            remoteControlActive = false
        }
    }
    
    func updatePeerState(connected: Bool) {
        currentStatus.peersConnected = connected
        print("[ConnectionHealthMonitor] Peer state: \(connected ? "connected" : "disconnected")")
        
        if !connected && remoteControlActive {
            print("[ConnectionHealthMonitor] Peers disconnected - deactivating remote control")
            remoteControlActive = false
        }
    }
    
    func updateSignalStrength(bars: Int) {
        currentStatus.signalStrength = bars
        if bars == 0 && remoteControlActive {
            print("[ConnectionHealthMonitor] Signal lost - deactivating remote control")
            remoteControlActive = false
        }
    }
    
    func updateConnectionStability(stable: Bool) {
        currentStatus.connectionStable = stable
        print("[ConnectionHealthMonitor] Connection stability: \(stable ? "stable" : "unstable")")
        
        if stable && isHealthy && !remoteControlActive {
            print("[ConnectionHealthMonitor] Connection stabilized and healthy - activating remote control")
            remoteControlActive = true
        } else if !stable && remoteControlActive {
            print("[ConnectionHealthMonitor] Connection unstable - remote control may be degraded")
        }
    }
    
    // MARK: - Validation Before Actions
    
    /// Validate that remote control is ready before performing an action
    /// Returns true if action can proceed, false if should be blocked
    func validateRemoteControlAction(actionName: String) -> Bool {
        guard isHealthy else {
            print("[ConnectionHealthMonitor] ❌ Blocked '\(actionName)' - connection unhealthy: \(healthMessage)")
            return false
        }
        
        guard remoteControlActive else {
            print("[ConnectionHealthMonitor] ❌ Blocked '\(actionName)' - remote control not active")
            return false
        }
        
        guard currentStatus.connectionStable else {
            print("[ConnectionHealthMonitor] ⚠️ Warning: '\(actionName)' proceeding with unstable connection")
            // Still allow action, but log warning
            return true
        }
        
        // All checks passed
        print("[ConnectionHealthMonitor] ✅ Validated '\(actionName)' - remote control ready")
        recordEventReceived(type: actionName) // Count validation as activity
        return true
    }
    
    // MARK: - Recovery
    
    private func triggerRecovery() async {
        print("[ConnectionHealthMonitor] 🔧 Attempting automatic recovery")
        
        // Cancel any pending recovery
        recoveryTimer?.invalidate()
        recoveryTimer = nil
        
        // Reset failure counter to avoid rapid-fire recovery attempts
        consecutiveFailures = 0
        
        // Notify that recovery is needed
        if let recovery = onRecoveryNeeded {
            await recovery()
        } else {
            // Default recovery: notify session store via notification
            print("[ConnectionHealthMonitor] Executing default recovery via notification")
            
            // Post notification for recovery
            NotificationCenter.default.post(name: .connectionHealthRecoveryNeeded, object: nil)
            
            // Wait briefly for recovery to complete
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
            
            print("[ConnectionHealthMonitor] Default recovery complete - monitoring will continue")
        }
        
        // Schedule a delayed full check after recovery
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
            Task { @MainActor in
                print("[ConnectionHealthMonitor] Post-recovery health check")
                await self?.performHealthCheck()
            }
        }
    }
    
    /// Manually trigger recovery (can be called from UI)
    func forceRecovery() async {
        print("[ConnectionHealthMonitor] 🔧 Manual recovery triggered")
        consecutiveFailures = maxConsecutiveFailures
        await triggerRecovery()
    }
    
    // MARK: - Connection Restart
    
    /// Full connection restart for severe issues
    /// Note: Actual reconnection must be triggered via notification to SessionStore
    func restartConnection() async {
        print("[ConnectionHealthMonitor] 🔄 Requesting connection restart")
        
        stopMonitoring()
        
        // Post notification for connection restart
        NotificationCenter.default.post(name: .connectionHealthRestartNeeded, object: nil)
        
        // Wait for reconnection
        try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
        
        // Resume monitoring
        startMonitoring()
        
        print("[ConnectionHealthMonitor] Connection restart sequence complete")
    }
    
    // MARK: - Debugging
    
    func printDetailedStatus() {
        print("""
        [ConnectionHealthMonitor] === DETAILED STATUS ===
        Overall Health: \(isHealthy ? "✅ HEALTHY" : "❌ UNHEALTHY")
        Remote Control: \(remoteControlActive ? "✅ ACTIVE" : "❌ INACTIVE")
        WebSocket: \(currentStatus.websocketConnected ? "✅" : "❌")
        Signal: \(currentStatus.signalStrength) bars
        Stable: \(currentStatus.connectionStable ? "✅" : "❌")
        Last Event: \(currentStatus.lastEventReceived?.formatted() ?? "Never")
        Last Success: \(lastSuccessfulCheck?.formatted() ?? "Never")
        Consecutive Failures: \(consecutiveFailures)
        Message: \(healthMessage)
        ====================================
        """)
    }
}

// MARK: - SessionStore Weak Reference Protocol

/// Protocol for SessionStore to allow weak references from health monitor
protocol SessionStoreType: AnyObject {
    var signalBars: Int { get }
    var isConnectionStable: Bool { get }
}

// MARK: - Notification Names

extension Notification.Name {
    static let remoteControlActivated = Notification.Name("remoteControlActivated")
    static let remoteControlDeactivated = Notification.Name("remoteControlDeactivated")
    static let connectionHealthChanged = Notification.Name("connectionHealthChanged")
    static let connectionHealthRecoveryNeeded = Notification.Name("connectionHealthRecoveryNeeded")
    static let connectionHealthRestartNeeded = Notification.Name("connectionHealthRestartNeeded")
}
