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
        XCTAssertEqual(snapshot.latestTs, 5)
        XCTAssertEqual(snapshot.rootTs, 1)
    }

    func testAITitleWinsOverTheTranscript() {
        let summary = event("$sum", 6, sender: "@mindroom_router:x", inThread(["msgtype": "m.notice", "body": "Dentist reminder",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Dentist reminder"] as JSON]))
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [summary], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.title, "Dentist reminder")
        XCTAssertNil(snapshot.reply)
    }

    func testRouterRelayIsNotTheReply() {
        let answer = event("$answer", 2, inThread(["msgtype": "m.text", "body": "Booked the table."]))
        let relay = event("$relay", 3, sender: "@mindroom_router:x", inThread(["msgtype": "m.text",
            "body": "@Helper could you help with this?", "com.mindroom.original_sender": me]))
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, relay], ownUserId: me, now: now).reply?.eventId, "$answer")
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [relay], ownUserId: me, now: now).reply)
    }

    func testOnlyTheSendersOwnEditsCount() {
        let reply = event("$reply", 2, inThread(["msgtype": "m.text", "body": "Booked."]))
        let forged = event("$forged", 3, sender: "@anna:x", ["m.new_content": ["body": "Cancelled everything."] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [reply, forged], ownUserId: me, now: now).reply?.text, "Booked.")
        let approved = event("$cardEdit", 4, sender: "@anna:x", type: "io.mindroom.tool_approval", ["m.new_content": ["status": "approved"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$c"] as JSON])
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [card("$c", 3), approved], ownUserId: me, now: now).pendingApproval?.eventId, "$c")
    }

    func testAnEditThatDoesNotDecryptLeavesTheNewestReadableOne() {
        let reply = event("$reply", 4, inThread(["msgtype": "m.text", "body": "Thinking…", "io.mindroom.stream_status": "streaming"]))
        let readable = event("$edit1", 5, ["m.new_content": ["body": "Almost", "io.mindroom.stream_status": "streaming"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        // An encrypted edit keeps its relation in the clear and has no content to read.
        let locked = event("$edit2", 6, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x",
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply, readable, locked], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.reply?.text, "Almost")
    }

    func testAnEditedSummaryRetitlesTheThread() {
        let summary = event("$sum", 6, sender: "@mindroom_router:x", inThread(["msgtype": "m.notice", "body": "Dentist",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Dentist"] as JSON]))
        let edit = event("$sumEdit", 7, sender: "@mindroom_router:x", ["m.new_content": ["msgtype": "m.notice", "body": "Dentist on Friday",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Dentist on Friday"] as JSON] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$sum"] as JSON])
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [summary, edit], ownUserId: me, now: now).title, "Dentist on Friday")
    }

    func testAPushedEventActsOnlyWhereTheThreadDoes() {
        let mine = card("$mine", 3)
        let anna = card("$anna", 4, extra: ["approver_user_id": "@anna:x"])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [mine, anna], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.pushed(eventId: "$mine"), .approval(snapshot.approvals[0], actionable: true))
        XCTAssertEqual(snapshot.pushed(eventId: "$anna"), .approval(snapshot.approvals[1], actionable: false))
        let asked = ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3)], ownUserId: me, now: now)
        XCTAssertEqual(asked.pushed(eventId: "$q"), .question(asked.openQuestion!))
        let stale = ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3)], ownUserId: me, now: Date(timeIntervalSince1970: 8 * 24 * 3600))
        XCTAssertEqual(stale.pushed(eventId: "$q"), .message)
    }

    func testAPushedEditIsAboutTheMessageItFinished() {
        // The homeserver pushes the edit that finished an agent's reply, not the reply.
        let edit = event("$edit", 5, ["body": "* done", "m.new_content": ["msgtype": "m.text", "body": "done"],
                                      "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"]])
        XCTAssertEqual(ThreadSnapshot.pushedEventId(of: edit), "$reply")
        XCTAssertEqual(ThreadSnapshot.pushedEventId(of: question("$q", 3)), "$q")
    }

    func testThreadRootOfAPushedEvent() {
        XCTAssertEqual(ThreadSnapshot.threadRootId(of: question("$q", 3)), "$root")
        XCTAssertEqual(ThreadSnapshot.threadRootId(of: voiceRoot), "$root")
        XCTAssertEqual(ThreadSnapshot.threadRootId(of: event("$plain", 2, ["msgtype": "m.text", "body": "hi"])), "$plain")
    }

    func testTextRootIsItsOwnTitleWithoutAnswer() {
        let root = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "Book a table for **four**"])
        let snapshot = ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now)
        XCTAssertFalse(snapshot.isVoiceRoot)
        XCTAssertEqual(snapshot.title, "Book a table for four")
        XCTAssertEqual(snapshot.latestTs, 1)
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

    private func card(_ id: String, _ ts: Int, sender: String = "@mindroom_router:x", extra: JSON = [:]) -> JSON {
        var content: JSON = ["msgtype": "io.mindroom.tool_approval", "body": "approval", "tool_name": "send_email", "status": "pending",
                             "arguments": ["to": "a"] as JSON, "thread_id": "$root"]
        extra.forEach { content[$0.key] = $0.value }
        return event(id, ts, sender: sender, type: "io.mindroom.tool_approval", inThread(content))
    }

    func testCardsForSomeoneElseOrFromPeopleDoNotNeedYou() {
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [card("$c", 3, extra: ["approver_user_id": "@anna:x"])], ownUserId: me, now: now).pendingApproval)
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [card("$c", 3, sender: "@anna:x")], ownUserId: me, now: now).pendingApproval)
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [card("$c", 3, sender: "@mindroom_router:other.server")], ownUserId: me, now: now).pendingApproval)
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [card("$c", 3, extra: ["approver_user_id": me])], ownUserId: me, now: now).pendingApproval?.eventId, "$c")
    }

    func testUnreviewableCardIsNotApprovable() throws {
        let parsed = try XCTUnwrap(ApprovalCard.parse(card("$c", 3, extra: ["approvable": false])))
        XCTAssertFalse(parsed.approvable)
        XCTAssertTrue(try XCTUnwrap(ApprovalCard.parse(card("$c", 3))).approvable)
    }

    private func question(_ id: String, _ ts: Int, text: String = "Which flight?", source: String? = nil) -> JSON {
        var interactive: JSON = ["question_text": text, "options": ["✈️": "a", "🌙": "b", "1": "b", "2": "a"] as JSON,
                                 "option_labels": ["✈️": "07:10", "🌙": "21:35"] as JSON]
        if let source { interactive["source_event_id"] = source }
        return event(id, ts, inThread(["msgtype": "m.text", "body": "Which?", "io.mindroom.interactive": interactive]))
    }

    func testOptionsKeepTheAgentsOrder() {
        // The number keys give the order: 1 is 🌙's value, 2 is ✈️'s.
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3)], ownUserId: me, now: now).openQuestion?.options.map(\.key), ["🌙", "✈️"])
    }

    func testOnlyTheNewestAgentReplyAsks() {
        let later = event("$later", 5, inThread(["msgtype": "m.text", "body": "Booked it anyway."]))
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3), later], ownUserId: me, now: now).openQuestion)
    }

    func testQuestionsForSomeoneElseOrStaleOrEmptyAreNotOpen() {
        let annasMessage = event("$anna", 2, sender: "@anna:x", inThread(["msgtype": "m.text", "body": "book it"]))
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [annasMessage, question("$q", 3, source: "$anna")], ownUserId: me, now: now).openQuestion)
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3, source: "$root")], ownUserId: me, now: now).openQuestion?.eventId, "$q")
        let eightDaysLater = Date(timeIntervalSince1970: 8 * 24 * 3600)
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3)], ownUserId: me, now: eightDaysLater).openQuestion)
        XCTAssertNil(ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 3, text: "")], ownUserId: me, now: now).openQuestion)
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
        XCTAssertEqual(snapshot.rowState, .running)
        let stopped = ThreadSnapshot.build(root: voiceRoot, related: [event("$reply", 4, inThread(["msgtype": "m.text", "body": "Done"]))], ownUserId: me, now: now)
        XCTAssertEqual(stopped.rowState, .idle(Date(timeIntervalSince1970: 0.004)))
    }

    func testAReplyStillStreamingAfterAnApprovalCardIsRunning() {
        // The agent's reply began before the card and goes on once the card is approved.
        let reply = event("$reply", 2, inThread(["msgtype": "m.text", "body": "…", "io.mindroom.stream_status": "streaming"]))
        let approved = event("$cardEdit", 4, sender: "@mindroom_router:x", type: "io.mindroom.tool_approval",
                             ["m.new_content": ["status": "approved"] as JSON,
                              "m.relates_to": ["rel_type": "m.replace", "event_id": "$card"] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply, card("$card", 3), approved], ownUserId: me, now: now)
        XCTAssertNil(snapshot.pendingApproval)
        XCTAssertEqual(snapshot.rowState, .running)
    }

    func testTheRowsTimeIsItsNewestEdit() {
        let reply = event("$reply", 2, inThread(["msgtype": "m.text", "body": "…"]))
        let done = event("$done", 9, ["m.new_content": ["body": "Done", "io.mindroom.ai_run": ["version": 1, "status": "completed"]] as JSON,
                                      "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply, done], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.latestTs, 9)
        XCTAssertEqual(snapshot.rowState, .idle(Date(timeIntervalSince1970: 0.009)))
    }

    func testAVoiceRootNamesItsFile() {
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [], ownUserId: me, now: now).voiceFile, "voice-message.m4a")
        let captioned = event("$root", 1, sender: me, ["msgtype": "m.audio", "body": "A caption", "filename": "take.m4a",
                                                        "org.matrix.msc3245.voice": [:] as JSON])
        XCTAssertEqual(ThreadSnapshot.build(root: captioned, related: [], ownUserId: me, now: now).voiceFile, "take.m4a")
        let text = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "voice-message.m4a"])
        XCTAssertNil(ThreadSnapshot.build(root: text, related: [], ownUserId: me, now: now).voiceFile)
    }

    func testUndecryptableRootIsAnEncryptedMessage() {
        let root = event("$root", 1, sender: me, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        XCTAssertEqual(ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now).title, "Encrypted message")
    }

    private func ids(_ snapshot: ThreadSnapshot) -> [String] { snapshot.entries.map(\.id) }

    private func source(_ message: ThreadSnapshot.Message?) -> JSON? {
        (message?.audio).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? JSON }
    }

    func testTheEntriesAreTheWholeThreadInOrder() {
        let root = event("$root", 1, sender: me, ["msgtype": "m.audio", "body": "voice-message.m4a", "url": "mxc://x/take",
                                                  "org.matrix.msc3245.voice": [:] as JSON])
        let echo = event("$echo", 2, sender: "@mindroom_router:x", ["msgtype": "m.text", "body": "🎤 Book a table",
            "com.mindroom.visible_router_voice_echo": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$root"]] as JSON])
        let relay = event("$relay", 3, sender: "@mindroom_router:x", inThread(["msgtype": "m.text", "body": "@Helper could you?",
                                                                               "com.mindroom.original_sender": me]))
        let answer = event("$answer", 4, inThread(["msgtype": "m.text", "body": "🔧 `tables` [1]\nFor **when**?"]))
        let mine = event("$mine", 5, sender: me, inThread(["msgtype": "m.text", "body": "Tonight"]))
        let summary = event("$sum", 6, sender: "@mindroom_router:x", inThread(["msgtype": "m.notice", "body": "Table",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Table"] as JSON]))
        let annas = card("$annas", 7, extra: ["approver_user_id": "@anna:x"])
        let approved = event("$annasEdit", 8, sender: "@mindroom_router:x", type: "io.mindroom.tool_approval",
                             ["m.new_content": ["status": "approved"] as JSON,
                              "m.relates_to": ["rel_type": "m.replace", "event_id": "$annas"] as JSON])
        let snapshot = ThreadSnapshot.build(root: root, related: [mine, card("$card", 9), summary, answer, relay, echo, annas],
                                            ownUserId: me, now: now)
        // Without the router's echo, relay and title, and without the card that waits for someone else.
        XCTAssertEqual(ids(snapshot), ["$root", "$answer", "$mine", "$card"])
        guard case let .message(first) = snapshot.entries[0], case let .message(second) = snapshot.entries[1],
              case let .approval(waiting) = snapshot.entries[3] else { return XCTFail("\(snapshot.entries)") }
        // The person's voice message reads as what they said, and still plays.
        XCTAssertEqual(first, ThreadSnapshot.Message(eventId: "$root", sender: me, isOwn: true, text: "🎤 Book a table",
                                                     audio: first.audio, tools: 0, run: .none))
        XCTAssertEqual(source(first)?["url"] as? String, "mxc://x/take")
        XCTAssertEqual(second, ThreadSnapshot.Message(eventId: "$answer", sender: agent, isOwn: false, text: "For when?",
                                                      audio: nil, tools: 1, run: .none))
        XCTAssertEqual(waiting.eventId, snapshot.pendingApproval?.eventId)
        // Once decided, the other person's card is part of what happened.
        let decided = ThreadSnapshot.build(root: root, related: [answer, annas, approved], ownUserId: me, now: now)
        XCTAssertEqual(ids(decided), ["$root", "$answer", "$annas"])
    }

    func testAVoiceAnswerIsAVoiceMessageNotItsFileName() {
        // What the backend's voice tool sends: the body is the file's name, and the words are only in the audio.
        let spoken = event("$spoken", 4, inThread(["msgtype": "m.audio", "body": "voice-message.opus", "url": "mxc://x/answer",
                                                   "org.matrix.msc3245.voice": [:] as JSON]))
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [spoken], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.reply?.text, "")
        XCTAssertEqual(snapshot.reply?.isVoiceOnly, true)
        XCTAssertEqual(source(snapshot.reply)?["url"] as? String, "mxc://x/answer")
        // In an encrypted room the file's keys come with the event.
        let encrypted = event("$spoken", 4, inThread(["msgtype": "m.audio", "body": "voice-message.opus",
                                                      "file": ["url": "mxc://x/secret", "v": "v2"] as JSON]))
        let file = source(ThreadSnapshot.build(root: voiceRoot, related: [encrypted], ownUserId: me, now: now).reply)?["file"] as? JSON
        XCTAssertEqual(file?["url"] as? String, "mxc://x/secret")
        XCTAssertEqual(file?["v"] as? String, "v2")
        // Text is not a voice message, and neither is audio the router wrote out.
        let text = ThreadSnapshot.build(root: voiceRoot, related: [event("$t", 4, inThread(["msgtype": "m.text", "body": "Hi"]))],
                                        ownUserId: me, now: now)
        XCTAssertEqual(text.reply?.isVoiceOnly, false)
        XCTAssertNil(text.reply?.audio)
    }

    func testAnAudioRootIsNotNamedByItsFile() {
        // The backend's voice tool leaves the voice mark out when it does not know how long the audio is.
        let root = event("$root", 1, ["msgtype": "m.audio", "body": "voice-message.opus", "url": "mxc://x/answer"])
        XCTAssertEqual(ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now).title, "Voice message")
    }

    func testAVoiceReplyInTheThreadReadsAsItsTranscript() {
        let again = event("$again", 5, sender: me, inThread(["msgtype": "m.audio", "body": "voice-message-2.m4a", "url": "mxc://x/again",
                                                             "org.matrix.msc3245.voice": [:] as JSON]))
        let echo = event("$echo", 6, sender: "@mindroom_router:x", ["msgtype": "m.text", "body": "🎤 And for two",
            "com.mindroom.visible_router_voice_echo": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$again"]] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [again, echo], ownUserId: me, now: now)
        guard case let .message(root) = snapshot.entries[0], case let .message(reply) = snapshot.entries[1] else {
            return XCTFail("\(snapshot.entries)")
        }
        // Not yet written out: a voice message, to play.
        XCTAssertEqual(root.text, "")
        XCTAssertNil(root.audio, "the fixture's root has no file")
        XCTAssertEqual(reply.text, "🎤 And for two")
        XCTAssertEqual(snapshot.title, "Voice message")
    }

    func testTheThreadOpensAtWhatWaitsElseAtTheNewestAnswer() {
        let answer = event("$answer", 4, inThread(["msgtype": "m.text", "body": "Booked."]))
        let mine = event("$mine", 5, sender: me, inThread(["msgtype": "m.text", "body": "Thanks"]))
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [], ownUserId: me, now: now).focusId, "$root")
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, mine], ownUserId: me, now: now).focusId, "$answer")
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, question("$q", 6)], ownUserId: me, now: now).focusId, "$q")
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, question("$q", 6), card("$card", 7)], ownUserId: me, now: now).focusId, "$card")
    }

    func testUndecryptableEventsAreSkipped() {
        let encrypted = event("$enc", 4, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [encrypted], ownUserId: me, now: now)
        XCTAssertNil(snapshot.reply)
        XCTAssertEqual(snapshot.latestTs, 1)
    }
}
