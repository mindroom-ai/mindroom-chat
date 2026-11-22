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

final class ResolvedRootsTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_000)

    func testAReadStandsFiveMinutesFromItsBeginningAndAFailedOneNotAtAll() {
        var resolved = ResolvedRoots(["$cached"])
        XCTAssertTrue(resolved.isDue(now: start))
        resolved.beginRead(now: start)
        XCTAssertFalse(resolved.isDue(now: start.addingTimeInterval(600)), "one read at a time")
        resolved.endRead(nil)
        XCTAssertEqual(resolved.roots, ["$cached"])
        XCTAssertTrue(resolved.isDue(now: start.addingTimeInterval(1)))

        resolved.beginRead(now: start.addingTimeInterval(1))
        resolved.endRead(["$a"])
        XCTAssertEqual(resolved.roots, ["$a"])
        XCTAssertFalse(resolved.isDue(now: start.addingTimeInterval(300)))
        XCTAssertTrue(resolved.isDue(now: start.addingTimeInterval(301)))
    }

    func testAThreadResolvedHereDuringAReadStaysResolvedAndTheStateIsReadAgain() {
        var resolved = ResolvedRoots([])
        resolved.beginRead(now: start)
        resolved.resolve("$mine")
        // The read began before the tag was there.
        resolved.endRead(["$a"])
        XCTAssertEqual(resolved.roots, ["$a", "$mine"])
        XCTAssertTrue(resolved.isDue(now: start.addingTimeInterval(1)))
        // The next read is the room's word again: a thread opened again elsewhere leaves.
        resolved.beginRead(now: start.addingTimeInterval(1))
        resolved.endRead(["$mine"])
        XCTAssertEqual(resolved.roots, ["$mine"])
        XCTAssertFalse(resolved.isDue(now: start.addingTimeInterval(2)))
    }

    func testResolvingAndComingToTheFrontAskForARead() {
        var resolved = ResolvedRoots([])
        resolved.beginRead(now: start)
        resolved.endRead([])
        XCTAssertFalse(resolved.isDue(now: start.addingTimeInterval(1)))
        resolved.resolve("$mine")
        XCTAssertEqual(resolved.roots, ["$mine"])
        XCTAssertTrue(resolved.isDue(now: start.addingTimeInterval(1)))
        // A read that began after the resolve does not keep it against the room's state (a pinned thread).
        resolved.beginRead(now: start.addingTimeInterval(1))
        resolved.endRead([])
        XCTAssertEqual(resolved.roots, [])
        XCTAssertFalse(resolved.isDue(now: start.addingTimeInterval(2)))
        resolved.expire()
        XCTAssertTrue(resolved.isDue(now: start.addingTimeInterval(2)))
    }
}

final class ThreadListEntryTests: XCTestCase {
    private let me = "@bas:x"
    private let agent = "@mindroom_mind:x"
    private let router = "@mindroom_router:x"

    private func event(_ id: String, _ ts: Int, sender: String, type: String = "m.room.message", _ content: JSON) -> JSON {
        ["type": type, "event_id": id, "origin_server_ts": ts, "sender": sender, "content": content]
    }

    private func edit(_ id: String, _ ts: Int, of target: String?, sender: String, _ newContent: JSON?) -> JSON {
        var content: JSON = ["msgtype": "m.text", "body": "* edit"]
        content["m.new_content"] = newContent
        if let target { content["m.relates_to"] = ["rel_type": "m.replace", "event_id": target] }
        return event(id, ts, sender: sender, content)
    }

    private func bundling(_ edit: JSON, in event: JSON) -> JSON {
        var event = event
        var unsigned = event["unsigned"] as? JSON ?? [:]
        var relations = unsigned["m.relations"] as? JSON ?? [:]
        relations["m.replace"] = edit
        unsigned["m.relations"] = relations
        event["unsigned"] = unsigned
        return event
    }

    /// A root as `/threads` returns it, with the thread's bundle.
    private func root(_ content: JSON = ["msgtype": "m.text", "body": "Root body"], thread: JSON) -> JSON {
        var root = event("$root", 10, sender: me, content)
        root["unsigned"] = ["m.relations": ["m.thread": thread]]
        return root
    }

    private func reply(_ content: JSON = ["msgtype": "m.text", "body": "Working…"], sender: String? = nil, ts: Int = 15) -> JSON {
        event("$reply", ts, sender: sender ?? agent, content)
    }

    private var title: JSON {
        event("$title", 30, sender: router, ["msgtype": "m.notice", "body": "Old title",
                                             "io.mindroom.thread_summary": ["version": 1, "summary": "Old title"] as JSON])
    }

    func testTitleReplyAndTimeComeFromTheBundleWithItsEdits() {
        let renamed = bundling(edit("$rename", 31, of: "$title", sender: router, [
            "msgtype": "m.notice", "body": "Renamed", "io.mindroom.thread_summary": ["version": 1, "summary": "Renamed"] as JSON,
        ]), in: title)
        let answered = bundling(edit("$final", 25, of: "$reply", sender: agent, ["msgtype": "m.text", "body": "**Done.**"]), in: reply())
        let entry = ThreadListEntry.parse(root(thread: [
            "count": 3, "latest_event": renamed, "io.mindroom.title": renamed, "io.mindroom.latest_reply": answered,
        ]), ownUserId: me)
        XCTAssertEqual(entry?.rootId, "$root")
        XCTAssertEqual(entry?.title, "Renamed")
        XCTAssertEqual(entry?.reply?.sender, agent)
        XCTAssertEqual(entry?.reply?.text, "Done.")
        XCTAssertEqual(entry?.rootTs, 10)
        // The reply's edit, not the title after it.
        XCTAssertEqual(entry?.latestTs, 25)
        XCTAssertEqual(entry?.key, "$title 3")
    }

    func testAThreadWithoutABundledTitleIsCalledAsWithoutOne() {
        let edited = bundling(edit("$rootEdit", 12, of: "$root", sender: me, ["msgtype": "m.text", "body": "Edited root"]),
                              in: root(thread: ["count": 1, "latest_event": reply()]))
        let entry = ThreadListEntry.parse(edited, ownUserId: me)
        XCTAssertEqual(entry?.title, "Edited root")
        XCTAssertEqual(entry?.reply?.text, "Working…")
        XCTAssertEqual(entry?.latestTs, 15)
        XCTAssertEqual(entry?.key, "$reply 1")

        let voice = ThreadListEntry.parse(root(["msgtype": "m.audio", "body": "voice-message.m4a", "org.matrix.msc3245.voice": [:] as JSON],
                                               thread: [:]), ownUserId: me)
        XCTAssertEqual(voice?.title, "Voice message")
        XCTAssertEqual(voice?.voiceFile, "voice-message.m4a")
        XCTAssertNil(voice?.reply)
        XCTAssertEqual(voice?.latestTs, 10)
        XCTAssertEqual(voice?.key, "$root 0")
        XCTAssertNil(ThreadListEntry.parse(["type": "m.room.message"], ownUserId: me))
    }

    func testOwnMessagesRelaysEchoesAndTitlesAreNoReply() {
        let echo: JSON = ["msgtype": "m.text", "body": "🎤 Hello watch", "com.mindroom.visible_router_voice_echo": true,
                          "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$root"]] as JSON]
        let none: [JSON] = [
            ["count": 1, "latest_event": reply(sender: me)],
            ["count": 1, "latest_event": reply(["msgtype": "m.text", "body": "Relayed", "com.mindroom.original_sender": me], sender: router)],
            ["count": 1, "latest_event": reply(echo, sender: router)],
            ["count": 1, "latest_event": title, "io.mindroom.title": title],
        ]
        for thread in none {
            XCTAssertNil(ThreadListEntry.parse(root(thread: thread), ownUserId: me)?.reply, "\(thread)")
        }
        XCTAssertEqual(ThreadListEntry.parse(root(thread: none[3]), ownUserId: me)?.title, "Old title")
        // What the router wrote out of a voice root names it, as in the thread.
        let voice = root(["msgtype": "m.audio", "body": "voice-message.m4a", "org.matrix.msc3245.voice": [:] as JSON], thread: none[2])
        XCTAssertEqual(ThreadListEntry.parse(voice, ownUserId: me)?.title, "🎤 Hello watch")
    }

    func testABundledEditCountsOnlyFromTheSenderReadableAndNamingItsEvent() {
        let final: JSON = ["msgtype": "m.text", "body": "Final"]
        let invalid = [
            edit("$e", 25, of: "$reply", sender: router, final),
            edit("$e", 25, of: "$other", sender: agent, final),
            edit("$e", 25, of: nil, sender: agent, final),
            edit("$e", 25, of: "$reply", sender: agent, nil),
        ]
        for other in invalid {
            let entry = ThreadListEntry.parse(root(thread: ["count": 1, "latest_event": bundling(other, in: reply())]), ownUserId: me)
            XCTAssertEqual(entry?.reply?.text, "Working…", "\(other)")
            XCTAssertEqual(entry?.latestTs, 15, "\(other)")
        }
        let valid = bundling(edit("$e", 25, of: "$reply", sender: agent, final), in: reply())
        XCTAssertEqual(ThreadListEntry.parse(root(thread: ["count": 1, "latest_event": valid]), ownUserId: me)?.reply?.text, "Final")
    }

    func testAnEncryptedNewestEventGivesOnlyItsTime() {
        let entry = ThreadListEntry.parse(root(thread: [
            "count": 4, "latest_event": event("$secret", 50, sender: agent, type: "m.room.encrypted", ["ciphertext": "…"]),
        ]), ownUserId: me)
        XCTAssertEqual(entry?.title, "Root body")
        XCTAssertNil(entry?.reply)
        XCTAssertEqual(entry?.latestTs, 50)
        XCTAssertEqual(entry?.key, "$secret 4")
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
