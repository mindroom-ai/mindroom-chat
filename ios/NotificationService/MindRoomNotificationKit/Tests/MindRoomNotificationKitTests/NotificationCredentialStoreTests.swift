import MindRoomNotificationKit
import Security
import XCTest

/// Stands in for the Keychain: items by account, and a status to answer a delete with.
final class FakeKeychain: @unchecked Sendable {
    var items: [String: Data] = [:]
    var addStatus: OSStatus?
    var deleteStatus: OSStatus?

    var operations: NotificationKeychain {
        NotificationKeychain(
            add: { query in
                if let status = self.addStatus { return status }
                guard let account = query[kSecAttrAccount as String] as? String,
                      let data = query[kSecValueData as String] as? Data else {
                    return errSecParam
                }
                if self.items[account] != nil { return errSecDuplicateItem }
                self.items[account] = data
                return errSecSuccess
            },
            update: { query, attributes in
                guard let account = query[kSecAttrAccount as String] as? String,
                      let data = attributes[kSecValueData as String] as? Data else {
                    return errSecParam
                }
                if self.items[account] == nil { return errSecItemNotFound }
                self.items[account] = data
                return errSecSuccess
            },
            copyData: { query in
                guard let account = query[kSecAttrAccount as String] as? String,
                      let data = self.items[account] else {
                    return (status: errSecItemNotFound, data: nil)
                }
                return (status: errSecSuccess, data: data)
            },
            delete: { query in
                if let status = self.deleteStatus { return status }
                if let account = query[kSecAttrAccount as String] as? String {
                    return self.items.removeValue(forKey: account) == nil ? errSecItemNotFound : errSecSuccess
                }
                if self.items.isEmpty { return errSecItemNotFound }
                self.items.removeAll()
                return errSecSuccess
            }
        )
    }
}

final class NotificationCredentialStoreTests: XCTestCase {
    private var tempDir: URL!
    private var markerURL: URL!

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("MindRoomNotificationCredentialStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        markerURL = tempDir
            .appendingPathComponent("MindRoomNotifications", isDirectory: true)
            .appendingPathComponent("install-id", isDirectory: false)
    }

    override func tearDownWithError() throws {
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
    }

    private func record(installId: String?, syncId: String? = "sync-1") -> NotificationAccountRecord {
        NotificationAccountRecord(
            homeserverUrl: "https://matrix.mindroom.chat",
            userId: "@bas:mindroom.chat",
            accessToken: "tok",
            installId: installId,
            syncId: syncId
        )
    }

    // MARK: - Install marker

    func testReadingTheInstallMarkerNeverCreatesIt() {
        let marker = NotificationInstallMarker(markerFileURL: markerURL)

        XCTAssertNil(marker.readInstallId())
        XCTAssertFalse(FileManager.default.fileExists(atPath: markerURL.path))
    }

    func testCreatesTheInstallMarkerOnceAndKeepsIt() throws {
        let marker = NotificationInstallMarker(markerFileURL: markerURL)

        let created = try XCTUnwrap(marker.getOrCreateInstallId())
        XCTAssertNotNil(UUID(uuidString: created))
        XCTAssertEqual(marker.readInstallId(), created)
        XCTAssertEqual(marker.getOrCreateInstallId(), created)
        XCTAssertEqual(NotificationInstallMarker(markerFileURL: markerURL).readInstallId(), created)
    }

    func testAMarkerThatIsNoUUIDCountsAsNoneAndIsReplaced() throws {
        try FileManager.default.createDirectory(
            at: markerURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("  \n".utf8).write(to: markerURL)
        let marker = NotificationInstallMarker(markerFileURL: markerURL)

        XCTAssertNil(marker.readInstallId())
        let created = try XCTUnwrap(marker.getOrCreateInstallId())
        XCTAssertEqual(marker.readInstallId(), created)
    }

    func testReturnsNoInstallIdWhenTheMarkerCannotBeWritten() throws {
        // A file where the marker's directory should be.
        let blocker = tempDir.appendingPathComponent("blocker", isDirectory: false)
        try Data("x".utf8).write(to: blocker)
        let marker = NotificationInstallMarker(
            markerFileURL: blocker.appendingPathComponent("install-id", isDirectory: false)
        )

        XCTAssertNil(marker.getOrCreateInstallId())
        XCTAssertNil(marker.readInstallId())
    }

    // MARK: - Records of another installation

    func testLoadsOnlyTheRecordsOfTheCurrentInstallation() throws {
        let keychain = FakeKeychain()
        let marker = NotificationInstallMarker(markerFileURL: markerURL)
        let store = KeychainNotificationCredentialStore(installMarker: marker, keychain: keychain.operations)

        // The Keychain kept a record of an installation whose marker went with the app.
        XCTAssertTrue(store.save(accountTag: "acct", record: record(installId: "11111111-1111-1111-1111-111111111111")))
        XCTAssertNil(store.load(accountTag: "acct"), "no marker: the app was installed anew")

        // The new installation has a marker of its own.
        let installId = try XCTUnwrap(marker.getOrCreateInstallId())
        XCTAssertNil(store.load(accountTag: "acct"), "another installation's record")

        XCTAssertTrue(store.save(accountTag: "legacy", record: record(installId: nil)))
        XCTAssertNil(store.load(accountTag: "legacy"), "a record that names no installation")

        XCTAssertTrue(store.save(accountTag: "acct", record: record(installId: installId)))
        XCTAssertEqual(store.load(accountTag: "acct"), record(installId: installId))
    }

    func testAStoreWithoutAMarkerLoadsWhatTheKeychainHolds() {
        let keychain = FakeKeychain()
        let store = KeychainNotificationCredentialStore(keychain: keychain.operations)

        XCTAssertTrue(store.save(accountTag: "acct", record: record(installId: nil, syncId: nil)))
        XCTAssertEqual(store.load(accountTag: "acct"), record(installId: nil, syncId: nil))
    }

    func testDecodesARecordStoredBeforeItNamedAnInstallation() throws {
        let legacy = Data(#"{"homeserverUrl":"https://matrix.mindroom.chat","userId":"@bas:mindroom.chat","accessToken":"tok"}"#.utf8)
        let decoded = try JSONDecoder().decode(NotificationAccountRecord.self, from: legacy)

        XCTAssertEqual(decoded, record(installId: nil, syncId: nil))
    }

    // MARK: - What the Keychain answers

    func testSaveReportsWhetherTheKeychainTookTheRecord() {
        let keychain = FakeKeychain()
        let store = KeychainNotificationCredentialStore(keychain: keychain.operations)

        XCTAssertTrue(store.save(accountTag: "acct", record: record(installId: "a")))
        // A second save updates the item that is there.
        XCTAssertTrue(store.save(accountTag: "acct", record: record(installId: "b")))
        XCTAssertEqual(store.load(accountTag: "acct")?.installId, "b")

        keychain.addStatus = errSecInteractionNotAllowed
        XCTAssertFalse(store.save(accountTag: "other", record: record(installId: "a")))
        XCTAssertFalse(store.save(accountTag: "", record: record(installId: "a")))
    }

    func testRemoveSucceedsOnlyWhenTheRecordIsGone() {
        let keychain = FakeKeychain()
        let store = KeychainNotificationCredentialStore(keychain: keychain.operations)
        XCTAssertTrue(store.save(accountTag: "acct", record: record(installId: "a")))
        XCTAssertTrue(store.save(accountTag: "other", record: record(installId: "a")))

        // A locked Keychain keeps the record: the caller has to try again.
        keychain.deleteStatus = errSecInteractionNotAllowed
        XCTAssertFalse(store.remove(accountTag: "acct"))
        XCTAssertFalse(store.removeAll())
        XCTAssertNotNil(store.load(accountTag: "acct"))

        keychain.deleteStatus = nil
        XCTAssertTrue(store.remove(accountTag: "acct"))
        XCTAssertNil(store.load(accountTag: "acct"))
        XCTAssertTrue(store.remove(accountTag: "acct"), "nothing left to remove")

        XCTAssertTrue(store.removeAll())
        XCTAssertNil(store.load(accountTag: "other"))
        XCTAssertTrue(store.removeAll(), "nothing left to remove")
    }

    // MARK: - The sync a record belongs to

    func testASyncKeepsItsIdThroughTokenRotationsAndStartsAnewOtherwise() {
        func synced(userId: String = "@bas:mindroom.chat", accessToken: String = "tok", installId: String = "install-1", continuing existing: NotificationAccountRecord?) -> NotificationAccountRecord {
            NotificationAccountRecord.synced(
                homeserverUrl: "https://matrix.mindroom.chat",
                userId: userId,
                accessToken: accessToken,
                installId: installId,
                continuing: existing
            )
        }

        let first = synced(continuing: nil)
        XCTAssertEqual(first.installId, "install-1")
        XCTAssertFalse(first.syncId?.isEmpty ?? true)

        let rotated = synced(accessToken: "tok-2", continuing: first)
        XCTAssertEqual(rotated.syncId, first.syncId)
        XCTAssertEqual(rotated.accessToken, "tok-2")
        XCTAssertTrue(first.isSameSync(as: rotated))

        // Cleared and shared again, another user under the tag, another installation.
        XCTAssertNotEqual(synced(continuing: nil).syncId, first.syncId)
        XCTAssertNotEqual(synced(userId: "@other:mindroom.chat", continuing: first).syncId, first.syncId)
        XCTAssertNotEqual(synced(installId: "install-2", continuing: first).syncId, first.syncId)
        XCTAssertNotEqual(synced(continuing: record(installId: "install-1", syncId: "")).syncId, "")

        XCTAssertFalse(first.isSameSync(as: nil))
        XCTAssertFalse(first.isSameSync(as: synced(continuing: nil)))
        XCTAssertFalse(first.isSameSync(as: synced(installId: "install-2", continuing: first)))
        XCTAssertFalse(record(installId: nil, syncId: nil).isSameSync(as: record(installId: nil, syncId: nil)))
    }
}
