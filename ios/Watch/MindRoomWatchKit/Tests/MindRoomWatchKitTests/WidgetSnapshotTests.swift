import XCTest
@testable import MindRoomWatchKit

final class WidgetSnapshotTests: XCTestCase {
    func testSummary() {
        XCTAssertEqual(WidgetSnapshot(roomName: "Notes", needsYou: 2, running: 1, updatedAt: .distantPast).summary, "2 need you · 1 running")
        XCTAssertEqual(WidgetSnapshot(roomName: "Notes", needsYou: 1, running: 0, updatedAt: .distantPast).summary, "1 needs you")
        XCTAssertEqual(WidgetSnapshot(roomName: "Notes", needsYou: 0, running: 3, updatedAt: .distantPast).summary, "3 running")
        XCTAssertEqual(WidgetSnapshot(roomName: "Notes", needsYou: 0, running: 0, updatedAt: .distantPast).summary, "All quiet")
    }

    func testStoresAndReadsBack() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "widget-snapshot-test"))
        defaults.removePersistentDomain(forName: "widget-snapshot-test")
        XCTAssertNil(WidgetSnapshot.read(from: defaults))
        let snapshot = WidgetSnapshot(roomName: "Notes", needsYou: 1, running: 0, updatedAt: Date(timeIntervalSince1970: 1000))
        snapshot.write(to: defaults)
        XCTAssertEqual(WidgetSnapshot.read(from: defaults), snapshot)
    }

    func testCountsFromRowStates() {
        let states: [ThreadRowState] = [.needsYou, .running, .needsYou, .idle(.distantPast)]
        let snapshot = WidgetSnapshot(roomName: "Notes", states: states, at: .distantPast)
        XCTAssertEqual(snapshot.needsYou, 2)
        XCTAssertEqual(snapshot.running, 1)
    }

    func testTheHomeScreenCountsAFailedSendAsItsNeedsYouSectionDoes() {
        let states: [ThreadRowState] = [.needsYou, .failed, .running, .queued, .idle(.distantPast)]
        let home = WidgetSnapshot.home(roomName: "Notes", states: states, at: .distantPast)
        let section = groupThreadRows(states) { $0 }.first { $0.kind == .needsYou }
        XCTAssertEqual(home.needsYou, 2)
        XCTAssertEqual(home.needsYou, section?.items.count)
        XCTAssertEqual(home.running, 1)
        XCTAssertEqual(home.summary, "2 need you · 1 running")
        // The complications leave the failed send out.
        XCTAssertEqual(WidgetSnapshot(roomName: "Notes", states: states, at: .distantPast).needsYou, 1)
    }
}
