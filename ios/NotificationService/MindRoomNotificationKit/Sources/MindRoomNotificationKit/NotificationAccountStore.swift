import CryptoKit
import Foundation

/// What the app shares of an account with the Notification Service Extension. None of it is
/// secret: the extension has no token and makes no request.
public struct NotificationAccountMetadata: Codable, Equatable, Sendable {
    /// The account's random push tag, which each of its pushes carries as `mindroom_account`.
    public let accountTag: String
    public let userId: String
    /// One unbroken sharing of the account: a new one after the account was removed and shared again.
    public let syncId: String

    public init(accountTag: String, userId: String, syncId: String) {
        self.accountTag = accountTag
        self.userId = userId
        self.syncId = syncId
    }
}

/// The deletions of donated interactions that the system refused, to be tried again.
public struct NotificationPendingDeletes: Codable, Equatable, Sendable {
    /// Account tags: every interaction of an account is donated under its tag as the group.
    public var groupIdentifiers: [String]
    public var interactionIdentifiers: [String]

    public init(groupIdentifiers: [String] = [], interactionIdentifiers: [String] = []) {
        self.groupIdentifiers = groupIdentifiers
        self.interactionIdentifiers = interactionIdentifiers
    }
}

/// App Group files that name the accounts the app shares with the Notification Service Extension,
/// and the deletions of donated interactions that are still owed.
///
/// They are in `Application Support`, which iOS does not empty to make room as it does `Caches`,
/// and which goes with the app when it is deleted. The app writes the accounts; the extension
/// reads them, and writes only a deletion that it could not make itself.
public final class NotificationAccountStore: @unchecked Sendable {
    public static let shared = NotificationAccountStore()

    private let baseDirectory: URL
    private let lock = NSLock()

    public init(baseDirectory: URL) {
        self.baseDirectory = baseDirectory
    }

    /// The store of the App Group container. Without the container it is the process's own, which
    /// the extension does not share: its notifications then stay as the gateway sent them.
    public convenience init() {
        let applicationSupport = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: NotificationAvatarStore.appGroupId)?
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        self.init(
            baseDirectory: applicationSupport.appendingPathComponent("MindRoomNotifications", isDirectory: true)
        )
    }

    // MARK: - Accounts

    /// Stores the account; false when it could not be written. An account that is stored already
    /// for the same user keeps its `syncId`; any other gets a new one.
    @discardableResult
    public func saveAccount(accountTag: String, userId: String) -> Bool {
        guard !accountTag.isEmpty, !userId.isEmpty else { return false }
        lock.lock()
        defer { lock.unlock() }
        if let existing = readAccount(accountTag: accountTag), existing.userId == userId {
            return true
        }
        let metadata = NotificationAccountMetadata(
            accountTag: accountTag,
            userId: userId,
            syncId: UUID().uuidString
        )
        do {
            try FileManager.default.createDirectory(at: accountsDirectory, withIntermediateDirectories: true)
            try JSONEncoder().encode(metadata).write(to: accountFileURL(for: accountTag), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    public func loadAccount(accountTag: String) -> NotificationAccountMetadata? {
        guard !accountTag.isEmpty else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return readAccount(accountTag: accountTag)
    }

    public func allAccountTags() -> Set<String> {
        lock.lock()
        defer { lock.unlock() }
        let files = (try? FileManager.default.contentsOfDirectory(
            at: accountsDirectory,
            includingPropertiesForKeys: nil
        )) ?? []
        return Set(files.compactMap { Self.decodeAccount(at: $0)?.accountTag })
    }

    public func removeAccount(accountTag: String) {
        guard !accountTag.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: accountFileURL(for: accountTag))
    }

    public func removeAllAccounts() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: accountsDirectory)
    }

    // MARK: - Pending deletions of donated interactions

    public func recordPendingGroupDelete(_ groupIdentifier: String) {
        guard !groupIdentifier.isEmpty else { return }
        updatePendingDeletes { pending in
            if !pending.groupIdentifiers.contains(groupIdentifier) {
                pending.groupIdentifiers.append(groupIdentifier)
            }
        }
    }

    public func recordPendingInteractionDelete(_ interactionIdentifier: String) {
        guard !interactionIdentifier.isEmpty else { return }
        updatePendingDeletes { pending in
            if !pending.interactionIdentifiers.contains(interactionIdentifier) {
                pending.interactionIdentifiers.append(interactionIdentifier)
            }
        }
    }

    public func pendingDeletes() -> NotificationPendingDeletes {
        lock.lock()
        defer { lock.unlock() }
        return readPendingDeletes()
    }

    public func removePendingGroupDelete(_ groupIdentifier: String) {
        updatePendingDeletes { pending in
            pending.groupIdentifiers.removeAll { $0 == groupIdentifier }
        }
    }

    public func removePendingInteractionDelete(_ interactionIdentifier: String) {
        updatePendingDeletes { pending in
            pending.interactionIdentifiers.removeAll { $0 == interactionIdentifier }
        }
    }

    public func clearAllPendingDeletes() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: pendingDeletesFileURL)
    }

    // MARK: - Files

    private var accountsDirectory: URL {
        baseDirectory.appendingPathComponent("accounts", isDirectory: true)
    }

    private var pendingDeletesFileURL: URL {
        baseDirectory.appendingPathComponent("pending-interaction-deletes.json", isDirectory: false)
    }

    private func accountFileURL(for accountTag: String) -> URL {
        let digest = SHA256.hash(data: Data(accountTag.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return accountsDirectory.appendingPathComponent("\(name).json", isDirectory: false)
    }

    private static func decodeAccount(at url: URL) -> NotificationAccountMetadata? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(NotificationAccountMetadata.self, from: data)
    }

    /// Call with the lock held.
    private func readAccount(accountTag: String) -> NotificationAccountMetadata? {
        guard let metadata = Self.decodeAccount(at: accountFileURL(for: accountTag)),
              metadata.accountTag == accountTag else {
            return nil
        }
        return metadata
    }

    /// Call with the lock held.
    private func readPendingDeletes() -> NotificationPendingDeletes {
        guard let data = try? Data(contentsOf: pendingDeletesFileURL),
              let pending = try? JSONDecoder().decode(NotificationPendingDeletes.self, from: data) else {
            return NotificationPendingDeletes()
        }
        return pending
    }

    private func updatePendingDeletes(_ change: (inout NotificationPendingDeletes) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        let before = readPendingDeletes()
        var pending = before
        change(&pending)
        guard pending != before else { return }
        if pending == NotificationPendingDeletes() {
            try? FileManager.default.removeItem(at: pendingDeletesFileURL)
            return
        }
        try? FileManager.default.createDirectory(at: baseDirectory, withIntermediateDirectories: true)
        try? JSONEncoder().encode(pending).write(to: pendingDeletesFileURL, options: .atomic)
    }
}
