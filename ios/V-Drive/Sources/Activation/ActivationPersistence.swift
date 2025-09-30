import Foundation
import SwiftUI

enum ActivationStatus: String, Codable {
    case inactive = "inactive"
    case active = "active"
    case activeGrace = "active_grace"
    case suspended = "suspended"
}

struct ActivationRecord: Codable {
    let schemaVersion: Int = 1
    let tenantId: String
    let deviceId: String?
    let displayName: String?
    let branchName: String?
    let activatedAt: Date
    var lastValidatedAt: Date?
    var lastKnownGoodAt: Date?
    var expiryHint: Date?
    var graceUntil: Date?
    var consecutiveAuthFailures: Int = 0
    var consecutiveNetworkFailures: Int = 0
    var circuitOpenedAt: Date?
    var lastErrorCode: Int?
    var lastErrorKind: String?
    
    var status: ActivationStatus {
        let now = Date()
        
        if let graceUntil = graceUntil, now <= graceUntil {
            return .activeGrace
        }
        
        if consecutiveAuthFailures >= 3 {
            return .suspended
        }
        
        return .active
    }
    
    var isActive: Bool {
        switch status {
        case .active, .activeGrace:
            return true
        case .inactive, .suspended:
            return false
        }
    }
    
    var isInGrace: Bool {
        return status == .activeGrace
    }
}

@MainActor
final class ActivationPersistence: ObservableObject {
    @Published private(set) var record: ActivationRecord?
    
    private let fileName = "activation_record.json"
    private let maxGraceHours: TimeInterval = 72 * 60 * 60 // 72 hours
    
    private var fileURL: URL {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documentsPath.appendingPathComponent(fileName)
    }
    
    func load() {
        do {
            let data = try Data(contentsOf: fileURL)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let decoded = try decoder.decode(ActivationRecord.self, from: data)
            self.record = decoded
        } catch {
            print("[ActivationPersistence] Failed to load: \(error.localizedDescription)")
            self.record = nil
        }
    }
    
    func save() {
        guard let record = record else { return }
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(record)
            try data.write(to: fileURL)
        } catch {
            print("[ActivationPersistence] Failed to save: \(error.localizedDescription)")
        }
    }
    
    func create(tenantId: String, deviceId: String?, displayName: String?, branchName: String?) {
        let now = Date()
        let graceUntil = now.addingTimeInterval(maxGraceHours)
        
        self.record = ActivationRecord(
            tenantId: tenantId,
            deviceId: deviceId,
            displayName: displayName,
            branchName: branchName,
            activatedAt: now,
            lastValidatedAt: now,
            lastKnownGoodAt: now,
            graceUntil: graceUntil
        )
        save()
    }
    
    func updateAfterSuccess() {
        guard var record = record else { return }
        
        let now = Date()
        record.lastValidatedAt = now
        record.lastKnownGoodAt = now
        record.graceUntil = now.addingTimeInterval(maxGraceHours)
        record.consecutiveAuthFailures = 0
        record.consecutiveNetworkFailures = 0
        record.circuitOpenedAt = nil
        record.lastErrorCode = nil
        record.lastErrorKind = nil
        
        self.record = record
        save()
    }
    
    func markFailure(kind: String, code: Int?) {
        guard var record = record else { return }
        
        record.lastValidatedAt = Date()
        record.lastErrorKind = kind
        record.lastErrorCode = code
        
        if kind == "unauthorized" || kind == "forbidden" {
            record.consecutiveAuthFailures += 1
        } else {
            record.consecutiveNetworkFailures += 1
        }
        
        self.record = record
        save()
    }
    
    func shouldClearToken() -> Bool {
        guard let record = record else { return false }
        
        let now = Date()
        
        // Only clear if we're outside grace period AND have persistent auth failures
        if let graceUntil = record.graceUntil, now > graceUntil {
            return record.consecutiveAuthFailures >= 3
        }
        
        return false
    }
    
    func clear() {
        self.record = nil
        try? FileManager.default.removeItem(at: fileURL)
    }
}