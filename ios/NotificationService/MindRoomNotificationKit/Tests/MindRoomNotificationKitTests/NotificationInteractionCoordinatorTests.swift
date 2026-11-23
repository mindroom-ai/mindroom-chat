import MindRoomNotificationKit
import XCTest

/// The account as the app shares it, and what the helper was asked to do.
private final class DonationLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storedSyncId: String?
    private var donatedIds: [String] = []
    private var deletedIds: [String] = []
    private var pendingIds: [String] = []

    init(syncId: String?) {
        storedSyncId = syncId
    }

    var syncId: String? {
        get { lock.lock(); defer { lock.unlock() }; return storedSyncId }
        set { lock.lock(); storedSyncId = newValue; lock.unlock() }
    }

    var donated: [String] { lock.lock(); defer { lock.unlock() }; return donatedIds }
    var deleted: [String] { lock.lock(); defer { lock.unlock() }; return deletedIds }
    /// The deletes that the system refused, noted down for the app.
    var pending: [String] { lock.lock(); defer { lock.unlock() }; return pendingIds }

    func donate(_ interactionId: String) { lock.lock(); donatedIds.append(interactionId); lock.unlock() }
    func delete(_ interactionId: String) { lock.lock(); deletedIds.append(interactionId); lock.unlock() }
    func notePending(_ interactionId: String) { lock.lock(); pendingIds.append(interactionId); lock.unlock() }
}

private struct DonationFailed: Error {}
private struct DeleteRefused: Error {}

/// Runs the helper for a notification that started with sync "sync-1", holding `donate` at the
/// gate when there is one.
private func runDonation(
    log: DonationLog,
    gate: TestGate? = nil,
    failing: Bool = false,
    deleteRefused: Bool = false
) async -> Bool {
    await NotificationInteractionCoordinator.donateIfValid(
        isAccountStillValid: { log.syncId == "sync-1" },
        donate: { interactionId in
            log.donate(interactionId)
            await gate?.hold()
            if failing { throw DonationFailed() }
        },
        deleteInteraction: { interactionId in
            log.delete(interactionId)
            if deleteRefused { throw DeleteRefused() }
        },
        recordPendingDelete: { interactionId in log.notePending(interactionId) }
    )
}

final class NotificationInteractionCoordinatorTests: XCTestCase {

    func testKeepsTheDonationOfAnAccountThatIsStillShared() async {
        let log = DonationLog(syncId: "sync-1")

        let donated = await runDonation(log: log)

        XCTAssertTrue(donated)
        XCTAssertEqual(log.donated.count, 1)
        XCTAssertNotNil(UUID(uuidString: log.donated.first ?? ""))
        XCTAssertTrue(log.deleted.isEmpty)
        XCTAssertTrue(log.pending.isEmpty)
    }

    func testDonatesNothingForAnAccountThatIsAlreadyGone() async {
        let log = DonationLog(syncId: nil)

        let donated = await runDonation(log: log)

        XCTAssertFalse(donated)
        XCTAssertTrue(log.donated.isEmpty)
        XCTAssertTrue(log.deleted.isEmpty)
        XCTAssertTrue(log.pending.isEmpty)
    }

    func testDeletesTheDonationOfAnAccountRemovedWhileItWasDonated() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = TestGate()

        let running = Task { await runDonation(log: log, gate: gate) }
        await gate.waitUntilHeld()
        // The app signs the account out: its record and its interactions go, and this one lands after.
        log.syncId = nil
        XCTAssertTrue(log.deleted.isEmpty)
        gate.release()
        let donated = await running.value

        XCTAssertFalse(donated)
        XCTAssertEqual(log.donated.count, 1)
        XCTAssertEqual(log.deleted, log.donated)
        // Deleted here, so there is nothing left for the app to do.
        XCTAssertTrue(log.pending.isEmpty)
    }

    func testDeletesTheDonationOfAnAccountRemovedAndSharedAgainWhileItWasDonated() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = TestGate()

        let running = Task { await runDonation(log: log, gate: gate) }
        await gate.waitUntilHeld()
        // Removed and synced again: a record is there, but of a sync that began after the delete.
        log.syncId = "sync-2"
        gate.release()
        let donated = await running.value

        XCTAssertFalse(donated)
        XCTAssertEqual(log.donated.count, 1)
        XCTAssertEqual(log.deleted, log.donated)
        XCTAssertTrue(log.pending.isEmpty)
    }

    func testDeletesWhatADonationThatFailedMayHaveLeft() async {
        let log = DonationLog(syncId: "sync-1")

        let donated = await runDonation(log: log, failing: true)

        XCTAssertFalse(donated)
        XCTAssertEqual(log.donated.count, 1)
        XCTAssertEqual(log.deleted, log.donated)
        XCTAssertTrue(log.pending.isEmpty)
    }

    func testNotesDownTheDonationThatItCouldNotDeleteForTheAppToDelete() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = TestGate()

        let running = Task { await runDonation(log: log, gate: gate, deleteRefused: true) }
        await gate.waitUntilHeld()
        log.syncId = nil
        gate.release()
        let donated = await running.value

        XCTAssertFalse(donated)
        XCTAssertEqual(log.donated.count, 1)
        // The delete was tried once, and the very interaction it was for is noted down.
        XCTAssertEqual(log.deleted, log.donated)
        XCTAssertEqual(log.pending, log.donated)
    }

    func testNotesDownWhatAFailedDonationLeftWhenTheDeleteIsRefusedToo() async {
        let log = DonationLog(syncId: "sync-1")

        let donated = await runDonation(log: log, failing: true, deleteRefused: true)

        XCTAssertFalse(donated)
        XCTAssertEqual(log.deleted, log.donated)
        XCTAssertEqual(log.pending, log.donated)
    }

    func testCleansUpForATaskThatWasCancelledMeanwhile() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = TestGate()

        let running = Task { await runDonation(log: log, gate: gate) }
        await gate.waitUntilHeld()
        // The notification's time ran out while the account was removed.
        running.cancel()
        log.syncId = nil
        gate.release()
        let donated = await running.value

        XCTAssertFalse(donated)
        XCTAssertEqual(log.deleted, log.donated)
        XCTAssertTrue(log.pending.isEmpty)
    }
}
