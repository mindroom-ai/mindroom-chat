import MindRoomNotificationKit
import Security
import XCTest

private struct InteractionsNotDeleted: Error {}

/// What ran, in the order it ran.
private final class OrderLog: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var entries: [String] { lock.lock(); defer { lock.unlock() }; return recorded }

    func add(_ entry: String) { lock.lock(); recorded.append(entry); lock.unlock() }
}

final class NotificationAccountMutationQueueTests: XCTestCase {
    private let accountTag = "acct-1"

    private func makeStore(_ keychain: FakeKeychain) -> KeychainNotificationCredentialStore {
        KeychainNotificationCredentialStore(service: "test", keychain: keychain.operations)
    }

    private func record(syncId: String) -> NotificationAccountRecord {
        NotificationAccountRecord(
            homeserverUrl: "https://matrix.mindroom.chat",
            userId: "@bas:mindroom.chat",
            accessToken: "tok",
            installId: "install-1",
            syncId: syncId
        )
    }

    // MARK: - A removal is done only when the Keychain and Siri both did it

    func testARemovalIsDoneWhenTheRecordAndTheInteractionsAreGone() async {
        let accountTag = self.accountTag
        let store = makeStore(FakeKeychain())
        XCTAssertTrue(store.save(accountTag: accountTag, record: record(syncId: "sync-1")))
        var interactionsDeleted = 0

        let outcome = await NotificationAccountCleanup.run(
            removeSharedState: { store.remove(accountTag: accountTag) },
            deleteInteractions: { interactionsDeleted += 1 }
        )

        XCTAssertEqual(outcome, .removed)
        XCTAssertEqual(interactionsDeleted, 1)
        XCTAssertNil(store.load(accountTag: accountTag))
    }

    func testARemovalWhoseInteractionsSiriKeptIsNotDone() async {
        let accountTag = self.accountTag
        let store = makeStore(FakeKeychain())
        XCTAssertTrue(store.save(accountTag: accountTag, record: record(syncId: "sync-1")))

        let outcome = await NotificationAccountCleanup.run(
            removeSharedState: { store.remove(accountTag: accountTag) },
            deleteInteractions: { throw InteractionsNotDeleted() }
        )

        // The Keychain did its part, which alone is not the removal.
        XCTAssertNil(store.load(accountTag: accountTag))
        XCTAssertNotEqual(outcome, .removed)
        XCTAssertEqual(outcome, .interactionsNotDeleted)
    }

    func testARemovalThatTheKeychainRefusedStillDeletesTheInteractions() async {
        let accountTag = self.accountTag
        let keychain = FakeKeychain()
        let store = makeStore(keychain)
        XCTAssertTrue(store.save(accountTag: accountTag, record: record(syncId: "sync-1")))
        keychain.deleteStatus = errSecInteractionNotAllowed
        var interactionsDeleted = 0

        let outcome = await NotificationAccountCleanup.run(
            removeSharedState: { store.remove(accountTag: accountTag) },
            deleteInteractions: { interactionsDeleted += 1 }
        )

        XCTAssertEqual(outcome, .keychainKeptRecord)
        XCTAssertEqual(interactionsDeleted, 1)

        // Refused by both: the record that stayed is what the caller hears of.
        let refusedByBoth = await NotificationAccountCleanup.run(
            removeSharedState: { store.remove(accountTag: accountTag) },
            deleteInteractions: { throw InteractionsNotDeleted() }
        )
        XCTAssertEqual(refusedByBoth, .keychainKeptRecord)
    }

    // MARK: - Mutations run in the order they were handed in

    func testAnAccountStoredRightAfterItsDelayedRemovalIsKept() async {
        let accountTag = self.accountTag
        let store = makeStore(FakeKeychain())
        XCTAssertTrue(store.save(accountTag: accountTag, record: record(syncId: "sync-1")))
        let sharedAgain = record(syncId: "sync-2")
        let queue = NotificationAccountMutationQueue()
        let gate = TestGate()
        let order = OrderLog()

        // clearAccount, which has not got to the Keychain yet.
        queue.enqueue {
            await gate.hold()
            let outcome = await NotificationAccountCleanup.run(
                removeSharedState: { store.remove(accountTag: accountTag) },
                deleteInteractions: {}
            )
            order.add("cleared: \(outcome)")
        }
        // syncAccount of the same account, asked for right after.
        let stored = queue.enqueue {
            let saved = store.save(accountTag: accountTag, record: sharedAgain)
            order.add("stored: \(saved)")
        }

        await gate.waitUntilHeld()
        // The removal is still to come, and the account waits for it.
        XCTAssertEqual(order.entries, [])
        XCTAssertEqual(store.load(accountTag: accountTag)?.syncId, "sync-1")

        gate.release()
        await stored.value

        XCTAssertEqual(order.entries, ["cleared: removed", "stored: true"])
        // The removal took the old record, not the one stored after it.
        XCTAssertEqual(store.load(accountTag: accountTag), sharedAgain)
    }

    func testARemovalThatWaitsForSiriHoldsBackTheAccountStoredAfterIt() async {
        let accountTag = self.accountTag
        let store = makeStore(FakeKeychain())
        XCTAssertTrue(store.save(accountTag: accountTag, record: record(syncId: "sync-1")))
        let sharedAgain = record(syncId: "sync-2")
        let queue = NotificationAccountMutationQueue()
        let gate = TestGate()

        queue.enqueue {
            _ = await NotificationAccountCleanup.run(
                removeSharedState: { store.remove(accountTag: accountTag) },
                // Siri takes its time.
                deleteInteractions: { await gate.hold() }
            )
        }
        let stored = queue.enqueue {
            store.save(accountTag: accountTag, record: sharedAgain)
        }

        await gate.waitUntilHeld()
        // Not stored while the interactions of the old account are still being deleted.
        XCTAssertNil(store.load(accountTag: accountTag))

        gate.release()
        await stored.value
        XCTAssertEqual(store.load(accountTag: accountTag), sharedAgain)
    }

    func testManyMutationsRunOneAtATimeInTheOrderHandedIn() async {
        let queue = NotificationAccountMutationQueue()
        let gate = TestGate()
        let order = OrderLog()

        var last = queue.enqueue {
            await gate.hold()
            order.add("0")
        }
        for index in 1...20 {
            last = queue.enqueue {
                order.add("\(index)")
                // Gives a later mutation every chance to overtake.
                await Task.yield()
                order.add("\(index) done")
            }
        }

        await gate.waitUntilHeld()
        XCTAssertEqual(order.entries, [])
        gate.release()
        await last.value

        XCTAssertEqual(order.entries, ["0"] + (1...20).flatMap { ["\($0)", "\($0) done"] })
    }
}
