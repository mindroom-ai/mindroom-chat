import Combine
import XCTest
@testable import MindRoomWatchKit

@MainActor
final class RoomTrustTests: XCTestCase {
    private let router = "@mindroom_router:x"
    private let helper = "@mindroom_helper:x"
    private var finishOlder: CheckedContinuation<Void, Never>?

    /// A room's state with `router` bound and these accounts, joined, on its roster.
    private func state(roster: [String] = []) -> [JSON] {
        [
            ["type": "m.room.power_levels", "state_key": "", "sender": "@creator:x", "content": ["users": [router: 50] as JSON] as JSON],
            ["type": "io.mindroom.router", "state_key": "", "sender": router, "content": ["user_id": router] as JSON],
            ["type": "io.mindroom.accounts", "state_key": router, "sender": router, "content": ["accounts": roster] as JSON],
        ] + roster.map { ["type": "m.room.member", "state_key": $0, "sender": $0, "content": ["membership": "join"] as JSON] }
    }

    func testTrustIsEmptyUntilAReadSucceeds() async {
        let trust = RoomTrust()
        XCTAssertEqual(trust.accounts, [])
        await trust.refresh { nil }
        XCTAssertEqual(trust.accounts, [])
        await trust.refresh { self.state(roster: [self.helper]) }
        XCTAssertEqual(trust.accounts, [router, helper])
    }

    func testAFailedReadKeepsTheLastGoodTrust() async {
        let trust = RoomTrust()
        await trust.refresh { self.state(roster: [self.helper]) }
        var changes = 0
        let subscription = trust.changed.sink { changes += 1 }
        defer { subscription.cancel() }
        await trust.refresh { nil }
        XCTAssertEqual(trust.accounts, [router, helper])
        XCTAssertEqual(changes, 0)
    }

    func testAnOlderReadThatFinishesLastIsDropped() async {
        let trust = RoomTrust()
        let underWay = expectation(description: "the older read is under way")
        let older = Task {
            await trust.refresh {
                await withCheckedContinuation { self.finishOlder = $0; underWay.fulfill() }
                return self.state(roster: [self.helper])
            }
        }
        await fulfillment(of: [underWay], timeout: 5)
        // A read that began later finds the helper gone from the roster, and finishes first.
        await trust.refresh { self.state() }
        XCTAssertEqual(trust.accounts, [router])
        finishOlder?.resume()
        await older.value
        XCTAssertEqual(trust.accounts, [router])
        // Reads that finish in the order they began all count.
        await trust.refresh { self.state(roster: [self.helper]) }
        XCTAssertEqual(trust.accounts, [router, helper])
    }

    func testChangedSendsWithTheNewAccountsAndOnlyWhenTheyChange() async {
        let trust = RoomTrust()
        var seen: [Set<String>] = []
        let subscription = trust.changed.sink { seen.append(trust.accounts) }
        defer { subscription.cancel() }
        await trust.refresh { self.state() }
        await trust.refresh { self.state() }
        XCTAssertEqual(seen, [[router]])
        await trust.refresh { self.state(roster: [self.helper]) }
        await trust.refresh { [] }
        XCTAssertEqual(seen, [[router], [router, helper], []])
    }

    func testAReadIsSkippedWhileTheLastOneIsRecent() async {
        let trust = RoomTrust()
        let start = Date(timeIntervalSince1970: 1_000)
        var reads = 0
        let read: @MainActor () async -> [JSON]? = { reads += 1; return nil }
        // An open thread asks every 5 s; the room's state is read once in 30 s, also after a read that failed.
        for seconds in [0, 5, 29, 30, 35] as [TimeInterval] {
            await trust.refresh(ifOlderThan: 30, now: start.addingTimeInterval(seconds), read)
        }
        XCTAssertEqual(reads, 2)
        // The threads list reads the state on each refresh, whatever its age.
        await trust.refresh(now: start.addingTimeInterval(36), read)
        XCTAssertEqual(reads, 3)
    }

    func testAClockSetBackDoesNotHoldUpARead() async {
        let trust = RoomTrust()
        let start = Date(timeIntervalSince1970: 1_000)
        var reads = 0
        let read: @MainActor () async -> [JSON]? = { reads += 1; return nil }
        await trust.refresh(now: start, read)
        // The threads list reads on each refresh, also when the watch's clock went back since the last read.
        await trust.refresh(now: start.addingTimeInterval(-60), read)
        XCTAssertEqual(reads, 2)
        // And an open thread does not wait until the clock is where it was.
        await trust.refresh(ifOlderThan: 30, now: start.addingTimeInterval(-120), read)
        XCTAssertEqual(reads, 3)
    }

    private func resolvedTag(_ rootId: String) -> JSON {
        ["type": ThreadTags.eventType, "state_key": ThreadTags.resolvedStateKey(root: rootId), "sender": "@bas:x",
         "content": ThreadTags.resolvedContent(userId: "@bas:x", at: Date(timeIntervalSince1970: 1_000))]
    }

    func testTheResolvedThreadsAreThoseOfTheReadThatCounts() async {
        let trust = RoomTrust()
        let underWay = expectation(description: "the list's read is under way")
        // The threads list reads the room's state before the thread was resolved...
        let list = Task {
            await trust.refresh {
                await withCheckedContinuation { self.finishOlder = $0; underWay.fulfill() }
                return self.state()
            }
        }
        await fulfillment(of: [underWay], timeout: 5)
        // ...and a notification's read, begun later, ends first. The list's own answer is dropped, and the
        // list still knows the thread is resolved: the tags are those of the read that counts.
        await trust.refresh { self.state() + [self.resolvedTag("$done")] }
        XCTAssertEqual(trust.resolved, ["$done"])
        finishOlder?.resume()
        await list.value
        XCTAssertEqual(trust.resolved, ["$done"])
        // A thread resolved on this watch stays resolved when the room's state cannot be read.
        trust.resolve("$here")
        await trust.refresh { nil }
        XCTAssertEqual(trust.resolved, ["$done", "$here"])
        await trust.refresh { self.state() }
        XCTAssertEqual(trust.resolved, [])
    }

    func testAJoiningCallerWaitsForTheReadUnderWayAndReadsWhenThereIsNone() async {
        let trust = RoomTrust()
        let underWay = expectation(description: "a read is under way")
        let first = Task {
            await trust.refresh {
                await withCheckedContinuation { self.finishOlder = $0; underWay.fulfill() }
                return self.state()
            }
        }
        await fulfillment(of: [underWay], timeout: 5)
        var reads = 0
        let read: @MainActor () async -> [JSON]? = { reads += 1; return self.state(roster: [self.helper]) }
        // Two notifications, or one and the threads list, share one request for the room's state.
        let joined = Task { await trust.refreshOrJoin(read) }
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(trust.accounts, [])
        finishOlder?.resume()
        await joined.value
        await first.value
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(trust.accounts, [router])
        await trust.refreshOrJoin(read)
        XCTAssertEqual(reads, 1)
        XCTAssertEqual(trust.accounts, [router, helper])
    }

    func testARoomHasOneTrust() {
        XCTAssertTrue(RoomTrust.of("!a:x") === RoomTrust.of("!a:x"))
        XCTAssertFalse(RoomTrust.of("!a:x") === RoomTrust.of("!b:x"))
    }
}
