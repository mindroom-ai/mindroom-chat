import MindRoomNotificationKit
import XCTest

/// Holds `donate` where it is until the test lets it go on.
private final class DonationGate: @unchecked Sendable {
    private let lock = NSLock()
    private var held: CheckedContinuation<Void, Never>?
    private var waiting: CheckedContinuation<Void, Never>?

    /// Called by `donate`: says that the donation is under way and waits to be let through.
    func hold() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.lock.lock()
            self.held = continuation
            let waiting = self.waiting
            self.waiting = nil
            self.lock.unlock()
            waiting?.resume()
        }
    }

    /// Returns once `donate` is held.
    func waitUntilHeld() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.lock.lock()
            if self.held != nil {
                self.lock.unlock()
                continuation.resume()
                return
            }
            self.waiting = continuation
            self.lock.unlock()
        }
    }

    func release() {
        lock.lock()
        let held = self.held
        self.held = nil
        lock.unlock()
        held?.resume()
    }
}

/// The account as the Keychain has it, and what the helper was asked to do.
private final class DonationLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storedSyncId: String?
    private var donatedIds: [String] = []
    private var deletedIds: [String] = []

    init(syncId: String?) {
        storedSyncId = syncId
    }

    var syncId: String? {
        get { lock.lock(); defer { lock.unlock() }; return storedSyncId }
        set { lock.lock(); storedSyncId = newValue; lock.unlock() }
    }

    var donated: [String] { lock.lock(); defer { lock.unlock() }; return donatedIds }
    var deleted: [String] { lock.lock(); defer { lock.unlock() }; return deletedIds }

    func donate(_ interactionId: String) { lock.lock(); donatedIds.append(interactionId); lock.unlock() }
    func delete(_ interactionId: String) { lock.lock(); deletedIds.append(interactionId); lock.unlock() }
}

private struct DonationFailed: Error {}

/// Runs the helper for a notification that started with sync "sync-1", holding `donate` at the
/// gate when there is one.
private func runDonation(log: DonationLog, gate: DonationGate? = nil, failing: Bool = false) async -> Bool {
    await NotificationInteractionCoordinator.donateIfValid(
        isAccountStillValid: { log.syncId == "sync-1" },
        donate: { interactionId in
            log.donate(interactionId)
            await gate?.hold()
            if failing { throw DonationFailed() }
        },
        deleteInteraction: { interactionId in log.delete(interactionId) }
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
    }

    func testDonatesNothingForAnAccountThatIsAlreadyGone() async {
        let log = DonationLog(syncId: nil)

        let donated = await runDonation(log: log)

        XCTAssertFalse(donated)
        XCTAssertTrue(log.donated.isEmpty)
        XCTAssertTrue(log.deleted.isEmpty)
    }

    func testDeletesTheDonationOfAnAccountClearedWhileItWasDonated() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = DonationGate()

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
    }

    func testDeletesTheDonationOfAnAccountClearedAndSharedAgainWhileItWasDonated() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = DonationGate()

        let running = Task { await runDonation(log: log, gate: gate) }
        await gate.waitUntilHeld()
        // Cleared and synced again: a record is there, but of a sync that began after the delete.
        log.syncId = "sync-2"
        gate.release()
        let donated = await running.value

        XCTAssertFalse(donated)
        XCTAssertEqual(log.donated.count, 1)
        XCTAssertEqual(log.deleted, log.donated)
    }

    func testDeletesWhatADonationThatFailedMayHaveLeft() async {
        let log = DonationLog(syncId: "sync-1")

        let donated = await runDonation(log: log, failing: true)

        XCTAssertFalse(donated)
        XCTAssertEqual(log.donated.count, 1)
        XCTAssertEqual(log.deleted, log.donated)
    }

    func testCleansUpForATaskThatWasCancelledMeanwhile() async {
        let log = DonationLog(syncId: "sync-1")
        let gate = DonationGate()

        let running = Task { await runDonation(log: log, gate: gate) }
        await gate.waitUntilHeld()
        // The notification's time ran out while the account was cleared.
        running.cancel()
        log.syncId = nil
        gate.release()
        let donated = await running.value

        XCTAssertFalse(donated)
        XCTAssertEqual(log.deleted, log.donated)
    }
}
