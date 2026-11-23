import Foundation
import Security

/// Per-account credentials stored in the shared Keychain for the Notification Service Extension.
public struct NotificationAccountRecord: Codable, Equatable, Sendable {
    public let homeserverUrl: String
    public let userId: String
    public let accessToken: String?
    /// The installation of the app that stored the record (`NotificationInstallMarker`).
    public let installId: String?
    /// One unbroken sharing of the account: the same through token rotations, a new one after
    /// the account was cleared and shared again.
    public let syncId: String?

    public init(
        homeserverUrl: String,
        userId: String,
        accessToken: String?,
        installId: String? = nil,
        syncId: String? = nil
    ) {
        self.homeserverUrl = homeserverUrl
        self.userId = userId
        self.accessToken = accessToken
        self.installId = installId
        self.syncId = syncId
    }

    /// The record to store for a sync of the account. It carries on `existing`, keeping its
    /// `syncId`, when that is the same user on the same installation; otherwise it starts anew.
    public static func synced(
        homeserverUrl: String,
        userId: String,
        accessToken: String?,
        installId: String,
        continuing existing: NotificationAccountRecord?
    ) -> NotificationAccountRecord {
        var syncId = UUID().uuidString
        if let existing,
           existing.userId == userId,
           existing.installId == installId,
           let existingSyncId = existing.syncId,
           !existingSyncId.isEmpty
        {
            syncId = existingSyncId
        }
        return NotificationAccountRecord(
            homeserverUrl: homeserverUrl,
            userId: userId,
            accessToken: accessToken,
            installId: installId,
            syncId: syncId
        )
    }

    /// Whether `other` is this very sharing of the account, not a later one and not none.
    public func isSameSync(as other: NotificationAccountRecord?) -> Bool {
        guard let other,
              let installId, !installId.isEmpty,
              let syncId, !syncId.isEmpty else {
            return false
        }
        return other.installId == installId && other.syncId == syncId
    }
}

public protocol NotificationCredentialStoring: Sendable {
    @discardableResult func save(accountTag: String, record: NotificationAccountRecord) -> Bool
    func load(accountTag: String) -> NotificationAccountRecord?
    @discardableResult func remove(accountTag: String) -> Bool
    @discardableResult func removeAll() -> Bool
}

/// The Keychain calls of `KeychainNotificationCredentialStore`, so that a test can stand in for
/// the Keychain, which a test run cannot rely on.
public struct NotificationKeychain: Sendable {
    public var add: @Sendable (_ query: [String: Any]) -> OSStatus
    public var update: @Sendable (_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus
    public var copyData: @Sendable (_ query: [String: Any]) -> (status: OSStatus, data: Data?)
    public var delete: @Sendable (_ query: [String: Any]) -> OSStatus

    public init(
        add: @escaping @Sendable (_ query: [String: Any]) -> OSStatus,
        update: @escaping @Sendable (_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus,
        copyData: @escaping @Sendable (_ query: [String: Any]) -> (status: OSStatus, data: Data?),
        delete: @escaping @Sendable (_ query: [String: Any]) -> OSStatus
    ) {
        self.add = add
        self.update = update
        self.copyData = copyData
        self.delete = delete
    }

    public static let system = NotificationKeychain(
        add: { query in SecItemAdd(query as CFDictionary, nil) },
        update: { query, attributes in SecItemUpdate(query as CFDictionary, attributes as CFDictionary) },
        copyData: { query in
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            return (status: status, data: result as? Data)
        },
        delete: { query in SecItemDelete(query as CFDictionary) }
    )
}

/// Keychain-backed credential store keyed by `accountTag`.
public final class KeychainNotificationCredentialStore: NotificationCredentialStoring, Sendable {
    public static let defaultService = "chat.mindroom.app.notification-credentials"
    public static let shared = KeychainNotificationCredentialStore(
        installMarker: NotificationInstallMarker.shared
    )

    public let service: String
    public let accessGroup: String?
    private let installMarker: NotificationInstallMarker?
    private let keychain: NotificationKeychain

    /// With an `installMarker`, only the records of the current installation are loaded.
    public init(
        service: String = KeychainNotificationCredentialStore.defaultService,
        accessGroup: String? = nil,
        installMarker: NotificationInstallMarker? = nil,
        keychain: NotificationKeychain = .system
    ) {
        self.service = service
        self.accessGroup = accessGroup
        self.installMarker = installMarker
        self.keychain = keychain
    }

    /// Whether the Keychain holds the record now.
    @discardableResult
    public func save(accountTag: String, record: NotificationAccountRecord) -> Bool {
        guard !accountTag.isEmpty,
              let data = try? JSONEncoder().encode(record) else {
            return false
        }

        var addQuery = baseQuery(accountTag: accountTag)
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        var status = keychain.add(addQuery)
        if status == errSecDuplicateItem {
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            status = keychain.update(baseQuery(accountTag: accountTag), attributes)
        }
        return status == errSecSuccess
    }

    public func load(accountTag: String) -> NotificationAccountRecord? {
        guard !accountTag.isEmpty else { return nil }

        var query = baseQuery(accountTag: accountTag)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        let result = keychain.copyData(query)
        guard result.status == errSecSuccess,
              let data = result.data,
              let record = try? JSONDecoder().decode(NotificationAccountRecord.self, from: data) else {
            return nil
        }
        // The Keychain outlives the app: a record of an earlier installation is not this one's.
        if let installMarker {
            guard let current = installMarker.readInstallId(),
                  !current.isEmpty,
                  record.installId == current else {
                return nil
            }
        }
        return record
    }

    /// Whether the Keychain holds no record of the account now.
    @discardableResult
    public func remove(accountTag: String) -> Bool {
        guard !accountTag.isEmpty else { return true }
        return Self.isGone(keychain.delete(baseQuery(accountTag: accountTag)))
    }

    /// Whether the Keychain holds no record of any account now: a delete that names no account
    /// matches them all.
    @discardableResult
    public func removeAll() -> Bool {
        Self.isGone(keychain.delete(baseQuery(accountTag: nil)))
    }

    private static func isGone(_ deleteStatus: OSStatus) -> Bool {
        deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound
    }

    private func baseQuery(accountTag: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        if let accessGroup, !accessGroup.isEmpty {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        if let accountTag {
            query[kSecAttrAccount as String] = accountTag
        }
        return query
    }
}
