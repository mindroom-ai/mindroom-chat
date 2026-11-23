import CryptoKit
import MindRoomNotificationKit
import XCTest

final class NotificationAccountStoreTests: XCTestCase {
    private var tempDir: URL!
    private var store: NotificationAccountStore!

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("MindRoomNotificationAccountStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        store = NotificationAccountStore(baseDirectory: tempDir)
    }

    override func tearDownWithError() throws {
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
    }

    private var accountsDirectory: URL {
        tempDir.appendingPathComponent("accounts", isDirectory: true)
    }

    private func accountFile(_ accountTag: String) -> URL {
        let name = SHA256.hash(data: Data(accountTag.utf8)).map { String(format: "%02x", $0) }.joined()
        return accountsDirectory.appendingPathComponent("\(name).json")
    }

    // MARK: - Accounts

    func testStoresAnAccountUnderTheHashOfItsTagWithNothingSecret() throws {
        XCTAssertNil(store.loadAccount(accountTag: "tag-1"))
        XCTAssertEqual(store.allAccountTags(), [])

        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))

        let account = try XCTUnwrap(store.loadAccount(accountTag: "tag-1"))
        XCTAssertEqual(account.accountTag, "tag-1")
        XCTAssertEqual(account.userId, "@bas:mindroom.chat")
        XCTAssertNotNil(UUID(uuidString: account.syncId))

        // The file's name does not give the tag away, and it holds these three values only:
        // no token and no homeserver.
        let files = try FileManager.default.contentsOfDirectory(atPath: accountsDirectory.path)
        XCTAssertEqual(files, [accountFile("tag-1").lastPathComponent])
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: accountFile("tag-1")))
        let stored = try XCTUnwrap(json as? [String: String])
        XCTAssertEqual(stored, ["accountTag": "tag-1", "userId": "@bas:mindroom.chat", "syncId": account.syncId])
    }

    func testKeepsTheSyncIdOfAnAccountStoredAgainForTheSameUser() throws {
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))
        let first = try XCTUnwrap(store.loadAccount(accountTag: "tag-1"))

        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))

        XCTAssertEqual(store.loadAccount(accountTag: "tag-1"), first)
        // Another store of the same directory, as the extension has, reads the same account.
        XCTAssertEqual(NotificationAccountStore(baseDirectory: tempDir).loadAccount(accountTag: "tag-1"), first)
    }

    func testStartsANewSyncForAnotherUserAndAfterARemoval() throws {
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))
        let first = try XCTUnwrap(store.loadAccount(accountTag: "tag-1"))

        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@other:mindroom.chat"))
        let otherUser = try XCTUnwrap(store.loadAccount(accountTag: "tag-1"))
        XCTAssertEqual(otherUser.userId, "@other:mindroom.chat")
        XCTAssertNotEqual(otherUser.syncId, first.syncId)

        store.removeAccount(accountTag: "tag-1")
        XCTAssertNil(store.loadAccount(accountTag: "tag-1"))
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@other:mindroom.chat"))
        let sharedAgain = try XCTUnwrap(store.loadAccount(accountTag: "tag-1"))
        XCTAssertNotEqual(sharedAgain.syncId, otherUser.syncId)
    }

    func testListsAndRemovesAccounts() {
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@one:x"))
        XCTAssertTrue(store.saveAccount(accountTag: "tag-2", userId: "@two:x"))
        XCTAssertTrue(store.saveAccount(accountTag: "tag-3", userId: "@three:x"))
        XCTAssertEqual(store.allAccountTags(), ["tag-1", "tag-2", "tag-3"])

        store.removeAccount(accountTag: "tag-2")
        store.removeAccount(accountTag: "never-stored")
        XCTAssertEqual(store.allAccountTags(), ["tag-1", "tag-3"])
        XCTAssertNil(store.loadAccount(accountTag: "tag-2"))
        XCTAssertNotNil(store.loadAccount(accountTag: "tag-1"))

        store.removeAllAccounts()
        XCTAssertEqual(store.allAccountTags(), [])
        XCTAssertNil(store.loadAccount(accountTag: "tag-1"))
        XCTAssertNil(store.loadAccount(accountTag: "tag-3"))
    }

    func testStoresNoAccountWithoutATagOrAUserOrADirectoryToWriteTo() throws {
        XCTAssertFalse(store.saveAccount(accountTag: "", userId: "@bas:mindroom.chat"))
        XCTAssertFalse(store.saveAccount(accountTag: "tag-1", userId: ""))
        XCTAssertNil(store.loadAccount(accountTag: ""))
        XCTAssertEqual(store.allAccountTags(), [])

        // A file where the directory would be: nothing can be written below it.
        let blocker = tempDir.appendingPathComponent("blocker")
        try Data("x".utf8).write(to: blocker)
        let unwritable = NotificationAccountStore(baseDirectory: blocker.appendingPathComponent("store"))
        XCTAssertFalse(unwritable.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))
        XCTAssertNil(unwritable.loadAccount(accountTag: "tag-1"))
    }

    func testIgnoresAFileThatIsNoAccountOrNamesAnotherOne() throws {
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))
        try Data("not json".utf8).write(to: accountFile("tag-2"))
        // The record of tag-1 under the name of tag-3.
        try FileManager.default.copyItem(at: accountFile("tag-1"), to: accountFile("tag-3"))

        XCTAssertNil(store.loadAccount(accountTag: "tag-2"))
        XCTAssertNil(store.loadAccount(accountTag: "tag-3"))
        XCTAssertEqual(store.allAccountTags(), ["tag-1"])
    }

    // MARK: - Pending deletions

    func testNotesDownAndStrikesOffPendingDeletes() {
        XCTAssertEqual(store.pendingDeletes(), NotificationPendingDeletes())

        store.recordPendingGroupDelete("tag-1")
        store.recordPendingGroupDelete("tag-2")
        store.recordPendingGroupDelete("tag-1")
        store.recordPendingGroupDelete("")
        store.recordPendingInteractionDelete("interaction-1")
        store.recordPendingInteractionDelete("interaction-2")
        store.recordPendingInteractionDelete("interaction-1")
        store.recordPendingInteractionDelete("")

        // Each once, in the order noted down.
        XCTAssertEqual(
            store.pendingDeletes(),
            NotificationPendingDeletes(
                groupIdentifiers: ["tag-1", "tag-2"],
                interactionIdentifiers: ["interaction-1", "interaction-2"]
            )
        )

        store.removePendingGroupDelete("tag-1")
        store.removePendingGroupDelete("never-noted")
        store.removePendingInteractionDelete("interaction-2")
        XCTAssertEqual(
            store.pendingDeletes(),
            NotificationPendingDeletes(groupIdentifiers: ["tag-2"], interactionIdentifiers: ["interaction-1"])
        )

        store.clearAllPendingDeletes()
        XCTAssertEqual(store.pendingDeletes(), NotificationPendingDeletes())
    }

    func testKeepsPendingDeletesInOneFileThatGoesWithTheLastOfThem() throws {
        let file = tempDir.appendingPathComponent("pending-interaction-deletes.json")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))

        store.recordPendingGroupDelete("tag-1")
        store.recordPendingInteractionDelete("interaction-1")

        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: file))
        let stored = try XCTUnwrap(json as? [String: [String]])
        XCTAssertEqual(stored, ["groupIdentifiers": ["tag-1"], "interactionIdentifiers": ["interaction-1"]])

        store.removePendingGroupDelete("tag-1")
        store.removePendingInteractionDelete("interaction-1")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testTheAppReadsWhatTheExtensionNotedDownAndTheAccountsStayApartFromIt() {
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))
        // The extension has a store of its own on the same directory.
        NotificationAccountStore(baseDirectory: tempDir).recordPendingInteractionDelete("interaction-1")

        XCTAssertEqual(store.pendingDeletes().interactionIdentifiers, ["interaction-1"])

        store.removeAllAccounts()
        XCTAssertEqual(store.pendingDeletes().interactionIdentifiers, ["interaction-1"])
        store.recordPendingGroupDelete("tag-1")
        store.clearAllPendingDeletes()
        XCTAssertTrue(store.saveAccount(accountTag: "tag-1", userId: "@bas:mindroom.chat"))
        XCTAssertEqual(store.allAccountTags(), ["tag-1"])
    }

    func testLosesNoPendingDeleteNotedDownFromManyThreadsAtOnce() {
        let store = self.store!
        DispatchQueue.concurrentPerform(iterations: 64) { index in
            if index.isMultiple(of: 2) {
                store.recordPendingInteractionDelete("interaction-\(index)")
            } else {
                store.recordPendingGroupDelete("tag-\(index)")
            }
        }

        let pending = store.pendingDeletes()
        XCTAssertEqual(
            Set(pending.interactionIdentifiers),
            Set(stride(from: 0, to: 64, by: 2).map { "interaction-\($0)" })
        )
        XCTAssertEqual(Set(pending.groupIdentifiers), Set(stride(from: 1, to: 64, by: 2).map { "tag-\($0)" }))
        XCTAssertEqual(pending.interactionIdentifiers.count, 32)
        XCTAssertEqual(pending.groupIdentifiers.count, 32)
    }
}
