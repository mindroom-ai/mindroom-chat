import CryptoKit
import Foundation

/// App Group directory-backed avatar cache shared by the main app and Notification Service Extension.
public final class NotificationAvatarStore: @unchecked Sendable {
    public static let appGroupId = "group.chat.mindroom.app"
    public static let maxAvatarBytes = 512 * 1024
    public static let maxEntriesPerAccount = 250

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

    public static func isValidImageData(_ data: Data) -> Bool {
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

    public func cachedAvatar(accountTag: String, sender: String) -> Data? {
        guard !accountTag.isEmpty, !sender.isEmpty else { return nil }
        return queue.sync {
            let fileURL = avatarFileURL(accountTag: accountTag, sender: sender)
            guard let data = try? Data(contentsOf: fileURL), Self.isValidImageData(data) else {
                return nil
            }
            return data
        }
    }

    public func cachedMxcUrl(accountTag: String, sender: String) -> String? {
        guard !accountTag.isEmpty, !sender.isEmpty else { return nil }
        return queue.sync {
            let fileURL = avatarFileURL(accountTag: accountTag, sender: sender)
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                return nil
            }
            let manifest = loadManifest(accountTag: accountTag)
            return manifest[sender]?.mxcUrl
        }
    }

    @discardableResult
    public func storeAvatar(
        accountTag: String,
        sender: String,
        mxcUrl: String,
        data: Data
    ) -> Bool {
        guard !accountTag.isEmpty, !sender.isEmpty, !mxcUrl.isEmpty, Self.isValidImageData(data) else {
            return false
        }
        return queue.sync {
            let accountDir = accountDirectory(for: accountTag)
            do {
                try FileManager.default.createDirectory(
                    at: accountDir,
                    withIntermediateDirectories: true
                )
                let fileURL = avatarFileURL(accountTag: accountTag, sender: sender)
                try data.write(to: fileURL, options: .atomic)

                var manifest = loadManifest(accountTag: accountTag)
                manifest[sender] = ManifestEntry(mxcUrl: mxcUrl, updatedAt: now())

                if manifest.count > maxEntriesPerAccount {
                    let overflow = manifest.count - maxEntriesPerAccount
                    let evictedSenders = manifest
                        .sorted { lhs, rhs in
                            if lhs.value.updatedAt != rhs.value.updatedAt {
                                return lhs.value.updatedAt < rhs.value.updatedAt
                            }
                            return lhs.key < rhs.key
                        }
                        .prefix(overflow)
                        .map(\.key)

                    for evicted in evictedSenders {
                        manifest.removeValue(forKey: evicted)
                        let evictedURL = avatarFileURL(accountTag: accountTag, sender: evicted)
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

    public func removeAvatar(accountTag: String, sender: String) {
        guard !accountTag.isEmpty, !sender.isEmpty else { return }
        queue.sync {
            let fileURL = avatarFileURL(accountTag: accountTag, sender: sender)
            try? FileManager.default.removeItem(at: fileURL)

            var manifest = loadManifest(accountTag: accountTag)
            if manifest.removeValue(forKey: sender) != nil {
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

    private func accountDirectory(for accountTag: String) -> URL {
        baseDirectory.appendingPathComponent(Self.sha256Hex(accountTag), isDirectory: true)
    }

    private func avatarFileURL(accountTag: String, sender: String) -> URL {
        accountDirectory(for: accountTag)
            .appendingPathComponent("\(Self.sha256Hex(sender)).img", isDirectory: false)
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
