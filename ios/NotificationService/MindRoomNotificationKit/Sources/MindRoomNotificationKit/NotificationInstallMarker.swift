import Foundation

/// A random ID in the App Group container that marks this installation of the app. The Keychain
/// keeps its items when the app is deleted, the container does not: a record that names another
/// installation, or none, was left by an app that is gone.
///
/// The file is in `Application Support`, which iOS does not empty to make room as it does `Caches`.
/// The app creates it; the notification extension only reads it.
public struct NotificationInstallMarker: Sendable {
    public static let shared = NotificationInstallMarker()

    private static let creationLock = NSLock()

    private let markerFileURL: URL?

    public init(markerFileURL: URL) {
        self.markerFileURL = markerFileURL
    }

    /// The marker of the App Group container. Without the container there is no marker, so
    /// nothing is shared with the extension.
    public init() {
        markerFileURL = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: NotificationAvatarStore.appGroupId)?
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("MindRoomNotifications", isDirectory: true)
            .appendingPathComponent("install-id", isDirectory: false)
    }

    /// The ID of this installation, or nil when it has none yet. Never creates one.
    public func readInstallId() -> String? {
        guard let markerFileURL,
              let data = try? Data(contentsOf: markerFileURL),
              let text = String(data: data, encoding: .utf8) else {
            return nil
        }
        let installId = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return UUID(uuidString: installId) == nil ? nil : installId
    }

    /// The ID of this installation, made on first use; nil when it cannot be written.
    public func getOrCreateInstallId() -> String? {
        // One at a time, so two first uses cannot each write an ID of their own.
        Self.creationLock.lock()
        defer { Self.creationLock.unlock() }

        if let existing = readInstallId() {
            return existing
        }
        guard let markerFileURL else { return nil }
        let installId = UUID().uuidString
        do {
            try FileManager.default.createDirectory(
                at: markerFileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try Data(installId.utf8).write(to: markerFileURL, options: .atomic)
        } catch {
            return nil
        }
        return installId
    }
}
