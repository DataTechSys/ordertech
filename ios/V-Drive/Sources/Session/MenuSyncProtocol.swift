import Foundation
import Combine
import SwiftUI

// MARK: - Menu Synchronization Protocol

/// Enhanced menu synchronization protocol that provides stable identifiers and conflict resolution
/// for menu state synchronization between Cashier and Display apps.
struct MenuSyncProtocol {
    
    // MARK: - Menu State Message Structure
    
    struct MenuStateMessage: Codable {
        let type: String = "ui:menuState"
        let basketId: String
        let deviceId: String
        let timestamp: TimeInterval
        let state: MenuState
        let authority: String // Which device is authoritative for this change
        
        struct MenuState: Codable {
            let selectedCategoryIndex: Int? // Use array index as stable identifier
            let selectedCategoryId: String?
            let selectedCategoryName: String?
            let selectedProductId: String?
            let scrollToProductId: String?
        }
    }
    
    // MARK: - Menu Sync Manager
    
    @MainActor
    class MenuSyncManager: ObservableObject {
        // Current menu state
        @Published var selectedCategoryIndex: Int? = nil
        @Published var selectedCategoryName: String? = nil
        @Published var selectedProductId: String? = nil
        @Published var scrollToProductId: String? = nil
        
        // Sync state
        private var lastChangeTimestamp: TimeInterval = 0
        private var lastChangeAuthority: String = ""
        private let deviceId: String
        private var suppressRemoteUpdates: Bool = false
        private var connectionStable: Bool = true
        
        // Broadcast callback for sending menu state to remote devices
        var onBroadcastNeeded: ((MenuStateMessage) -> Void)?
        
        // Cached state for reconnection recovery
        private var lastStableState: MenuStateMessage.MenuState?
        private var pendingStateSync: MenuStateMessage.MenuState?
        
        init(deviceId: String) {
            self.deviceId = deviceId
        }
        
        // MARK: - Local State Changes
        
        /// Update category selection from local UI interaction
        func updateCategorySelection(index: Int?, categoryId: String?, categoryName: String?) {
            print("[MenuSync] Local category change: index=\(index ?? -1), name=\(categoryName ?? "nil")")
            
            selectedCategoryIndex = index
            selectedCategoryName = categoryName
            
            // Clear product selection when category changes
            if selectedProductId != nil {
                selectedProductId = nil
                scrollToProductId = nil
            }
            
            recordLocalChange()
            broadcastMenuState()
        }
        
        /// Update product selection from local UI interaction
        func updateProductSelection(productId: String?) {
            print("[MenuSync] Local product change: \(productId ?? "nil")")
            selectedProductId = productId
            recordLocalChange()
            broadcastMenuState()
        }
        
        /// Update scroll position from local UI interaction
        func updateScrollPosition(productId: String?) {
            print("[MenuSync] Local scroll change: \(productId ?? "nil")")
            scrollToProductId = productId
            recordLocalChange()
            broadcastMenuState()
        }
        
        // MARK: - Remote State Updates
        
        /// Process incoming menu state from remote device
        func processRemoteMenuState(_ message: MenuStateMessage) -> Bool {
            print("[MenuSync] Processing remote state from \(message.deviceId) at \(message.timestamp)")
            print("[MenuSync] Remote state: categoryIndex=\(message.state.selectedCategoryIndex ?? -1), categoryName=\(message.state.selectedCategoryName ?? "nil")")
            print("[MenuSync] Current authority: \(lastChangeAuthority), Message authority: \(message.authority)")
            
            guard connectionStable else {
                print("[MenuSync] Connection unstable - queuing remote state for later")
                pendingStateSync = message.state
                return false
            }
            
            guard !suppressRemoteUpdates else {
                print("[MenuSync] Suppressing remote updates due to local activity")
                return false
            }
            
            // Only reject older timestamps when they're from the same authority
            // This allows local changes to override remote changes regardless of timestamp
            if message.timestamp <= lastChangeTimestamp && message.authority == lastChangeAuthority && message.authority != deviceId {
                print("[MenuSync] Ignoring older remote update from same authority (remote: \(message.timestamp), local: \(lastChangeTimestamp))")
                return false
            }
            
            // Always prioritize local device changes over remote changes, regardless of timestamp
            if lastChangeAuthority == deviceId && message.authority != deviceId {
                let timeSinceLastLocal = Date().timeIntervalSince1970 - lastChangeTimestamp
                if timeSinceLastLocal < 2.0 { // Give local changes precedence for 2 seconds
                    print("[MenuSync] Rejecting remote update - recent local change has precedence (\(String(format: "%.1f", timeSinceLastLocal))s ago)")
                    return false
                }
            }
            
            // Apply remote state changes
            var hasChanges = false
            
            if message.state.selectedCategoryIndex != selectedCategoryIndex ||
               message.state.selectedCategoryName != selectedCategoryName {
                selectedCategoryIndex = message.state.selectedCategoryIndex
                selectedCategoryName = message.state.selectedCategoryName
                hasChanges = true
                print("[MenuSync] Applied remote category change")
            }
            
            if message.state.selectedProductId != selectedProductId {
                selectedProductId = message.state.selectedProductId
                hasChanges = true
                print("[MenuSync] Applied remote product change")
            }
            
            if message.state.scrollToProductId != scrollToProductId {
                scrollToProductId = message.state.scrollToProductId
                hasChanges = true
                print("[MenuSync] Applied remote scroll change")
            }
            
            if hasChanges {
                lastChangeTimestamp = message.timestamp
                lastChangeAuthority = message.authority
                cacheStableState()
            }
            
            return hasChanges
        }
        
        // MARK: - Connection State Management
        
        /// Mark connection as stable/unstable to control sync behavior
        func setConnectionStable(_ stable: Bool) {
            print("[MenuSync] Connection stability changed: \(stable)")
            connectionStable = stable
            
            if stable && pendingStateSync != nil {
                print("[MenuSync] Connection stabilized - applying pending remote state")
                let message = MenuStateMessage(
                    basketId: "",
                    deviceId: "remote",
                    timestamp: Date().timeIntervalSince1970,
                    state: pendingStateSync!,
                    authority: "remote"
                )
                _ = processRemoteMenuState(message)
                pendingStateSync = nil
            }
        }
        
        /// Temporarily suppress remote updates during local activity
        func suppressRemoteUpdates(for duration: TimeInterval = 1.0) {
            suppressRemoteUpdates = true
            DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
                self?.suppressRemoteUpdates = false
                print("[MenuSync] Remote update suppression lifted")
            }
        }
        
        // MARK: - State Recovery
        
        /// Restore menu state after reconnection
        func restoreStateAfterReconnect() -> MenuStateMessage.MenuState? {
            print("[MenuSync] Restoring state after reconnect")
            return lastStableState
        }
        
        /// Force resynchronization with current state
        func forceResync() {
            print("[MenuSync] Forcing menu state resynchronization")
            recordLocalChange()
            broadcastMenuState()
        }
        
        /// Reset menu sync state to restore local control
        /// Call this when switching from remote to local mode
        func resetToLocalControl() {
            print("[MenuSync] Resetting to local control - clearing remote authority")
            suppressRemoteUpdates = false
            connectionStable = true
            pendingStateSync = nil
            
            // Clear any remote authority and establish local authority
            lastChangeTimestamp = Date().timeIntervalSince1970
            lastChangeAuthority = deviceId
            cacheStableState()
            
            print("[MenuSync] Local control restored - authority: \(lastChangeAuthority)")
        }
        
        /// Reset menu sync state to allow remote control
        /// Call this when switching from local to remote mode
        func resetToRemoteControl() {
            print("[MenuSync] Resetting to allow remote control - clearing local authority")
            suppressRemoteUpdates = false
            connectionStable = true
            pendingStateSync = nil
            
            // Clear local authority to allow remote control
            lastChangeAuthority = ""
            lastChangeTimestamp = 0
            
            print("[MenuSync] Remote control enabled - ready to accept remote commands")
        }
        
        // MARK: - Private Helpers
        
        private func recordLocalChange() {
            lastChangeTimestamp = Date().timeIntervalSince1970
            lastChangeAuthority = deviceId
            suppressRemoteUpdates(for: 0.5) // Brief suppression to prevent echo
            cacheStableState()
        }
        
        private func cacheStableState() {
            lastStableState = MenuStateMessage.MenuState(
                selectedCategoryIndex: selectedCategoryIndex,
                selectedCategoryId: nil, // Could be populated if needed
                selectedCategoryName: selectedCategoryName,
                selectedProductId: selectedProductId,
                scrollToProductId: scrollToProductId
            )
        }
        
        private func broadcastMenuState() {
            print("[MenuSync] Broadcasting menu state - timestamp: \(lastChangeTimestamp)")
            
            let message = MenuStateMessage(
                basketId: "", // Will be filled in by the calling code
                deviceId: deviceId,
                timestamp: lastChangeTimestamp,
                state: MenuStateMessage.MenuState(
                    selectedCategoryIndex: selectedCategoryIndex,
                    selectedCategoryId: nil,
                    selectedCategoryName: selectedCategoryName,
                    selectedProductId: selectedProductId,
                    scrollToProductId: scrollToProductId
                ),
                authority: lastChangeAuthority
            )
            
            onBroadcastNeeded?(message)
        }
        
        // MARK: - Category Index Resolution
        
        /// Resolve category name to stable index based on categories array
        /// Pass any object that has a name property (like Category)
        static func categoryNameToIndex<T>(_ name: String?, in items: [T]) -> Int? where T: AnyObject {
            guard let name = name else { return nil }
            return items.firstIndex { item in
                if let category = item as? NSObject,
                   let itemName = category.value(forKey: "name") as? String {
                    return itemName == name
                }
                return false
            }
        }
        
        /// Resolve category index to name based on categories array
        /// Pass any object that has a name property (like Category)
        static func categoryIndexToName<T>(_ index: Int?, in items: [T]) -> String? where T: AnyObject {
            guard let index = index, index >= 0, index < items.count else { return nil }
            let item = items[index]
            if let category = item as? NSObject,
               let itemName = category.value(forKey: "name") as? String {
                return itemName
            }
            return nil
        }
        
        /// Create menu state message for transmission
        func createMenuStateMessage(basketId: String) -> MenuStateMessage {
            return MenuStateMessage(
                basketId: basketId,
                deviceId: deviceId,
                timestamp: lastChangeTimestamp,
                state: MenuStateMessage.MenuState(
                    selectedCategoryIndex: selectedCategoryIndex,
                    selectedCategoryId: nil,
                    selectedCategoryName: selectedCategoryName,
                    selectedProductId: selectedProductId,
                    scrollToProductId: scrollToProductId
                ),
                authority: lastChangeAuthority
            )
        }
    }
}

