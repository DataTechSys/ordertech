import Foundation

@available(iOS 16.0, macOS 12.0, *)
public enum FoodicsCacheStore {
    private static var fm: FileManager { FileManager.default }
    private static func baseURL() throws -> URL {
        #if os(iOS)
        let base = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        #else
        let base = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        #endif
        let dir = base.appendingPathComponent("OrderTechCore_Foodics", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) { try fm.createDirectory(at: dir, withIntermediateDirectories: true) }
        return dir
    }

    private static func url(_ name: String) throws -> URL { try baseURL().appendingPathComponent(name) }

    private struct Box<T: Codable>: Codable { let items: [T]; let syncedAt: Date }

    public static func save<T: Codable>(_ items: [T], as filename: String) throws {
        let box = Box(items: items, syncedAt: Date())
        let data = try JSONEncoder().encode(box)
        let tmp = try url(filename + ".tmp")
        let dest = try url(filename)
        try data.write(to: tmp, options: .atomic)
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
        try fm.moveItem(at: tmp, to: dest)
    }

    public static func load<T: Codable>(_ type: T.Type, from filename: String) throws -> (items: [T], syncedAt: Date) {
        let dest = try url(filename)
        let data = try Data(contentsOf: dest)
        let box = try JSONDecoder().decode(Box<T>.self, from: data)
        return (box.items, box.syncedAt)
    }

    public static var hasAnyCache: Bool {
        (try? fm.contentsOfDirectory(atPath: (try? baseURL().path) ?? "").isEmpty == false) ?? false
    }
}