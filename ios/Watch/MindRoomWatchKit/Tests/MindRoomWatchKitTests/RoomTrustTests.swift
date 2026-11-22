import Combine
import XCTest
@testable import MindRoomWatchKit

@MainActor
final class RoomTrustTests: XCTestCase {
    private let router = "@mindroom_router:x"
    private let helper = "@mindroom_helper:x"
    private let start = Date(timeIntervalSince1970: 1_000)
    private var finishRead: CheckedContinuation<Void, Never>?

    /// A room's state with `router` bound and these accounts, joined, on its roster.
    private func state(roster: [String] = []) -> [JSON] {
        [
            ["type": "m.room.power_levels", "state_key": "", "sender": "@creator:x", "content": ["users": [router: 50] as JSON] as JSON],
            ["type": "io.mindroom.router", "state_key": "", "sender": router, "content": ["user_id": router] as JSON],
            ["type": "io.mindroom.accounts", "state_key": router, "sender": router, "content": ["accounts": roster] as JSON],
        ] + roster.map { ["type": "m.room.member", "state_key": $0, "sender": $0, "content": ["membership": "join"] as JSON] }
    }

    private func resolvedTag(_ rootId: String) -> JSON {
        ["type": ThreadTags.eventType, "state_key": ThreadTags.resolvedStateKey(root: rootId), "sender": "@bas:x",
         "content": ThreadTags.resolvedContent(userId: "@bas:x", at: start)]
    }

    /// A read that is due whenever it is asked for.
    private func read(_ trust: RoomTrust, _ state: [JSON]?) async {
        trust.expire()
        await trust.refresh { state }
    }

    /// A read that waits for `finishRead`, under way when this returns.
    private func suspendedRead(_ trust: RoomTrust, _ state: [JSON]?) async -> Task<Void, Never> {
        let underWay = expectation(description: "a read is under way")
        let task = Task {
            await trust.refresh {
                await withCheckedContinuation { self.finishRead = $0; underWay.fulfill() }
                return state
            }
        }
        await fulfillment(of: [underWay], timeout: 5)
        return task
    }

    func testTrustIsEmptyUntilAReadSucceeds() async {
        let trust = RoomTrust(resolved: ["$cached"])
        XCTAssertEqual(trust.accounts, [])
        await read(trust, nil)
        XCTAssertEqual(trust.accounts, [])
        XCTAssertEqual(trust.resolved.roots, ["$cached"])
        await read(trust, state(roster: [helper]))
        XCTAssertEqual(trust.accounts, [router, helper])
        XCTAssertEqual(trust.resolved.roots, [])
    }

    func testAFailedReadKeepsTheLastGoodTrustAndResolvedThreads() async {
        let trust = RoomTrust()
        await read(trust, state(roster: [helper]) + [resolvedTag("$done")])
        var changes = 0
        let subscription = trust.changed.sink { changes += 1 }
        defer { subscription.cancel() }
        await read(trust, nil)
        XCTAssertEqual(trust.accounts, [router, helper])
        XCTAssertEqual(trust.resolved.roots, ["$done"])
        XCTAssertEqual(changes, 0)
    }

    func testAThreadResolvedHereIsNotReopenedByAReadThatBeganBefore() async {
        let trust = RoomTrust()
        // An open thread, or a notification, reads the room's state...
        let older = await suspendedRead(trust, state())
        // ...the person marks a thread done, which the server takes...
        trust.resolve("$done")
        // ...and the answer from before the tag comes in.
        finishRead?.resume()
        await older.value
        XCTAssertEqual(trust.resolved.roots, ["$done"])
        // A read that begins after says what the room says: a thread opened again elsewhere is open here.
        await trust.refresh { self.state() }
        XCTAssertEqual(trust.resolved.roots, [])
    }

    func testThereIsOneReadAtATimeAndTheOtherCallersWaitForIt() async {
        let trust = RoomTrust()
        let first = await suspendedRead(trust, state())
        var reads = 0
        let read: @MainActor () async -> [JSON]? = { reads += 1; return self.state(roster: [self.helper]) }
        // A notification and the threads list share one request for the room's state, so no answer overtakes
        // another.
        let waiting = Task { await trust.refresh(read) }
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(trust.accounts, [])
        finishRead?.resume()
        await waiting.value
        await first.value
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(trust.accounts, [router])
    }

    func testTheStateIsReadWhenThatIsDue() async {
        let trust = RoomTrust()
        var reads = 0
        var answer: [JSON]? = state()
        let read: @MainActor () async -> [JSON]? = { reads += 1; return answer }
        // An open thread asks every 5 s: the state, megabytes in a busy room, is read as rarely as the threads
        // list reads it (`ResolvedRoots`).
        for seconds in [0, 5, 299, 300, 305] as [TimeInterval] { await trust.refresh(now: start.addingTimeInterval(seconds), read) }
        XCTAssertEqual(reads, 2)
        trust.expire()
        await trust.refresh(now: start.addingTimeInterval(310), read)
        XCTAssertEqual(reads, 3)
        // A read that failed is tried again by the next caller.
        answer = nil
        trust.expire()
        for seconds in [320, 325] as [TimeInterval] { await trust.refresh(now: start.addingTimeInterval(seconds), read) }
        XCTAssertEqual(reads, 5)
    }

    func testAClockSetBackAfterAReadThatSucceededReadsAgain() async {
        let trust = RoomTrust()
        var reads = 0
        let read: @MainActor () async -> [JSON]? = { reads += 1; return self.state(roster: reads == 1 ? [self.helper] : []) }
        await trust.refresh(now: start, read)
        XCTAssertEqual(trust.accounts, [router, helper])
        // The clock went back an hour: how long ago the state was read cannot be told, so it is read again,
        // and an account taken off the roster since is not trusted for that hour and 5 minutes more.
        await trust.refresh(now: start.addingTimeInterval(-3600), read)
        XCTAssertEqual(reads, 2)
        XCTAssertEqual(trust.accounts, [router])
        // From there on the 5 minutes count from the read at the new time.
        for seconds in [-3595, -3301] as [TimeInterval] { await trust.refresh(now: start.addingTimeInterval(seconds), read) }
        XCTAssertEqual(reads, 2)
        await trust.refresh(now: start.addingTimeInterval(-3300), read)
        XCTAssertEqual(reads, 3)
    }

    func testChangedSendsWithTheNewValuesAndOnlyWhenTheyChange() async {
        let trust = RoomTrust()
        var seen: [Set<String>] = []
        let subscription = trust.changed.sink { seen.append(trust.accounts.union(trust.resolved.roots)) }
        defer { subscription.cancel() }
        await read(trust, state())
        await read(trust, state())
        XCTAssertEqual(seen, [[router]])
        await read(trust, state(roster: [helper]))
        await read(trust, state(roster: [helper]) + [resolvedTag("$done")])
        await read(trust, [])
        XCTAssertEqual(seen, [[router], [router, helper], [router, helper, "$done"], []])
    }

    func testARoomHasOneTrustWhichStartsWithTheCachedResolvedThreads() {
        let trust = RoomTrust.of("!a:x", userId: "@bas:x", cached: ["$cached"])
        XCTAssertTrue(trust === RoomTrust.of("!a:x", userId: "@bas:x", cached: []))
        XCTAssertEqual(trust.resolved.roots, ["$cached"])
        XCTAssertFalse(trust === RoomTrust.of("!b:x", userId: "@bas:x", cached: []))
    }

    func testAnotherAccountHasItsOwnTrustOfTheSameRoom() async {
        let annas = RoomTrust.of("!shared:x", userId: "@anna:x", cached: ["$annas"])
        // Anna's read of the room's state is under way when she signs out and Bas signs in on the same watch.
        let underWay = await suspendedRead(annas, state(roster: [helper]) + [resolvedTag("$done")])
        let mine = RoomTrust.of("!shared:x", userId: "@bas:x", cached: ["$mine"])
        XCTAssertFalse(mine === annas)
        XCTAssertTrue(mine === RoomTrust.of("!shared:x", userId: "@bas:x", cached: []))
        XCTAssertEqual(mine.resolved.roots, ["$mine"])
        // He does not wait for her read: his own begins, and fails.
        var reads = 0
        await mine.refresh { reads += 1; return nil }
        XCTAssertEqual(reads, 1)
        // What her read says goes to her trust: he trusts nobody yet, and has the resolved threads he had.
        finishRead?.resume()
        await underWay.value
        XCTAssertEqual(annas.accounts, [router, helper])
        XCTAssertEqual(annas.resolved.roots, ["$done"])
        XCTAssertEqual(mine.accounts, [])
        XCTAssertEqual(mine.resolved.roots, ["$mine"])
    }

    func testTheResolvedThreadsAreKeptForTheNextLaunchFromWhenSomeoneKeepsThem() async {
        // The last launch kept a thread as resolved that was opened again elsewhere since.
        var kept: Set<String> = ["$reopened"]
        var writes = 0
        let trust = RoomTrust(resolved: kept)
        // A notification reads the room's state before the default room's model is there: nobody keeps it.
        await read(trust, state() + [resolvedTag("$done")])
        XCTAssertEqual(kept, ["$reopened"])
        // The model comes: what the trust says by then is kept, once...
        trust.persist = { kept = $0; writes += 1 }
        XCTAssertEqual(kept, ["$done"])
        // ...a read that says the same writes nothing, and the next launch starts with the threads as they are.
        await read(trust, state(roster: [helper]) + [resolvedTag("$done")])
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(RoomTrust(resolved: kept).resolved.roots, ["$done"])
        // From then on each change is kept: a read's, and a thread resolved here.
        await read(trust, state() + [resolvedTag("$done"), resolvedTag("$more")])
        XCTAssertEqual(kept, ["$done", "$more"])
        trust.resolve("$here")
        XCTAssertEqual(kept, ["$done", "$more", "$here"])
        // Until the model gives way to another room's.
        trust.persist = nil
        await read(trust, state())
        XCTAssertEqual(kept, ["$done", "$more", "$here"])
        XCTAssertEqual(writes, 3)
    }
}
