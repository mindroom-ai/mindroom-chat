import Foundation
import Security

/// Per-account credentials stored in the shared Keychain for the Notification Service Extension.
public struct NotificationAccountRecord: Codable, Equatable, Sendable {
    public let homeserverUrl: String
    public let userId: String
    public let accessToken: String?

    public init(homeserverUrl: String, userId: String, accessToken: String?) {
        self.homeserverUrl = homeserverUrl
        self.userId = userId
        self.accessToken = accessToken
    }
}

public protocol NotificationCredentialStoring: Sendable {
    func save(accountTag: String, record: NotificationAccountRecord)
    func load(accountTag: String) -> NotificationAccountRecord?
    func remove(accountTag: String)
    func loadSingleAccount() -> (accountTag: String, record: NotificationAccountRecord)?
}

/// Keychain-backed credential store keyed by `accountTag`.
public final class KeychainNotificationCredentialStore: NotificationCredentialStoring, Sendable {
    public static let defaultService = "chat.mindroom.app.notification-credentials"
    public static let shared = KeychainNotificationCredentialStore()

    public let service: String
    public let accessGroup: String?

    public init(
        service: String = KeychainNotificationCredentialStore.defaultService,
        accessGroup: String? = nil
    ) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func save(accountTag: String, record: NotificationAccountRecord) {
        guard !accountTag.isEmpty,
              let data = try? JSONEncoder().encode(record) else {
            return
        }

        var addQuery = baseQuery(accountTag: accountTag)
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            let updateQuery = baseQuery(accountTag: accountTag)
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            _ = SecItemUpdate(updateQuery as CFDictionary, attributes as CFDictionary)
        }
    }

    public func load(accountTag: String) -> NotificationAccountRecord? {
        guard !accountTag.isEmpty else { return nil }

        var query = baseQuery(accountTag: accountTag)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(NotificationAccountRecord.self, from: data)
    }

    public func remove(accountTag: String) {
        guard !accountTag.isEmpty else { return }
        let query = baseQuery(accountTag: accountTag)
        _ = SecItemDelete(query as CFDictionary)
    }

    public func loadSingleAccount() -> (accountTag: String, record: NotificationAccountRecord)? {
        var query = baseQuery(accountTag: nil)
        query[kSecReturnAttributes as String] = true
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitAll

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let items = result as? [[String: Any]],
              items.count == 1,
              let item = items.first,
              let accountTag = item[kSecAttrAccount as String] as? String,
              let data = item[kSecValueData as String] as? Data,
              let record = try? JSONDecoder().decode(NotificationAccountRecord.self, from: data) else {
            return nil
        }
        return (accountTag: accountTag, record: record)
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
