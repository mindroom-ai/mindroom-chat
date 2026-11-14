import XCTest
@testable import MindRoomWatchKit

private let me = "@bas:x"
private let agent = "@mindroom_mind:x"

private func event(_ id: String, _ ts: Int, sender: String = agent, type: String = "m.room.message", _ content: JSON) -> JSON {
    ["type": type, "event_id": id, "origin_server_ts": ts, "sender": sender, "content": content]
}

private func inThread(_ content: JSON) -> JSON {
    var content = content
    content["m.relates_to"] = ["rel_type": "m.thread", "event_id": "$root"]
    return content
}

private let voiceRoot = event("$root", 1, sender: me, [
    "msgtype": "m.audio", "body": "voice-message.m4a", "org.matrix.msc3245.voice": [:] as JSON,
])

final class ThreadSnapshotTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000)

    func testVoiceRootTakesTheTranscriptAsTitleAndAgentReplyAsLine() {
        let echo = event("$echo", 2, sender: "@mindroom_router:x", ["msgtype": "m.text", "body": "Router agent is transcribing…",
            "com.mindroom.visible_router_voice_echo": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$root"]] as JSON])
        let echoEdit = event("$echoEdit", 3, sender: "@mindroom_router:x", ["m.new_content": ["body": "🎤 Remind me to call the dentist"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$echo"] as JSON])
        let reply = event("$reply", 4, inThread(["msgtype": "m.text", "body": "…"]))
        let replyEdit = event("$replyEdit", 5, ["m.new_content": ["body": "🔧 `scheduler` [1]\nReminder set for **Saturday**.",
            "io.mindroom.ai_run": ["version": 1, "status": "completed"]] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [echo, echoEdit, reply, replyEdit], ownUserId: me, now: now)
        XCTAssertTrue(snapshot.isVoiceRoot)
        XCTAssertEqual(snapshot.title, "🎤 Remind me to call the dentist")
        XCTAssertEqual(snapshot.reply?.sender, agent)
        XCTAssertEqual(snapshot.reply?.text, "Reminder set for Saturday.")
        XCTAssertEqual(snapshot.reply?.tools, 1)
        XCTAssertEqual(snapshot.reply?.run, .finished)
        XCTAssertEqual(snapshot.latestEventId, "$reply")
        XCTAssertEqual(snapshot.latestTs, 4)
    }

    func testAITitleWinsOverTheTranscript() {
        let summary = event("$sum", 6, sender: "@mindroom_router:x", inThread(["msgtype": "m.notice", "body": "Dentist reminder",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Dentist reminder"] as JSON]))
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [summary], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.title, "Dentist reminder")
        XCTAssertNil(snapshot.reply)
    }

    func testTextRootIsItsOwnTitleWithoutAnswer() {
        let root = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "Book a table for **four**"])
        let snapshot = ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now)
        XCTAssertFalse(snapshot.isVoiceRoot)
        XCTAssertEqual(snapshot.title, "Book a table for four")
        XCTAssertEqual(snapshot.latestEventId, "$root")
    }

    func testPendingApprovalUntilItsEdit() {
        let card = event("$card", 3, type: "io.mindroom.tool_approval", inThread([
            "msgtype": "io.mindroom.tool_approval", "body": "approval", "tool_name": "send_email", "status": "pending",
            "arguments": ["to": "anna@example.com"] as JSON, "thread_id": "$root",
        ]))
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [card], ownUserId: me, now: now).pendingApproval?.eventId, "$card")
        let approved = event("$cardEdit", 4, type: "io.mindroom.tool_approval", ["m.new_content": ["status": "approved"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$card"] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [card, approved], ownUserId: me, now: now)
        XCTAssertNil(snapshot.pendingApproval)
        XCTAssertEqual(snapshot.approvals.first?.status, .approved)
    }

    func testQuestionOpenUntilAnswered() {
        let question = event("$q", 3, inThread(["msgtype": "m.text", "body": "Which?", "io.mindroom.interactive": [
            "question_text": "Which flight?", "options": ["✈️": "a", "🌙": "b", "1": "a", "2": "b"] as JSON,
        ] as JSON]))
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [question], ownUserId: me, now: now).openQuestion?.eventId, "$q")
        let reaction = event("$r", 4, sender: me, type: "m.reaction", ["m.relates_to": ["rel_type": "m.annotation", "event_id": "$q", "key": "🌙"] as JSON])
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [question, reaction], ownUserId: me, now: now).openQuestion)
        let laterMessage = event("$m", 5, sender: me, inThread(["msgtype": "m.text", "body": "2"]))
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [question, laterMessage], ownUserId: me, now: now).openQuestion)
    }

    func testRowLineAndState() {
        let reply = event("$reply", 4, inThread(["msgtype": "m.text", "body": "Done", "io.mindroom.stream_status": "streaming"]))
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.rowState(lastSeenEventId: nil), .running)
        let stopped = ThreadSnapshot.build(root: voiceRoot, related: [event("$reply", 4, inThread(["msgtype": "m.text", "body": "Done"]))], ownUserId: me, now: now)
        XCTAssertEqual(stopped.rowState(lastSeenEventId: nil), .unread)
        XCTAssertEqual(stopped.rowState(lastSeenEventId: "$reply"), .idle(Date(timeIntervalSince1970: 0.004)))
    }

    func testUndecryptableEventsAreSkipped() {
        let encrypted = event("$enc", 4, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [encrypted], ownUserId: me, now: now)
        XCTAssertNil(snapshot.reply)
        XCTAssertEqual(snapshot.latestEventId, "$root")
    }
}
