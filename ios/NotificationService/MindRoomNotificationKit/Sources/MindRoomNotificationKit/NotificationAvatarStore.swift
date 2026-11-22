import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// App Group directory-backed avatar cache shared by the main app and Notification Service Extension.
public final class NotificationAvatarStore: @unchecked Sendable {
    public static let appGroupId = "group.chat.mindroom.app"
    public static let maxAvatarBytes = 512 * 1024
    public static let maxEntriesPerAccount = 250
    // Far above any avatar. The extension has 24 MB in all, and a decoded pixel takes 4 bytes.
    public static let maxImageDimension = 2048
    public static let maxImagePixels = 4_194_304
    public static let maxStoredPixelSize = 256

    public static let shared = NotificationAvatarStore()

    private struct ManifestEntry: Codable {
        var mxcUrl: String
        var updatedAt: Double
    }

    private let baseDirectory: URL
    private let maxEntriesPerAccount: Int
    private let now: @Sendable () -> Double
    private let queue = DispatchQueue(label: "chat.mindroom.app.notification-avatar-store")

    public init(
        baseDirectory: URL,
        maxEntriesPerAccount: Int = NotificationAvatarStore.maxEntriesPerAccount,
        now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 }
    ) {
        self.baseDirectory = baseDirectory
        self.maxEntriesPerAccount = max(1, maxEntriesPerAccount)
        self.now = now
    }

    public convenience init() {
        let root: URL
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupId
        ) {
            root = container
                .appendingPathComponent("Library", isDirectory: true)
                .appendingPathComponent("Caches", isDirectory: true)
                .appendingPathComponent("MindRoomNotificationAvatars", isDirectory: true)
        } else {
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            root = caches.appendingPathComponent("MindRoomNotificationAvatars", isDirectory: true)
        }
        self.init(baseDirectory: root)
    }

    /// Validates image magic bytes, compressed size, and header-only pixel dimensions without decoding pixels.
    public static func isValidImageData(_ data: Data) -> Bool {
        inspectImage(data) != nil
    }

    /// Validates image bytes & dimensions and downsamples oversized images (> 256px) to a safe PNG thumbnail.
    public static func validatedImageData(_ data: Data) -> Data? {
        guard let inspected = inspectImage(data) else {
            return nil
        }
        if max(inspected.width, inspected.height) <= maxStoredPixelSize {
            return data
        }

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxStoredPixelSize,
            kCGImageSourceShouldCacheImmediately: false,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(
            inspected.source,
            0,
            thumbnailOptions as CFDictionary
        ) else {
            return nil
        }

        if let png = encodeImage(thumbnail, type: UTType.png.identifier as CFString),
           png.count <= maxAvatarBytes
        {
            return png
        }
        if let jpeg = encodeImage(
            thumbnail,
            type: UTType.jpeg.identifier as CFString,
            properties: [kCGImageDestinationLossyCompressionQuality: 0.85]
        ), jpeg.count <= maxAvatarBytes {
            return jpeg
        }
        return nil
    }

    // A member can have another avatar in each room, so an avatar is kept per account, room and
    // sender: one room's avatar never shows on another room's notification. A caller that knows no
    // room passes none, and reads only what was stored without one.

    public func cachedAvatar(accountTag: String, roomId: String? = nil, sender: String) -> Data? {
        guard !accountTag.isEmpty, !sender.isEmpty else { return nil }
        let key = Self.entryKey(roomId: roomId, sender: sender)
        return queue.sync {
            let fileURL = avatarFileURL(accountTag: accountTag, key: key)
            guard let data = try? Data(contentsOf: fileURL), Self.isValidImageData(data) else {
                return nil
            }
            return data
        }
    }

    public func cachedMxcUrl(accountTag: String, roomId: String? = nil, sender: String) -> String? {
        guard !accountTag.isEmpty, !sender.isEmpty else { return nil }
        let key = Self.entryKey(roomId: roomId, sender: sender)
        return queue.sync {
            let fileURL = avatarFileURL(accountTag: accountTag, key: key)
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                return nil
            }
            let manifest = loadManifest(accountTag: accountTag)
            return manifest[key]?.mxcUrl
        }
    }

    @discardableResult
    public func storeAvatar(
        accountTag: String,
        roomId: String? = nil,
        sender: String,
        mxcUrl: String,
        data: Data
    ) -> Bool {
        guard !accountTag.isEmpty,
              !sender.isEmpty,
              !mxcUrl.isEmpty,
              let sanitized = Self.validatedImageData(data) else {
            return false
        }
        let key = Self.entryKey(roomId: roomId, sender: sender)
        return queue.sync {
            let accountDir = accountDirectory(for: accountTag)
            do {
                try FileManager.default.createDirectory(
                    at: accountDir,
                    withIntermediateDirectories: true
                )
                let fileURL = avatarFileURL(accountTag: accountTag, key: key)
                try sanitized.write(to: fileURL, options: .atomic)

                var manifest = loadManifest(accountTag: accountTag)
                manifest[key] = ManifestEntry(mxcUrl: mxcUrl, updatedAt: now())

                if manifest.count > maxEntriesPerAccount {
                    let overflow = manifest.count - maxEntriesPerAccount
                    let evictedKeys = manifest
                        .sorted { lhs, rhs in
                            if lhs.value.updatedAt != rhs.value.updatedAt {
                                return lhs.value.updatedAt < rhs.value.updatedAt
                            }
                            return lhs.key < rhs.key
                        }
                        .prefix(overflow)
                        .map(\.key)

                    for evicted in evictedKeys {
                        manifest.removeValue(forKey: evicted)
                        let evictedURL = avatarFileURL(accountTag: accountTag, key: evicted)
                        try? FileManager.default.removeItem(at: evictedURL)
                    }
                }

                try saveManifest(manifest, accountTag: accountTag)
                return true
            } catch {
                return false
            }
        }
    }

    public func removeAvatar(accountTag: String, roomId: String? = nil, sender: String) {
        guard !accountTag.isEmpty, !sender.isEmpty else { return }
        let key = Self.entryKey(roomId: roomId, sender: sender)
        queue.sync {
            let fileURL = avatarFileURL(accountTag: accountTag, key: key)
            try? FileManager.default.removeItem(at: fileURL)

            var manifest = loadManifest(accountTag: accountTag)
            if manifest.removeValue(forKey: key) != nil {
                try? saveManifest(manifest, accountTag: accountTag)
            }
        }
    }

    public func clearAccount(accountTag: String) {
        guard !accountTag.isEmpty else { return }
        queue.sync {
            let accountDir = accountDirectory(for: accountTag)
            try? FileManager.default.removeItem(at: accountDir)
        }
    }

    public func clearAll() {
        queue.sync {
            try? FileManager.default.removeItem(at: baseDirectory)
        }
    }

    private static func hasValidImageMagicBytes(_ data: Data) -> Bool {
        guard !data.isEmpty, data.count <= maxAvatarBytes else {
            return false
        }
        let bytes = [UInt8](data.prefix(12))
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if bytes.count >= 8 && bytes.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
            return true
        }
        // JPEG: FF D8 FF
        if bytes.count >= 3 && bytes.starts(with: [0xFF, 0xD8, 0xFF]) {
            return true
        }
        // GIF87a / GIF89a
        if bytes.count >= 6 && (
            bytes.starts(with: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
                || bytes.starts(with: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
        ) {
            return true
        }
        // WebP: RIFF....WEBP
        if bytes.count >= 12
            && bytes.starts(with: [0x52, 0x49, 0x46, 0x46])
            && bytes[8..<12].elementsEqual([0x57, 0x45, 0x42, 0x50])
        {
            return true
        }
        return false
    }

    private static func inspectImage(_ data: Data) -> (source: CGImageSource, width: Int, height: Int)? {
        guard hasValidImageMagicBytes(data) else { return nil }

        let sourceOptions: [CFString: Any] = [
            kCGImageSourceShouldCache: false,
        ]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(
                  source,
                  0,
                  sourceOptions as CFDictionary
              ) as? [CFString: Any],
              let widthNumber = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let heightNumber = properties[kCGImagePropertyPixelHeight] as? NSNumber else {
            return nil
        }

        let width = widthNumber.intValue
        let height = heightNumber.intValue
        guard width > 0,
              height > 0,
              width <= maxImageDimension,
              height <= maxImageDimension else {
            return nil
        }
        let (totalPixels, overflow) = width.multipliedReportingOverflow(by: height)
        guard !overflow, totalPixels <= maxImagePixels else {
            return nil
        }
        return (source: source, width: width, height: height)
    }

    private static func encodeImage(
        _ image: CGImage,
        type: CFString,
        properties: [CFString: Any]? = nil
    ) -> Data? {
        let outputData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(outputData, type, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary?)
        guard CGImageDestinationFinalize(destination) else {
            return nil
        }
        let data = outputData as Data
        return data.isEmpty ? nil : data
    }

    private func accountDirectory(for accountTag: String) -> URL {
        baseDirectory.appendingPathComponent(Self.sha256Hex(accountTag), isDirectory: true)
    }

    /// The name of an avatar's file and of its manifest entry. No Matrix ID holds a NUL, so the
    /// room and the sender cannot run into each other.
    private static func entryKey(roomId: String?, sender: String) -> String {
        let room = roomId ?? ""
        return sha256Hex("\(room)\0\(sender)")
    }

    private func avatarFileURL(accountTag: String, key: String) -> URL {
        accountDirectory(for: accountTag)
            .appendingPathComponent("\(key).img", isDirectory: false)
    }

    private func manifestFileURL(accountTag: String) -> URL {
        accountDirectory(for: accountTag)
            .appendingPathComponent("manifest.json", isDirectory: false)
    }

    private func loadManifest(accountTag: String) -> [String: ManifestEntry] {
        let url = manifestFileURL(accountTag: accountTag)
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([String: ManifestEntry].self, from: data) else {
            return [:]
        }
        return decoded
    }

    private func saveManifest(_ manifest: [String: ManifestEntry], accountTag: String) throws {
        let data = try JSONEncoder().encode(manifest)
        let url = manifestFileURL(accountTag: accountTag)
        try data.write(to: url, options: .atomic)
    }

    private static func sha256Hex(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
