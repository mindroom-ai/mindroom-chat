import XCTest
@testable import MindRoomWatchKit

final class ThreadTagsTests: XCTestCase {
    private func tag(_ key: String, _ content: JSON) -> JSON {
        ["type": "com.mindroom.thread.tags", "state_key": key, "content": content]
    }

    func testResolvedTagMarksTheRoot() {
        let state = [tag(#"["$a","resolved"]"#, ["set_by": "@bas:x", "set_at": "2026-11-14T00:00:00Z"]),
                     tag(#"["$b","resolved"]"#, [:]),
                     ["type": "m.room.name", "state_key": "", "content": ["name": "Notes"]]]
        XCTAssertEqual(ThreadTags.resolvedRoots(state: state), ["$a"])
    }

    func testLegacyTagsAndPinnedThreads() {
        // As the web client: a pinned event (m.room.pinned_events) never reads as resolved; a "pinned" tag does not count.
        let state = [tag("$old", ["tags": ["resolved": ["set_by": "@bas:x"]]]),
                     tag(#"["$p","resolved"]"#, ["set_by": "@bas:x"]),
                     tag(#"["$t","resolved"]"#, ["set_by": "@bas:x"]),
                     tag(#"["$t","pinned"]"#, ["set_by": "@bas:x"]),
                     ["type": "m.room.pinned_events", "state_key": "", "content": ["pinned": ["$p"]]]]
        XCTAssertEqual(ThreadTags.resolvedRoots(state: state), ["$old", "$t"])
    }

    func testAPerTagTombstoneReopensALegacyResolvedThread() {
        let state = [tag("$old", ["tags": ["resolved": ["set_by": "@bas:x"]]]), tag(#"["$old","resolved"]"#, [:])]
        XCTAssertEqual(ThreadTags.resolvedRoots(state: state), [])
    }

    func testStateKeyAndContentForResolving() {
        XCTAssertEqual(ThreadTags.resolvedStateKey(root: "$a"), #"["$a","resolved"]"#)
        let content = ThreadTags.resolvedContent(userId: "@bas:x", at: ISO8601DateFormatter().date(from: "2026-11-14T00:00:00Z")!)
        XCTAssertEqual(content["set_by"] as? String, "@bas:x")
        XCTAssertEqual(content["set_at"] as? String, "2026-11-14T00:00:00Z")
    }
}

final class PlainTextTests: XCTestCase {
    func testDropsMarkdownKeepsLines() {
        XCTAssertEqual(PlainText.of(markdown: "**Two** options:\n- TAP `07:10`\n- [KLM](https://klm.com) 21:35"), "Two options:\n• TAP 07:10\n• KLM 21:35")
    }

    func testCountsAndRemovesToolCallLines() {
        let result = PlainText.withToolCount("🔧 `web_search` [1]\n🔧 `calendar` [2] ⏳\nDone, booked.")
        XCTAssertEqual(result.tools, 2)
        XCTAssertEqual(result.text, "Done, booked.")
    }

    func testMentionsBecomeDisplayNames() {
        let text = "@mindroom_helper_t1:matrix.localhost could you help? cc @bas:x."
        XCTAssertEqual(PlainText.mentionedUserIds(text), ["@mindroom_helper_t1:matrix.localhost", "@bas:x"])
        XCTAssertEqual(PlainText.replacingMentions(text, names: ["@mindroom_helper_t1:matrix.localhost": "Helper"]),
                       "Helper could you help? cc @bas:x.")
    }

    func testToolLinesInsideCodeFencesStay() {
        let result = PlainText.withToolCount("```\n🔧 `x` [1]\n```")
        XCTAssertEqual(result.tools, 0)
        XCTAssertEqual(result.text, "🔧 `x` [1]")
    }
}

final class WaveformTests: XCTestCase {
    func testBucketsAndScales() {
        let bars = Waveform.bars(from: [-160, -160, 0, 0], count: 2)
        XCTAssertEqual(bars.count, 2)
        XCTAssertEqual(bars[0], 0, accuracy: 0.001)
        XCTAssertEqual(bars[1], 1, accuracy: 0.001)
    }

    func testAlways48ByDefaultEvenForShortTakes() {
        XCTAssertEqual(Waveform.bars(from: [-20]).count, 48)
        XCTAssertEqual(Waveform.bars(from: []).count, 48)
        XCTAssertTrue(Waveform.bars(from: Array(repeating: -30, count: 500)).allSatisfy { $0 >= 0 && $0 <= 1 })
    }
}
