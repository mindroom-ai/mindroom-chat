import XCTest
@testable import MindRoomWatchKit

final class ThreadSectionsTests: XCTestCase {
    private struct Row: Equatable {
        let id: String
        let state: ThreadRowState
    }

    func testEmptyInputReturnsNoSections() {
        let sections = groupThreadRows([Row](), state: \.state)
        XCTAssertTrue(sections.isEmpty)
    }

    func testSoleSectionOmitsEmptyBuckets() {
        let now = Date(timeIntervalSince1970: 1_000)
        let rows = [
            Row(id: "a", state: .idle(now)),
            Row(id: "b", state: .idle(now.addingTimeInterval(-60))),
        ]
        let sections = groupThreadRows(rows, state: \.state)
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections.first?.kind, .recent)
        XCTAssertEqual(sections.first?.items.map(\.id), ["a", "b"])
    }

    func testGroupsAllThreeBucketsInOrderAndPreservesItemOrder() {
        let now = Date(timeIntervalSince1970: 1_000)
        let rows = [
            Row(id: "recent-1", state: .idle(now)),
            Row(id: "working-1", state: .running),
            Row(id: "needs-1", state: .needsYou),
            Row(id: "failed-1", state: .failed),
            Row(id: "working-2", state: .running),
            Row(id: "queued-1", state: .queued),
            Row(id: "recent-2", state: .idle(now.addingTimeInterval(-120))),
            Row(id: "needs-2", state: .needsYou),
        ]
        let sections = groupThreadRows(rows, state: \.state)
        XCTAssertEqual(sections.map(\.kind), [.needsYou, .working, .recent])
        XCTAssertEqual(sections[0].items.map(\.id), ["needs-1", "failed-1", "needs-2"])
        XCTAssertEqual(sections[1].items.map(\.id), ["working-1", "working-2", "queued-1"])
        XCTAssertEqual(sections[2].items.map(\.id), ["recent-1", "recent-2"])
    }

    func testFailedStaysInNeedsYouWhileQueuedGoesToWorking() {
        let rows = [
            Row(id: "f", state: .failed),
            Row(id: "q", state: .queued),
        ]
        let sections = groupThreadRows(rows, state: \.state)
        XCTAssertEqual(sections.map(\.kind), [.needsYou, .working])
        XCTAssertEqual(sections[0].items.map(\.id), ["f"])
        XCTAssertEqual(sections[1].items.map(\.id), ["q"])
    }

    func testDurationLabelFormatting() {
        XCTAssertEqual(DurationLabel.format(seconds: -5), "0s")
        XCTAssertEqual(DurationLabel.format(seconds: 0), "0s")
        XCTAssertEqual(DurationLabel.format(seconds: 1), "1s")
        XCTAssertEqual(DurationLabel.format(seconds: 14), "14s")
        XCTAssertEqual(DurationLabel.format(seconds: 59), "59s")
        XCTAssertEqual(DurationLabel.format(seconds: 60), "1m")
        XCTAssertEqual(DurationLabel.format(seconds: 65), "1m 5s")
        XCTAssertEqual(DurationLabel.format(seconds: 133), "2m 13s")
        XCTAssertEqual(DurationLabel.format(seconds: 3600), "1h")
        XCTAssertEqual(DurationLabel.format(seconds: 3660), "1h 1m")
        XCTAssertEqual(DurationLabel.format(seconds: 7384), "2h 3m")
    }
}
