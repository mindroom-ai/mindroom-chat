import CryptoKit
import Foundation
import MatrixRustSDK
import Security

/// The watch's signed-in session and its store passphrase in the Keychain, and the SDK store's folders.
enum SessionStore {
    private static let sessionItem = "chat.mindroom.watch.session"
    private static let passphraseItem = "chat.mindroom.watch.store-passphrase"

    private struct Saved: Codable {
        let accessToken: String
        let userId: String
        let deviceId: String
        let homeserverUrl: String
    }

    static func save(_ session: Session) throws {
        let saved = Saved(accessToken: session.accessToken, userId: session.userId,
                          deviceId: session.deviceId, homeserverUrl: session.homeserverUrl)
        try write(sessionItem, try JSONEncoder().encode(saved))
    }

    static func load() -> Session? {
        guard let data = read(sessionItem), let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return nil }
        return Session(accessToken: saved.accessToken, refreshToken: nil, userId: saved.userId, deviceId: saved.deviceId,
                       homeserverUrl: saved.homeserverUrl, oauthData: nil, slidingSyncVersion: .native)
    }

    /// The SQLite store's passphrase: 32 random bytes made once per install. A Keychain that cannot be read
    /// right now (before the first unlock), or that does not keep a new one, throws: another passphrase
    /// next time would lock the store out for good.
    static func passphrase() throws -> String {
        var item = query(passphraseItem)
        item[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(item as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data { return String(decoding: data, as: UTF8.self) }
        guard status == errSecItemNotFound else { throw SessionStoreError.keychain(status) }
        let value = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).base64EncodedString() }
        try write(passphraseItem, Data(value.utf8))
        return value
    }

    /// The store's data and cache folders of a sign-in: one per account and device, so a new account or
    /// a reconnect starts empty, away from the folders of a client that may still be closing.
    static func paths(_ session: Session) -> (data: URL, cache: URL) {
        let (data, cache) = folders(session)
        try? FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        return (data, cache)
    }

    /// Whether the sign-in's store is on disk. Deleting the app deletes it and keeps the Keychain.
    static func hasStore(_ session: Session) -> Bool {
        FileManager.default.fileExists(atPath: folders(session).data.path)
    }

    private static func folders(_ session: Session) -> (data: URL, cache: URL) {
        let name = SHA256.hash(data: Data("\(session.userId) \(session.deviceId)".utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        let fileManager = FileManager.default
        return (fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("matrix/\(name)"),
                fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("matrix/\(name)"))
    }

    /// Forgets the saved session and deletes its store.
    static func clear() {
        if let session = load() { removeStore(session) }
        delete(sessionItem)
    }

    static func removeStore(_ session: Session) {
        let (data, cache) = folders(session)
        try? FileManager.default.removeItem(at: data)
        try? FileManager.default.removeItem(at: cache)
    }

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "chat.mindroom.watch",
         kSecAttrAccount as String: account]
    }

    private static func write(_ account: String, _ data: Data) throws {
        delete(account)
        var item = query(account)
        item[kSecValueData as String] = data
        // Background refresh syncs while the watch is locked on the wrist.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw SessionStoreError.keychain(status) }
    }

    private static func read(_ account: String) -> Data? {
        var item = query(account)
        item[kSecReturnData as String] = true
        var result: CFTypeRef?
        return SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess ? result as? Data : nil
    }

    private static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}

enum SessionStoreError: Error {
    case keychain(OSStatus)
}
