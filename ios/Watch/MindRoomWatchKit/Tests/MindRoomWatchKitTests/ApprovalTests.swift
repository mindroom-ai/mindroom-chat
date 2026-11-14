import XCTest
@testable import MindRoomWatchKit

final class ApprovalTests: XCTestCase {
    private func card(_ extra: JSON = [:]) -> JSON {
        var content: JSON = [
            "msgtype": "io.mindroom.tool_approval",
            "body": "🔒 Approval required: send_email",
            "tool_name": "send_email",
            "agent_name": "mind",
            "arguments": ["to": "anna@example.com", "subject": "Friday dinner", "count": 2],
            "status": "pending",
            "approval_id": "ap1",
            "thread_id": "$root",
            "expires_at": "2026-11-20T10:00:00Z",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"],
        ]
        extra.forEach { content[$0.key] = $0.value }
        return ["type": "io.mindroom.tool_approval", "event_id": "$card", "sender": "@mindroom_mind:x", "content": content]
    }

    private let before = ISO8601DateFormatter().date(from: "2026-11-14T10:00:00Z")!
    private let after = ISO8601DateFormatter().date(from: "2026-11-21T10:00:00Z")!

    func testParsesAPendingCard() throws {
        let parsed = try XCTUnwrap(ApprovalCard.parse(card()))
        XCTAssertEqual(parsed.eventId, "$card")
        XCTAssertEqual(parsed.threadId, "$root")
        XCTAssertEqual(parsed.toolName, "send_email")
        XCTAssertEqual(parsed.agentName, "mind")
        XCTAssertEqual(parsed.status, .pending)
        XCTAssertEqual(parsed.arguments.map(\.key), ["count", "subject", "to"])
        XCTAssertEqual(parsed.arguments.first { $0.key == "to" }?.value, "anna@example.com")
        XCTAssertEqual(parsed.arguments.first { $0.key == "count" }?.value, "2")
        XCTAssertFalse(parsed.argumentsTruncated)
    }

    func testIgnoresOtherEvents() {
        XCTAssertNil(ApprovalCard.parse(["type": "m.room.message", "event_id": "$x", "content": ["body": "hi"]]))
    }

    func testAnEditToItIsNotACard() {
        let edit: JSON = ["type": "io.mindroom.tool_approval", "event_id": "$edit", "content": [
            "m.new_content": ["status": "approved"], "m.relates_to": ["rel_type": "m.replace", "event_id": "$card"],
        ]]
        XCTAssertNil(ApprovalCard.parse(edit))
        XCTAssertEqual(ApprovalCard.editTarget(edit), "$card")
    }

    func testNewestEditStatusWins() throws {
        let parsed = try XCTUnwrap(ApprovalCard.parse(card()))
        let approved: JSON = ["type": "io.mindroom.tool_approval", "sender": "@mindroom_mind:x", "origin_server_ts": 2, "content": [
            "m.new_content": ["status": "approved"], "m.relates_to": ["rel_type": "m.replace", "event_id": "$card"],
        ]]
        let olderDenied: JSON = ["type": "io.mindroom.tool_approval", "sender": "@mindroom_mind:x", "origin_server_ts": 1, "content": [
            "m.new_content": ["status": "denied"], "m.relates_to": ["rel_type": "m.replace", "event_id": "$card"],
        ]]
        XCTAssertEqual(parsed.applying(edits: [approved, olderDenied], now: before).status, .approved)
    }

    func testPendingPastExpiryIsExpired() throws {
        let parsed = try XCTUnwrap(ApprovalCard.parse(card()))
        XCTAssertEqual(parsed.applying(edits: [], now: after).status, .expired)
        XCTAssertEqual(parsed.applying(edits: [], now: before).status, .pending)
    }

    func testTruncatedArgumentsAreFlagged() throws {
        let parsed = try XCTUnwrap(ApprovalCard.parse(card(["arguments_truncated": true])))
        XCTAssertTrue(parsed.argumentsTruncated)
    }

    func testResponseContentMatchesTheWebClient() throws {
        let content = approvalResponseContent(cardId: "$card", threadId: "$root", approve: true)
        XCTAssertEqual(content["status"] as? String, "approved")
        XCTAssertTrue(content["reason"] is NSNull)
        let relation = try XCTUnwrap(content["m.relates_to"] as? JSON)
        XCTAssertEqual(relation["rel_type"] as? String, "m.thread")
        XCTAssertEqual(relation["event_id"] as? String, "$root")
        XCTAssertEqual(relation["is_falling_back"] as? Bool, true)
        XCTAssertEqual((relation["m.in_reply_to"] as? JSON)?["event_id"] as? String, "$card")
        XCTAssertEqual(approvalResponseContent(cardId: "$card", threadId: "$root", approve: false)["status"] as? String, "denied")
    }
}
