import Foundation
import SwiftUI
import CryptoKit

#if canImport(UIKit)
import UIKit
private typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
private typealias PlatformImage = NSImage
#endif

final class ImageDiskCache {
    static let shared = ImageDiskCache()

    private let folderURL: URL
    private let fm = FileManager.default

    private init() {
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first!
        folderURL = caches.appendingPathComponent("ImageCache", conformingTo: .directory)
        try? fm.createDirectory(at: folderURL, withIntermediateDirectories: true)
    }

    // MARK: - Public API

    func hasImage(for url: URL) -> Bool {
        fm.fileExists(atPath: path(for: url).path)
    }

    func image(for url: URL) -> Image? {
        guard let data = try? Data(contentsOf: path(for: url)) else { return nil }
        #if canImport(UIKit)
        guard let ui = PlatformImage(data: data) else { return nil }
        return Image(uiImage: ui)
        #elseif canImport(AppKit)
        guard let ns = PlatformImage(data: data) else { return nil }
        return Image(nsImage: ns)
        #else
        return nil
        #endif
    }

    func data(for url: URL) -> Data? {
        try? Data(contentsOf: path(for: url))
    }

    func store(data: Data, for url: URL) {
        let p = path(for: url)
        do { try data.write(to: p, options: .atomic) } catch { }
    }

    // Try to avoid re-downloading by looking inside URLCache first,
    // then fall back to a small network fetch if necessary.
    func cachedDataFromURLCache(url: URL) -> Data? {
        let req = URLRequest(url: url)
        return URLCache.shared.cachedResponse(for: req)?.data
    }

    func storeFromURLCacheOrDownload(url: URL) async {
        if hasImage(for: url) { return }
        if let data = cachedDataFromURLCache(url: url) {
            store(data: data, for: url)
            return
        }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 20
        if let (data, _) = try? await URLSession.shared.data(for: req) {
            store(data: data, for: url)
        }
    }

    // MARK: - Internals

    private func path(for url: URL) -> URL {
        let key = url.absoluteString
        let hash = SHA256.hash(data: Data(key.utf8))
        let hex = hash.compactMap { String(format: "%02x", $0) }.joined()
        let ext = (url.pathExtension.isEmpty ? "img" : url.pathExtension)
        return folderURL.appendingPathComponent(hex).appendingPathExtension(ext)
    }
}
