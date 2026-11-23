import MindRoomNotificationKit
import XCTest

private struct DeleteRefused: Error {}

/// What ran, in the order it ran.
private final class OrderLog: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var entries: [String] { lock.lock(); defer { lock.unlock() }; return recorded }

    func add(_ entry: String) { lock.lock(); recorded.append(entry); lock.unlock() }
}

/// Stands in for Siri: notes the deletes it is asked for (`all`, `group:<tag>`,
/// `interaction:<id>`), refuses the ones a test names, and holds each at the gate when there is one.
private final class FakeInteractions: @unchecked Sendable {
    private let lock = NSLock()
    private var asked: [String] = []
    private var refusedDeletes: Set<String> = []
    private var heldAt: TestGate?

    var deletes: [String] { lock.lock(); defer { lock.unlock() }; return asked }

    var refused: Set<String> {
        get { lock.lock(); defer { lock.unlock() }; return refusedDeletes }
        set { lock.lock(); refusedDeletes = newValue; lock.unlock() }
    }

    var gate: TestGate? {
        get { lock.lock(); defer { lock.unlock() }; return heldAt }
        set { lock.lock(); heldAt = newValue; lock.unlock() }
    }

    var deleter: NotificationInteractionDeleter {
        NotificationInteractionDeleter(
            deleteAll: { try await self.delete("all") },
            deleteGroup: { groupIdentifier in try await self.delete("group:\(groupIdentifier)") },
            deleteInteraction: { interactionIdentifier in
                try await self.delete("interaction:\(interactionIdentifier)")
            }
        )
    }

    private func note(_ name: String) { lock.lock(); asked.append(name); lock.unlock() }

    private func delete(_ name: String) async throws {
        note(name)
        await gate?.hold()
        if refused.contains(name) {
            throw DeleteRefused()
        }
    }
}

final class NotificationAccountMutationQueueTests: XCTestCase {
    private var tempDir: URL!
    private var accounts: NotificationAccountStore!
    private var avatars: NotificationAvatarStore!
    private var interactions: FakeInteractions!
    private var mutations: NotificationAccountMutations!

    private let png = TestImageFixtures.samplePNG

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("MindRoomNotificationAccountMutationTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        accounts = NotificationAccountStore(baseDirectory: tempDir.appendingPathComponent("accounts"))
        avatars = NotificationAvatarStore(baseDirectory: tempDir.appendingPathComponent("avatars"))
        interactions = FakeInteractions()
        mutations = NotificationAccountMutations(
            accounts: accounts,
            avatars: avatars,
            interactions: interactions.deleter
        )
    }

    override func tearDownWithError() throws {
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
    }

    /// Shares the account and caches one avatar for it.
    private func share(_ accountTag: String) {
        XCTAssertTrue(mutations.syncAccount(accountTag: accountTag, userId: "@\(accountTag):mindroom.chat"))
        XCTAssertTrue(avatars.storeAvatar(accountTag: accountTag, roomId: "!a:x", sender: "@u:x", mxcUrl: "mxc://x/u", data: png))
    }

    private func cachedAvatar(_ accountTag: String, sender: String = "@u:x") -> Data? {
        avatars.cachedAvatar(accountTag: accountTag, roomId: "!a:x", sender: sender)
    }

    // MARK: - syncAccount

    func testStoresAnAccountAndSaysWhenItCouldNot() throws {
        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
        XCTAssertEqual(accounts.loadAccount(accountTag: "a")?.userId, "@a:mindroom.chat")

        // A file where the store's directory would be.
        let blocker = tempDir.appendingPathComponent("blocker")
        try Data("x".utf8).write(to: blocker)
        let unwritable = NotificationAccountMutations(
            accounts: NotificationAccountStore(baseDirectory: blocker.appendingPathComponent("store")),
            avatars: avatars,
            interactions: interactions.deleter
        )
        XCTAssertFalse(unwritable.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
    }

    func testAnAccountThatSharesAgainNoLongerOwesTheDeleteOfItsGroupButStillTheOnesOfSingleInteractions() {
        accounts.recordPendingGroupDelete("a")
        accounts.recordPendingGroupDelete("b")
        accounts.recordPendingInteractionDelete("interaction-of-a")

        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))

        // Deleted now, the group would take with it what is donated from here on.
        XCTAssertEqual(
            accounts.pendingDeletes(),
            NotificationPendingDeletes(groupIdentifiers: ["b"], interactionIdentifiers: ["interaction-of-a"])
        )
    }

    // MARK: - reconcileAccounts

    func testReconcileRemovesEveryAccountThatIsNotAllowedWithItsAvatarsAndItsInteractions() async {
        share("a")
        share("b")
        share("c")
        // Avatars of an account that is not shared, as a removal that was cut off leaves them.
        XCTAssertTrue(avatars.storeAvatar(accountTag: "stray", roomId: "!a:x", sender: "@u:x", mxcUrl: "mxc://x/u", data: png))

        let reconciled = await mutations.reconcileAccounts(allowedAccountTags: ["a", "not-shared-yet"])

        XCTAssertTrue(reconciled)
        XCTAssertEqual(accounts.allAccountTags(), ["a"])
        XCTAssertNotNil(cachedAvatar("a"))
        XCTAssertNil(cachedAvatar("b"))
        XCTAssertNil(cachedAvatar("c"))
        XCTAssertNil(cachedAvatar("stray"))
        // Each removed account's interactions, and no others.
        XCTAssertEqual(Set(interactions.deletes), ["group:b", "group:c"])
        XCTAssertEqual(accounts.pendingDeletes(), NotificationPendingDeletes())

        // Nothing is left to do the next time.
        let again = await mutations.reconcileAccounts(allowedAccountTags: ["a"])
        XCTAssertTrue(again)
        XCTAssertEqual(interactions.deletes.count, 2)
    }

    func testReconcileWithoutAnAllowedAccountRemovesEverything() async {
        share("a")
        share("b")
        accounts.recordPendingInteractionDelete("interaction-1")
        accounts.recordPendingGroupDelete("gone-earlier")

        let reconciled = await mutations.reconcileAccounts(allowedAccountTags: [])

        XCTAssertTrue(reconciled)
        XCTAssertEqual(accounts.allAccountTags(), [])
        XCTAssertNil(cachedAvatar("a"))
        XCTAssertNil(cachedAvatar("b"))
        // One delete of everything covers every delete that was owed.
        XCTAssertEqual(interactions.deletes, ["all"])
        XCTAssertEqual(accounts.pendingDeletes(), NotificationPendingDeletes())

        // Asked again, as on every start while signed out, it deletes everything again.
        let again = await mutations.reconcileAccounts(allowedAccountTags: [])
        XCTAssertTrue(again)
        XCTAssertEqual(interactions.deletes, ["all", "all"])
    }

    func testReconcileKeepsOnlyTheDeletesSiriRefusedAndTriesThemAgain() async {
        share("a")
        share("b")
        share("c")
        accounts.recordPendingInteractionDelete("interaction-1")
        accounts.recordPendingInteractionDelete("interaction-2")
        interactions.refused = ["group:b", "interaction:interaction-2"]

        let refused = await mutations.reconcileAccounts(allowedAccountTags: ["a"])

        // The accounts and their avatars are gone all the same; only the refused deletes are owed.
        XCTAssertFalse(refused)
        XCTAssertEqual(accounts.allAccountTags(), ["a"])
        XCTAssertNil(cachedAvatar("b"))
        XCTAssertNil(cachedAvatar("c"))
        XCTAssertEqual(
            Set(interactions.deletes),
            ["interaction:interaction-1", "interaction:interaction-2", "group:b", "group:c"]
        )
        XCTAssertEqual(
            accounts.pendingDeletes(),
            NotificationPendingDeletes(groupIdentifiers: ["b"], interactionIdentifiers: ["interaction-2"])
        )

        // Still refused: nothing is lost, and nothing that was deleted is deleted again.
        let refusedAgain = await mutations.reconcileAccounts(allowedAccountTags: ["a"])
        XCTAssertFalse(refusedAgain)
        XCTAssertEqual(
            Array(interactions.deletes.dropFirst(4)),
            ["interaction:interaction-2", "group:b"]
        )
        XCTAssertEqual(
            accounts.pendingDeletes(),
            NotificationPendingDeletes(groupIdentifiers: ["b"], interactionIdentifiers: ["interaction-2"])
        )

        interactions.refused = []
        let deleted = await mutations.reconcileAccounts(allowedAccountTags: ["a"])
        XCTAssertTrue(deleted)
        XCTAssertEqual(accounts.pendingDeletes(), NotificationPendingDeletes())
        XCTAssertEqual(interactions.deletes.count, 8)
    }

    func testReconcileDoesNotDeleteTheOwedGroupOfAnAccountThatIsAllowedAgain() async {
        share("a")
        share("b")
        interactions.refused = ["all"]

        // iOS denies notifications, and Siri refuses the delete of everything.
        let refused = await mutations.reconcileAccounts(allowedAccountTags: [])
        XCTAssertFalse(refused)
        XCTAssertEqual(accounts.allAccountTags(), [])
        XCTAssertNil(cachedAvatar("a"))
        XCTAssertEqual(Set(accounts.pendingDeletes().groupIdentifiers), ["a", "b"])

        // Allowed again, and account a shares again; b is signed out meanwhile.
        interactions.refused = []
        let allowed = await mutations.reconcileAccounts(allowedAccountTags: ["a"])
        XCTAssertTrue(allowed)
        XCTAssertEqual(interactions.deletes, ["all", "group:b"])
        XCTAssertEqual(accounts.pendingDeletes().groupIdentifiers, ["a"])

        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
        XCTAssertEqual(accounts.pendingDeletes(), NotificationPendingDeletes())
        let again = await mutations.reconcileAccounts(allowedAccountTags: ["a"])
        XCTAssertTrue(again)
        XCTAssertEqual(interactions.deletes, ["all", "group:b"])
        XCTAssertNotNil(accounts.loadAccount(accountTag: "a"))
    }

    // MARK: - Avatars

    func testSyncAvatarsNamesTheMissingOnesAndStoreAvatarFillsThemForEveryRoom() {
        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
        let entries = [
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
            NotificationAccountMutations.AvatarEntry(roomId: "!b:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@zoe:x", mxcUrl: "mxc://x/zoe"),
        ]

        let first = mutations.syncAvatars(accountTag: "a", entries: entries)
        XCTAssertEqual(first.missingMxcUrls, ["mxc://x/agent", "mxc://x/zoe"])
        XCTAssertGreaterThan(first.syncGeneration, 0)

        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: first.syncGeneration,
            mxcUrl: "mxc://x/agent",
            entries: [(roomId: "!a:x", sender: "@agent:x"), (roomId: "!b:x", sender: "@agent:x")],
            data: png
        )
        XCTAssertEqual(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"), png)
        XCTAssertEqual(avatars.cachedAvatar(accountTag: "a", roomId: "!b:x", sender: "@agent:x"), png)
        XCTAssertNil(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@zoe:x"))

        // The next sync asks only for what is still missing, and drops what left the list.
        let second = mutations.syncAvatars(accountTag: "a", entries: Array(entries.dropFirst()))
        XCTAssertEqual(second.missingMxcUrls, ["mxc://x/zoe"])
        XCTAssertGreaterThan(second.syncGeneration, first.syncGeneration)
        XCTAssertNil(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"))
        XCTAssertEqual(avatars.cachedAvatar(accountTag: "a", roomId: "!b:x", sender: "@agent:x"), png)
    }

    func testKeepsNoAvatarsForAnAccountThatIsNotShared() {
        let entries = [
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
        ]

        let sync = mutations.syncAvatars(accountTag: "a", entries: entries)

        XCTAssertEqual(sync.missingMxcUrls, [])
        XCTAssertEqual(sync.syncGeneration, 0)
        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: sync.syncGeneration,
            mxcUrl: "mxc://x/agent",
            entries: [(roomId: "!a:x", sender: "@agent:x")],
            data: png
        )
        XCTAssertNil(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"))
    }

    func testStoresNoAvatarOfAnEarlierSync() {
        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
        let withOld = [
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/old"),
        ]
        let withNew = [
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/new"),
        ]
        let earlier = mutations.syncAvatars(accountTag: "a", entries: withOld)
        let later = mutations.syncAvatars(accountTag: "a", entries: withNew)

        // The download of the earlier sync ends after the agent changed its avatar.
        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: earlier.syncGeneration,
            mxcUrl: "mxc://x/old",
            entries: [(roomId: "!a:x", sender: "@agent:x")],
            data: png
        )
        XCTAssertNil(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"))

        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: later.syncGeneration,
            mxcUrl: "mxc://x/new",
            entries: [(roomId: "!a:x", sender: "@agent:x")],
            data: png
        )
        XCTAssertEqual(avatars.cachedMxcUrl(accountTag: "a", roomId: "!a:x", sender: "@agent:x"), "mxc://x/new")
    }

    func testStoresNoAvatarForAnAccountThatWasRemovedAndSharedAgainMeanwhile() async {
        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
        let entries = [
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
        ]
        let sync = mutations.syncAvatars(accountTag: "a", entries: entries)

        _ = await mutations.reconcileAccounts(allowedAccountTags: ["other"])
        XCTAssertTrue(mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat"))
        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: sync.syncGeneration,
            mxcUrl: "mxc://x/agent",
            entries: [(roomId: "!a:x", sender: "@agent:x")],
            data: png
        )

        XCTAssertNil(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"))
    }

    func testClearingTheAvatarCacheKeepsTheAccountsAndStopsTheStoresUnderWay() {
        share("a")
        share("b")
        accounts.recordPendingGroupDelete("gone-earlier")
        let entries = [
            NotificationAccountMutations.AvatarEntry(roomId: "!a:x", sender: "@agent:x", mxcUrl: "mxc://x/agent"),
        ]
        let sync = mutations.syncAvatars(accountTag: "a", entries: entries)

        mutations.clearAvatarCache()

        XCTAssertNil(cachedAvatar("a"))
        XCTAssertNil(cachedAvatar("b"))
        // Neither the accounts nor what Siri keeps of them is touched.
        XCTAssertEqual(accounts.allAccountTags(), ["a", "b"])
        XCTAssertEqual(accounts.pendingDeletes().groupIdentifiers, ["gone-earlier"])
        XCTAssertEqual(interactions.deletes, [])

        // A download that began before the cache was cleared does not bring it back.
        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: sync.syncGeneration,
            mxcUrl: "mxc://x/agent",
            entries: [(roomId: "!a:x", sender: "@agent:x")],
            data: png
        )
        XCTAssertNil(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"))

        // The next sync fills it again.
        let next = mutations.syncAvatars(accountTag: "a", entries: entries)
        XCTAssertEqual(next.missingMxcUrls, ["mxc://x/agent"])
        mutations.storeAvatar(
            accountTag: "a",
            syncGeneration: next.syncGeneration,
            mxcUrl: "mxc://x/agent",
            entries: [(roomId: "!a:x", sender: "@agent:x")],
            data: png
        )
        XCTAssertEqual(avatars.cachedAvatar(accountTag: "a", roomId: "!a:x", sender: "@agent:x"), png)
    }

    // MARK: - Mutations run in the order they were handed in

    func testAnAccountStoredRightAfterAReconcileThatWaitsForSiriIsKept() async {
        share("a")
        let mutations = self.mutations!
        let queue = NotificationAccountMutationQueue()
        let gate = TestGate()
        let order = OrderLog()
        interactions.gate = gate

        // The account is signed out: nothing is allowed, and Siri takes its time.
        queue.enqueue {
            let reconciled = await mutations.reconcileAccounts(allowedAccountTags: [])
            order.add("reconciled: \(reconciled)")
        }
        // Signed in again right after, the account is shared.
        let stored = queue.enqueue {
            let synced = mutations.syncAccount(accountTag: "a", userId: "@a:mindroom.chat")
            order.add("stored: \(synced)")
        }

        await gate.waitUntilHeld()
        // Not stored while the interactions of the old sharing are still being deleted.
        XCTAssertEqual(order.entries, [])
        XCTAssertNil(accounts.loadAccount(accountTag: "a"))

        interactions.gate = nil
        gate.release()
        await stored.value

        XCTAssertEqual(order.entries, ["reconciled: true", "stored: true"])
        // The reconcile took the old account, not the one stored after it.
        XCTAssertNotNil(accounts.loadAccount(accountTag: "a"))
        XCTAssertEqual(accounts.pendingDeletes(), NotificationPendingDeletes())
    }

    func testADeleteThatIsTriedAgainHoldsBackTheMutationsAfterIt() async {
        share("a")
        accounts.recordPendingInteractionDelete("interaction-1")
        let mutations = self.mutations!
        let queue = NotificationAccountMutationQueue()
        let gate = TestGate()
        let order = OrderLog()
        interactions.gate = gate

        queue.enqueue {
            let reconciled = await mutations.reconcileAccounts(allowedAccountTags: ["a"])
            order.add("reconciled: \(reconciled)")
        }
        let cleared = queue.enqueue {
            mutations.clearAvatarCache()
            order.add("cleared")
        }

        await gate.waitUntilHeld()
        XCTAssertEqual(interactions.deletes, ["interaction:interaction-1"])
        XCTAssertEqual(order.entries, [])
        XCTAssertNotNil(cachedAvatar("a"))

        interactions.gate = nil
        gate.release()
        await cleared.value

        XCTAssertEqual(order.entries, ["reconciled: true", "cleared"])
        XCTAssertEqual(accounts.pendingDeletes(), NotificationPendingDeletes())
        XCTAssertNil(cachedAvatar("a"))
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
