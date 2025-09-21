import Foundation

enum LocalCache {
    private static var fm: FileManager { FileManager.default }

    private static func baseURL() throws -> URL {
        let appSupport = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = appSupport.appendingPathComponent("DisplayAppCache", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    static func url(for filename: String) throws -> URL {
        try baseURL().appendingPathComponent(filename)
    }

    static func saveJSON<T: Encodable>(_ value: T, to filename: String) throws {
        let data = try JSONEncoder().encode(value)
        let url = try url(for: filename)
        try data.write(to: url, options: [.atomic])
    }

    static func loadJSON<T: Decodable>(_ type: T.Type, from filename: String) throws -> T {
        let url = try url(for: filename)
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func delete(_ filename: String) throws {
        let url = try url(for: filename)
        if fm.fileExists(atPath: url.path) {
            try fm.removeItem(at: url)
        }
    }

    static var lastSyncDate: Date? {
        get { UserDefaults.standard.object(forKey: "OT.cache.lastSync") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "OT.cache.lastSync") }
    }
}
