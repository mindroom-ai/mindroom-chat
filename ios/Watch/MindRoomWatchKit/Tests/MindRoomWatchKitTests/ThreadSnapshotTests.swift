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
        let echoEdit = event("$echoEdit", 3, sender: "@mindroom_router:x", ["m.new_content": ["body": "🎤 Remind me to call the dentist",
            "com.mindroom.visible_router_voice_echo": true] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$echo"] as JSON])
        let reply = event("$reply", 4, inThread(["msgtype": "m.text", "body": "…"]))
        let replyEdit = event("$replyEdit", 5, ["m.new_content": ["body": "🔧 `scheduler` [1]\nReminder set for **Saturday**.",
            "io.mindroom.ai_run": ["version": 1, "status": "completed"]] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [echo, echoEdit, reply, replyEdit], ownUserId: me, now: now,
                                            trustedAccounts: ["@mindroom_router:x"])
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
                                            ownUserId: me, now: now, trustedAccounts: ["@mindroom_router:x"])
        // Without the router's echo, relay and title, and without the card that waits for someone else.
        XCTAssertEqual(ids(snapshot), ["$root", "$answer", "$mine", "$card"])
        guard case let .message(first) = snapshot.entries[0], case let .message(second) = snapshot.entries[1],
              case let .approval(waiting) = snapshot.entries[3] else { return XCTFail("\(snapshot.entries)") }
        // The person's voice message reads as what they said, and still plays.
        XCTAssertEqual(first, ThreadSnapshot.Message(eventId: "$root", sender: me, isOwn: true, text: "🎤 Book a table",
                                                     audio: first.audio, tools: 0, run: .none))
        XCTAssertEqual(source(first)?["url"] as? String, "mxc://x/take")
        XCTAssertEqual(second, ThreadSnapshot.Message(eventId: "$answer", sender: agent, isOwn: false, text: "For when?",
                                                      audio: nil, tools: 1, run: .none, toolNames: ["tables"]))
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
        // Text is not a voice message.
        let text = ThreadSnapshot.build(root: voiceRoot, related: [event("$t", 4, inThread(["msgtype": "m.text", "body": "Hi"]))],
                                        ownUserId: me, now: now)
        XCTAssertEqual(text.reply?.isVoiceOnly, false)
        XCTAssertNil(text.reply?.audio)
        // Audio the router wrote out has words to show, and still plays.
        let echo = event("$echo", 5, sender: "@mindroom_router:x", ["msgtype": "m.text", "body": "🎤 The table is booked",
            "com.mindroom.visible_router_voice_echo": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$spoken"]] as JSON])
        let written = ThreadSnapshot.build(root: voiceRoot, related: [spoken, echo], ownUserId: me, now: now,
                                           trustedAccounts: ["@mindroom_router:x"]).reply
        XCTAssertEqual(written?.text, "🎤 The table is booked")
        XCTAssertEqual(written?.isVoiceOnly, false)
        XCTAssertEqual(source(written)?["url"] as? String, "mxc://x/answer")
    }

    func testAnAudioMessagesCaptionIsItsNewestOne() {
        let plain: JSON = ["msgtype": "m.audio", "body": "voice-message.opus", "url": "mxc://x/answer"]
        let captioned: JSON = ["msgtype": "m.audio", "body": "The address", "filename": "voice-message.opus", "url": "mxc://x/answer"]
        let edit = { (content: JSON) in event("$edit", 5, ["m.new_content": content,
                                                           "m.relates_to": ["rel_type": "m.replace", "event_id": "$spoken"] as JSON]) }
        let text = { (original: JSON, related: [JSON]) in
            ThreadSnapshot.build(root: voiceRoot, related: [event("$spoken", 4, inThread(original))] + related, ownUserId: me, now: self.now).reply?.text
        }
        XCTAssertEqual(text(captioned, []), "The address")
        // A caption added later shows, and one taken away leaves no file name behind.
        XCTAssertEqual(text(plain, [edit(captioned)]), "The address")
        XCTAssertEqual(text(captioned, [edit(plain)]), "")
    }

    func testAnEditReplacesAnAudioMessageWhole() {
        let spoken = event("$spoken", 4, inThread(["msgtype": "m.audio", "body": "voice-message.opus", "url": "mxc://x/answer"]))
        let edit = { (content: JSON) in event("$edit", 5, ["m.new_content": content,
                                                           "m.relates_to": ["rel_type": "m.replace", "event_id": "$spoken"] as JSON]) }
        // Taken back in words: text, with nothing to play.
        let corrected = ThreadSnapshot.build(root: voiceRoot, related: [spoken, edit(["msgtype": "m.text", "body": "Wrong recording, ignore it"])],
                                             ownUserId: me, now: now).reply
        XCTAssertEqual(corrected?.text, "Wrong recording, ignore it")
        XCTAssertNil(corrected?.audio)
        // Recorded again: the new file plays.
        let again = ThreadSnapshot.build(root: voiceRoot, related: [spoken, edit(["msgtype": "m.audio", "body": "voice-message.opus", "url": "mxc://x/second"])],
                                         ownUserId: me, now: now).reply
        XCTAssertEqual(source(again)?["url"] as? String, "mxc://x/second")
        XCTAssertEqual(again?.isVoiceOnly, true)
        // The same for the message that starts the thread, which names it.
        let root = event("$root", 1, ["msgtype": "m.audio", "body": "voice-message.opus", "url": "mxc://x/answer"])
        let retitled = event("$rootEdit", 2, ["m.new_content": ["msgtype": "m.text", "body": "Call me back"] as JSON,
                                              "m.relates_to": ["rel_type": "m.replace", "event_id": "$root"] as JSON])
        XCTAssertEqual(ThreadSnapshot.build(root: root, related: [retitled], ownUserId: me, now: now).title, "Call me back")
    }

    func testTheHeadingIsATitleTheFirstMessageDoesNotGive() {
        let root = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "Book a table"])
        let summary = event("$sum", 6, sender: "@mindroom_router:x", inThread(["msgtype": "m.notice", "body": "Dinner",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Dinner"] as JSON]))
        // The first message names the thread, in text or as a voice message: no heading repeats it.
        XCTAssertNil(ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now).heading)
        let spoken = event("$root", 1, sender: me, ["msgtype": "m.audio", "body": "voice-message.m4a", "url": "mxc://x/take",
                                                    "org.matrix.msc3245.voice": [:] as JSON])
        XCTAssertNil(ThreadSnapshot.build(root: spoken, related: [], ownUserId: me, now: now).heading)
        // The router's title is one, and so is what stands for a root that cannot be read and is no entry.
        XCTAssertEqual(ThreadSnapshot.build(root: root, related: [summary], ownUserId: me, now: now).heading, "Dinner")
        let locked = event("$root", 1, sender: me, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        XCTAssertEqual(ThreadSnapshot.build(root: locked, related: [], ownUserId: me, now: now).heading, "Encrypted message")
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
        let first = event("$root", 1, sender: me, ["msgtype": "m.audio", "body": "voice-message.m4a", "url": "mxc://x/take",
                                                   "org.matrix.msc3245.voice": [:] as JSON])
        let snapshot = ThreadSnapshot.build(root: first, related: [again, echo], ownUserId: me, now: now,
                                            trustedAccounts: ["@mindroom_router:x"])
        guard case let .message(root) = snapshot.entries[0], case let .message(reply) = snapshot.entries[1] else {
            return XCTFail("\(snapshot.entries)")
        }
        // Not yet written out: a voice message, to play.
        XCTAssertEqual(root.text, "")
        XCTAssertTrue(root.isVoiceOnly)
        XCTAssertEqual(reply.text, "🎤 And for two")
        XCTAssertFalse(reply.isVoiceOnly)
        XCTAssertEqual(snapshot.title, "Voice message")
    }

    func testTheThreadOpensAtWhatWaitsElseAtTheNewestAnswer() {
        let answer = event("$answer", 4, inThread(["msgtype": "m.text", "body": "Booked."]))
        let mine = event("$mine", 5, sender: me, inThread(["msgtype": "m.text", "body": "Thanks"]))
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [], ownUserId: me, now: now).focusId, "$root")
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, mine], ownUserId: me, now: now).focusId, "$answer")
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, question("$q", 6)], ownUserId: me, now: now).focusId, "$q")
        XCTAssertEqual(ThreadSnapshot.build(root: voiceRoot, related: [answer, question("$q", 6), card("$card", 7)], ownUserId: me, now: now).focusId, "$card")
        // The question still comes before the newest answer when someone else wrote after it.
        let annas = event("$annas", 7, sender: "@anna:x", inThread(["msgtype": "m.text", "body": "Any of them"]))
        let asked = ThreadSnapshot.build(root: voiceRoot, related: [question("$q", 6), annas], ownUserId: me, now: now)
        XCTAssertEqual(asked.reply?.eventId, "$annas")
        XCTAssertEqual(asked.focusId, "$q")
    }

    /// MindRoom sends an agent's reply without the marker line of each tool call, and with the number of
    /// lines before that line on the call instead (`body_line`, tool trace version 3).
    func testAReplyCountsItsToolsWithTheirMarkersInItsTextOrOutOfIt() {
        let calls: [JSON] = [["type": "tool_call_completed", "tool_name": "read_file"],
                             ["type": "tool_call_started", "tool_name": "shell"]]
        let placed = calls.map { $0.merging(["body_line": 2, "at": 1]) { _, new in new } }
        // The same reply as MindRoom builds it and as Matrix holds it.
        let built: JSON = ["msgtype": "m.text", "body": "Let me check.\n\n🔧 `read_file` [1]\n\n🔧 `shell` [2] ⏳\n\nReading done.",
                           "io.mindroom.tool_trace": ["version": 2, "events": calls] as JSON]
        let held: JSON = ["msgtype": "m.text", "body": "Let me check.\n\nReading done.",
                          "io.mindroom.tool_trace": ["version": 3, "events": placed] as JSON]
        let reply = { (sender: String, content: JSON, edit: JSON?) -> ThreadSnapshot.Message? in
            let first = event("$reply", 2, sender: sender, inThread(content))
            let edits = edit.map { [event("$edit", 3, sender: sender, ["m.new_content": $0,
                "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])] } ?? []
            return ThreadSnapshot.build(root: voiceRoot, related: [first] + edits, ownUserId: me, now: self.now).reply
        }
        let asBuilt = reply(agent, built, nil)
        XCTAssertEqual(asBuilt?.tools, 2)
        XCTAssertEqual(asBuilt?.text, "Let me check.\n\nReading done.")
        for asHeld in [reply(agent, held, nil), reply(agent, ["msgtype": "m.text", "body": "…"], held)] {
            XCTAssertEqual(asHeld?.tools, asBuilt?.tools)
            XCTAssertEqual(asHeld?.text, asBuilt?.text)
        }
        // A reply of calls alone has no text left.
        let callsAlone = reply(agent, ["msgtype": "m.text", "body": "", "io.mindroom.tool_trace": [
            "version": 3, "events": calls.map { $0.merging(["body_line": 0, "at": 0]) { _, new in new } }] as JSON], nil)
        XCTAssertEqual(callsAlone?.tools, 2)
        XCTAssertEqual(callsAlone?.text, "")
        // A call that had no marker has no line, and counts no more than it did.
        let hidden = reply(agent, ["msgtype": "m.text", "body": "Done.", "io.mindroom.tool_trace": [
            "version": 3, "events": [placed[0], calls[1], ["body_line": 0] as JSON, ["tool_name": "shell", "body_line": "1"] as JSON]] as JSON], nil)
        XCTAssertEqual(hidden?.tools, 1)
        // A version-2 trace counts nothing: its calls are the lines of its text.
        XCTAssertEqual(reply(agent, ["msgtype": "m.text", "body": "Done.", "io.mindroom.tool_trace": [
            "version": 2, "events": placed] as JSON], nil)?.tools, 0)
        // An agent of another homeserver counts the same in its text or out of it: a count trusts nothing.
        let elsewhere = "@mindroom_mind:elsewhere.example"
        XCTAssertEqual(reply(elsewhere, built, nil)?.tools, 2)
        for asHeld in [reply(elsewhere, held, nil), reply(elsewhere, ["msgtype": "m.text", "body": "…"], held)] {
            XCTAssertEqual(asHeld?.tools, 2)
            XCTAssertEqual(asHeld?.text, asBuilt?.text)
        }
        // A person has no tool trace.
        XCTAssertEqual(reply("@anna:x", held, nil)?.tools, 0)
    }

    func testUndecryptableEventsAreSkipped() {
        let encrypted = event("$enc", 4, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [encrypted], ownUserId: me, now: now)
        XCTAssertNil(snapshot.reply)
        XCTAssertEqual(snapshot.latestTs, 1)
    }

    func testUntrustedVoiceEchoDoesNotFoldOrHide() {
        let forged = event("$forged", 2, sender: "@mallory:x", [
            "msgtype": "m.text",
            "body": "🎤 Forged transcript",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$root"]] as JSON,
        ])
        // Default empty trusted set fails closed.
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [forged], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.title, "Voice message")
        XCTAssertEqual(ids(snapshot), ["$root", "$forged"])
        XCTAssertEqual(snapshot.reply?.eventId, "$forged")
        XCTAssertEqual(snapshot.reply?.text, "🎤 Forged transcript")
        // Also ignored when another account is trusted.
        let withOtherTrusted = ThreadSnapshot.build(root: voiceRoot, related: [forged], ownUserId: me, now: now,
                                                    trustedAccounts: ["@mindroom_router:x", agent])
        XCTAssertEqual(withOtherTrusted.title, "Voice message")
        XCTAssertEqual(ids(withOtherTrusted), ["$root", "$forged"])
    }

    func testTrustedRosterAgentVoiceEchoFoldsAndHides() {
        let echo = event("$echo", 2, sender: agent, [
            "msgtype": "m.text",
            "body": "🎤 Book a flight",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
        ])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [echo], ownUserId: me, now: now,
                                            trustedAccounts: ["@mindroom_router:x", agent])
        XCTAssertEqual(snapshot.title, "🎤 Book a flight")
        XCTAssertEqual(ids(snapshot), ["$root"])
        XCTAssertNil(snapshot.reply)
    }

    func testRawAudioFallbackEchoStaysVisibleEvenFromTrustedSender() {
        let fallback = event("$fallback", 2, sender: agent, [
            "msgtype": "m.text",
            "body": "🎤 [Attached voice message]",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "com.mindroom.voice_raw_audio_fallback": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
        ])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [fallback], ownUserId: me, now: now,
                                            trustedAccounts: [agent])
        XCTAssertEqual(snapshot.title, "Voice message")
        XCTAssertEqual(ids(snapshot), ["$root", "$fallback"])
        // Same when a placeholder is edited into a raw-audio fallback.
        let placeholder = event("$p", 2, sender: agent, [
            "msgtype": "m.text",
            "body": "Router agent is transcribing…",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
        ])
        let editedFallback = event("$pEdit", 3, sender: agent, [
            "m.new_content": [
                "msgtype": "m.text",
                "body": "🎤 [Attached voice message]",
                "com.mindroom.visible_router_voice_echo": true,
                "com.mindroom.voice_source_event_id": "$root",
                "com.mindroom.voice_raw_audio_fallback": true,
            ] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$p"] as JSON,
        ])
        let editedSnapshot = ThreadSnapshot.build(root: voiceRoot, related: [placeholder, editedFallback], ownUserId: me, now: now,
                                                  trustedAccounts: [agent])
        XCTAssertEqual(editedSnapshot.title, "Voice message")
        XCTAssertEqual(ids(editedSnapshot), ["$root", "$p"])
    }

    func testTrustedEchoStaysVisibleWhenSourceIsNotRenderedAsAudio() {
        let makeEcho = { (id: String, target: String, body: String) in
            event(id, 5, sender: agent, [
                "msgtype": "m.text",
                "body": body,
                "com.mindroom.visible_router_voice_echo": true,
                "com.mindroom.voice_source_event_id": target,
                "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
            ])
        }
        // Source missing from the thread.
        let missing = ThreadSnapshot.build(root: voiceRoot, related: [makeEcho("$e1", "$missing", "🎤 Orphan")],
                                           ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(missing), ["$root", "$e1"])
        XCTAssertEqual(missing.reply?.text, "🎤 Orphan")

        // Source is an undecryptable reply.
        let encryptedReply = event("$locked", 2, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        let onEncryptedReply = ThreadSnapshot.build(root: voiceRoot, related: [encryptedReply, makeEcho("$e2", "$locked", "🎤 Locked")],
                                                    ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(onEncryptedReply), ["$root", "$e2"])

        // Source is an undecryptable root.
        let encryptedRoot = event("$root", 1, sender: me, type: "m.room.encrypted", ["algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "x"])
        let onEncryptedRoot = ThreadSnapshot.build(root: encryptedRoot, related: [makeEcho("$e3", "$root", "🎤 Root locked")],
                                                   ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(onEncryptedRoot.title, "Encrypted message")
        XCTAssertEqual(ids(onEncryptedRoot), ["$e3"])

        // Source was redacted (empty content, no msgtype).
        let redacted = event("$redacted", 2, sender: me, [:])
        let onRedacted = ThreadSnapshot.build(root: voiceRoot, related: [redacted, makeEcho("$e4", "$redacted", "🎤 Redacted")],
                                              ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(onRedacted), ["$root", "$redacted", "$e4"])

        // Source is a plain text message, not audio.
        let textMsg = event("$txt", 2, sender: me, inThread(["msgtype": "m.text", "body": "Hello"]))
        let onText = ThreadSnapshot.build(root: voiceRoot, related: [textMsg, makeEcho("$e5", "$txt", "🎤 Not audio")],
                                          ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(onText), ["$root", "$txt", "$e5"])
    }

    func testOnlyFirstTrustedEchoForSameVoiceMessageFoldsAndHides() {
        let echo1 = event("$first", 2, sender: agent, [
            "msgtype": "m.text",
            "body": "🎤 First transcript",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
        ])
        let echo2 = event("$second", 3, sender: agent, [
            "msgtype": "m.text",
            "body": "🎤 Second transcript",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
        ])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [echo1, echo2], ownUserId: me, now: now,
                                            trustedAccounts: [agent])
        XCTAssertEqual(snapshot.title, "🎤 First transcript")
        XCTAssertEqual(ids(snapshot), ["$root", "$second"])
        XCTAssertEqual(snapshot.reply?.eventId, "$second")

        // A paired legacy placeholder also claims the voice message, so a second echo stays visible.
        let placeholder = event("$p", 2, sender: agent, [
            "msgtype": "m.text",
            "body": "Router agent is transcribing…",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$root",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root"] as JSON,
        ])
        let withPlaceholder = ThreadSnapshot.build(root: voiceRoot, related: [placeholder, echo2], ownUserId: me, now: now,
                                                   trustedAccounts: [agent])
        XCTAssertEqual(withPlaceholder.title, "Voice message")
        XCTAssertEqual(ids(withPlaceholder), ["$root", "$second"])
    }

    private func echo(_ id: String, _ ts: Int, of voiceId: String, _ body: String, extra: JSON = [:]) -> JSON {
        event(id, ts, inThread(["msgtype": "m.text", "body": body, "com.mindroom.visible_router_voice_echo": true,
                                "com.mindroom.voice_source_event_id": voiceId].merging(extra) { $1 }))
    }

    func testATrustedEchoOfAnAudioFileThatIsNoVoiceMessageKeepsItsRow() {
        // An audio file (music, a recording somebody attached) has no voice mark: the web client folds nothing under it.
        let song = event("$song", 2, sender: me, inThread(["msgtype": "m.audio", "body": "song.mp3", "url": "mxc://x/song"]))
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [song, echo("$echo", 3, of: "$song", "🎤 Not its words")],
                                            ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(snapshot), ["$root", "$song", "$echo"])
        guard case let .message(shown) = snapshot.entries[1] else { return XCTFail("\(snapshot.entries)") }
        XCTAssertEqual(shown.text, "")
        // The stable mark counts as the unstable one does.
        let voice = event("$voice", 2, sender: me, inThread(["msgtype": "m.audio", "body": "voice.m4a", "url": "mxc://x/v", "m.voice": [:] as JSON]))
        XCTAssertEqual(ids(ThreadSnapshot.build(root: voiceRoot, related: [voice, echo("$echo", 3, of: "$voice", "🎤 Its words")],
                                                ownUserId: me, now: now, trustedAccounts: [agent])), ["$root", "$voice"])
        // A voice message edited into an audio file is one no more.
        let unmarked = event("$unmark", 3, sender: me, ["m.new_content": ["msgtype": "m.audio", "body": "song.mp3", "url": "mxc://x/song"] as JSON,
                                                         "m.relates_to": ["rel_type": "m.replace", "event_id": "$voice"] as JSON])
        XCTAssertEqual(ids(ThreadSnapshot.build(root: voiceRoot, related: [voice, unmarked, echo("$echo", 4, of: "$voice", "🎤 Its words")],
                                                ownUserId: me, now: now, trustedAccounts: [agent])), ["$root", "$voice", "$echo"])
    }

    func testAnEchoThatIsOnlyAPreviewOfALongTextKeepsItsRow() {
        let preview = echo("$preview", 2, of: "$root", "🎤 The first words…", extra: ["io.mindroom.long_text": ["version": 2] as JSON])
        let alone = ThreadSnapshot.build(root: voiceRoot, related: [preview], ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(alone.title, "Voice message")
        XCTAssertEqual(ids(alone), ["$root", "$preview"])
        // It does not take the voice message from an echo with all of the text.
        let whole = ThreadSnapshot.build(root: voiceRoot, related: [preview, echo("$whole", 3, of: "$root", "🎤 Every word")],
                                         ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(whole.title, "🎤 Every word")
        XCTAssertEqual(ids(whole), ["$root", "$preview"])
    }

    func testAnEchoEditedIntoAnOrdinaryMessageKeepsItsRow() {
        let edited = { (newContent: JSON) in
            event("$edit", 3, ["m.new_content": newContent, "m.relates_to": ["rel_type": "m.replace", "event_id": "$echo"] as JSON])
        }
        let first = echo("$echo", 2, of: "$root", "🎤 Book a flight")
        // The newest version is no echo (the flag left out, or false): its text is the agent's, not the speaker's.
        for flag in [nil, false] as [Bool?] {
            var content: JSON = ["msgtype": "m.text", "body": "I never said that", "com.mindroom.voice_source_event_id": "$root"]
            content["com.mindroom.visible_router_voice_echo"] = flag
            let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [first, edited(content)], ownUserId: me, now: now,
                                                trustedAccounts: [agent])
            XCTAssertEqual(snapshot.title, "Voice message")
            XCTAssertEqual(ids(snapshot), ["$root", "$echo"])
            XCTAssertEqual(snapshot.reply?.text, "I never said that")
        }
        // The newest version names the voice message: an edit can move the echo to another one.
        let again = event("$again", 2, sender: me, inThread(["msgtype": "m.audio", "body": "voice-2.m4a", "url": "mxc://x/again",
                                                             "org.matrix.msc3245.voice": [:] as JSON]))
        let moved = ThreadSnapshot.build(root: voiceRoot, related: [again, first, edited([
            "msgtype": "m.text", "body": "🎤 And for two", "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$again",
        ])], ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(moved.title, "Voice message")
        XCTAssertEqual(ids(moved), ["$root", "$again"])
        guard case let .message(shown) = moved.entries[1] else { return XCTFail("\(moved.entries)") }
        XCTAssertEqual(shown.text, "🎤 And for two")
    }

    func testAPushedQuestionKeepsItsButtonsAfterATrustedEchoOfSomeoneElsesRecording() {
        // Anna spoke after the agent asked, and her recording was written out by an agent of the room.
        let annas = event("$annas", 4, sender: "@anna:x", inThread(["msgtype": "m.audio", "body": "voice.m4a", "url": "mxc://x/anna",
                                                                    "org.matrix.msc3245.voice": [:] as JSON]))
        let related = [question("$q", 3), annas, echo("$echo", 5, of: "$annas", "🎤 Take the early one")]
        // A notification reads the thread with the room's trust, as the thread screen does: the same events and
        // trust give the same answer buttons.
        let trusted = ThreadSnapshot.build(root: voiceRoot, related: related, ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(trusted), ["$root", "$q", "$annas"])
        XCTAssertEqual(trusted.openQuestion?.eventId, "$q")
        guard case let .question(asked) = trusted.pushed(eventId: "$q") else { return XCTFail("\(trusted.pushed(eventId: "$q"))") }
        XCTAssertEqual(asked.options.map(\.key), ["🌙", "✈️"])
        // With no trust read yet nothing is hidden: the echo is the newest agent reply, and it asks nothing.
        let untrusted = ThreadSnapshot.build(root: voiceRoot, related: related, ownUserId: me, now: now)
        XCTAssertEqual(ids(untrusted), ["$root", "$q", "$annas", "$echo"])
        XCTAssertEqual(untrusted.pushed(eventId: "$q"), .message)
    }

    func testARedactedVoiceMessageTakesNoTranscriptEvenWithAnEditOfItLeft() {
        // An edit sent before the redaction can still be read, with the audio and the voice mark.
        let left = event("$rootEdit", 2, sender: me, [
            "m.new_content": ["msgtype": "m.audio", "body": "voice.m4a", "url": "mxc://x/take", "org.matrix.msc3245.voice": [:] as JSON] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$root"] as JSON,
        ])
        // A redaction leaves a message no content; the server also marks the event.
        var marked = event("$root", 1, sender: me, [:])
        marked["unsigned"] = ["redacted_because": ["type": "m.room.redaction"] as JSON] as JSON
        for redacted in [marked, event("$root", 1, sender: me, [:])] {
            let snapshot = ThreadSnapshot.build(root: redacted, related: [left, echo("$echo", 3, of: "$root", "🎤 Deleted words")],
                                                ownUserId: me, now: now, trustedAccounts: [agent])
            XCTAssertEqual(snapshot.title, "Voice message")
            XCTAssertEqual(ids(snapshot), ["$root", "$echo"])
        }
    }

    func testTheEventsKeptForAnotherTrustBuildTheSameThread() throws {
        let replace = { (id: String) in ["rel_type": "m.replace", "event_id": id] as JSON }
        // A reply streams in edits, each with all of the text so far: only the newest is read.
        let reply = event("$reply", 4, inThread(["msgtype": "m.text", "body": "…", "io.mindroom.stream_status": "streaming"]))
        let parts = (1...3).map { part in
            event("$part\(part)", 4 + part, ["m.new_content": ["msgtype": "m.text", "body": "Part \(part)"] as JSON, "m.relates_to": replace("$reply")])
        }
        let foreign = event("$foreign", 9, sender: "@mallory:x", ["m.new_content": ["body": "Not mine to edit"] as JSON, "m.relates_to": replace("$reply")])
        let locked = event("$locked", 10, type: "m.room.encrypted", ["ciphertext": "x", "m.relates_to": replace("$reply")])
        let placeholder = echo("$echo", 2, of: "$root", VoiceEcho.placeholder)
        let written = event("$written", 3, ["m.new_content": ["msgtype": "m.text", "body": "🎤 Book a flight",
            "com.mindroom.visible_router_voice_echo": true, "com.mindroom.voice_source_event_id": "$root"] as JSON, "m.relates_to": replace("$echo")])
        // A card reads every edit of it.
        let cardEdits = ["denied", "approved"].enumerated().map { index, status in
            event("$card\(index)", 12 + index, sender: "@mindroom_router:x", type: "io.mindroom.tool_approval",
                  ["m.new_content": ["status": status] as JSON, "m.relates_to": replace("$card")])
        }
        let reaction = event("$reaction", 14, sender: me, type: "m.reaction", ["m.relates_to": ["rel_type": "m.annotation", "event_id": "$reply", "key": "👍"] as JSON])
        let related = [placeholder, written, reply] + parts + [foreign, locked, card("$card", 11)] + cardEdits + [reaction]
        let kept = try XCTUnwrap(ThreadSnapshot.kept((voiceRoot, related)))
        XCTAssertEqual(kept.related.compactMap { $0["event_id"] as? String }.sorted(),
                       ["$card", "$card0", "$card1", "$echo", "$part3", "$reaction", "$reply", "$written"])
        for trusted in [[], [agent]] as [Set<String>] {
            let whole = ThreadSnapshot.build(root: voiceRoot, related: related, ownUserId: me, now: now, trustedAccounts: trusted)
            XCTAssertEqual(ThreadSnapshot.build(root: kept.root, related: kept.related, ownUserId: me, now: now, trustedAccounts: trusted), whole)
            XCTAssertEqual(whole.reply?.text, "Part 3")
            XCTAssertEqual(whole.approvals.first?.status, .approved)
        }
        // No trust changes a thread without a message marked as a voice echo: nothing is kept of it.
        XCTAssertNil(ThreadSnapshot.kept((voiceRoot, [reply] + parts + [card("$card", 11)] + cardEdits)))
    }

    /// The thread from all of its events, and from what is kept of them for another trust.
    private func wholeAndKept(_ related: [JSON], file: StaticString = #filePath, line: UInt = #line) throws -> [ThreadSnapshot] {
        let kept = try XCTUnwrap(ThreadSnapshot.kept((voiceRoot, related)), file: file, line: line)
        return [(voiceRoot, related), kept].map {
            ThreadSnapshot.build(root: $0.root, related: $0.related, ownUserId: me, now: now, trustedAccounts: [agent])
        }
    }

    func testAnEchoTakesWhatItsNewestEditLeavesOutFromTheSendersOlderEdits() throws {
        let fallback = "com.mindroom.voice_raw_audio_fallback", source = "com.mindroom.voice_source_event_id"
        let flagged: JSON = ["msgtype": "m.text", "body": "🎤 [Attached voice message]", "com.mindroom.visible_router_voice_echo": true]
        let edit = { (id: String, ts: Int, extra: JSON) in
            event(id, ts, ["m.new_content": flagged.merging(extra) { $1 }, "m.relates_to": ["rel_type": "m.replace", "event_id": "$echo"] as JSON])
        }
        let first = echo("$echo", 3, of: "$root", VoiceEcho.placeholder)
        // As the web client's `getEditedEvent`: an edit says transcription failed, and the next one repeats the
        // flag and the voice message but not that. It is still the fallback, a row of its own.
        let failed = [first, edit("$failed", 4, [source: "$root", fallback: true]), edit("$later", 5, [source: "$root"])]
        for snapshot in try wholeAndKept(failed) {
            XCTAssertEqual(snapshot.title, "Voice message")
            XCTAssertEqual(ids(snapshot), ["$root", "$echo"])
        }
        // What is kept is the edit shown with what it took from the older ones, not every edit.
        XCTAssertEqual(try XCTUnwrap(ThreadSnapshot.kept((voiceRoot, failed))).related.count, 2)
        // What the newest edit says itself wins.
        for snapshot in try wholeAndKept([first, edit("$failed", 4, [source: "$root", fallback: true]), edit("$later", 5, [source: "$root", fallback: false])]) {
            XCTAssertEqual(ids(snapshot), ["$root"])
        }
        // The voice message an older edit names stands when the newest names none.
        let again = event("$again", 2, sender: me, inThread(["msgtype": "m.audio", "body": "voice-2.m4a", "url": "mxc://x/again",
                                                             "org.matrix.msc3245.voice": [:] as JSON]))
        for snapshot in try wholeAndKept([again, first, edit("$moved", 4, [source: "$again"]), edit("$later", 5, [:])]) {
            XCTAssertEqual(ids(snapshot), ["$root", "$again"])
            XCTAssertEqual(snapshot.title, "Voice message")
        }
    }

    func testEditsOfTheSameMillisecondCountByTheGreaterEventId() throws {
        // As the web client's `isEventOrderedAfter`, in whatever order the server gives them.
        let reply = event("$reply", 4, inThread(["msgtype": "m.text", "body": "…"]))
        let edits = ["$a", "$b"].map { id in
            event(id, 5, ["m.new_content": ["msgtype": "m.text", "body": "From \(id)"] as JSON, "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON])
        }
        for edits in [edits, edits.reversed()] {
            for snapshot in try wholeAndKept([echo("$echo", 2, of: "$root", "🎤 Hi"), reply] + edits) {
                XCTAssertEqual(snapshot.reply?.text, "From $b")
            }
        }
    }

    func testACardPastItsDeadlineIsNotOfferedFromASnapshotReadBefore() {
        let expiring = card("$card", 3, sender: agent, extra: ["expires_at": "1970-01-01T00:20:00Z"])
        let read = ThreadSnapshot.build(root: voiceRoot, related: [expiring], ownUserId: me, now: now)
        XCTAssertEqual(read.pendingApproval?.eventId, "$card")
        XCTAssertEqual(read.at(now.addingTimeInterval(199)), read)
        // The thread opens from the snapshot the list read, after the deadline and with no network: as the
        // thread read at that time would say, the card is expired and nothing waits for the person.
        let late = read.at(now.addingTimeInterval(200))
        XCTAssertNil(late.pendingApproval)
        XCTAssertEqual(late.approvals.map(\.status), [.expired])
        XCTAssertNotEqual(late.rowState, .needsYou)
        XCTAssertEqual(late, ThreadSnapshot.build(root: voiceRoot, related: [expiring], ownUserId: me, now: now.addingTimeInterval(200)))
    }

    func testACardPastItsDeadlineLeavesAnOlderOneThatWaitsToDecide() {
        let related = [card("$older", 3, sender: agent),
                       card("$newer", 4, sender: agent, extra: ["expires_at": "1970-01-01T00:20:00Z"]),
                       card("$annas", 5, sender: agent, extra: ["approver_user_id": "@anna:x"])]
        let read = ThreadSnapshot.build(root: voiceRoot, related: related, ownUserId: me, now: now)
        XCTAssertEqual(read.pendingApproval?.eventId, "$newer")
        XCTAssertEqual(ids(read), ["$root", "$newer"])
        // After the newer card's deadline and with no network, the snapshot read before says what the thread
        // read at that time would: the older card is the one to decide, in its place among the entries.
        let late = read.at(now.addingTimeInterval(200))
        XCTAssertEqual(late.pendingApproval?.eventId, "$older")
        XCTAssertEqual(ids(late), ["$root", "$older", "$newer"])
        XCTAssertEqual(late.rowState, .needsYou)
        XCTAssertEqual(late, ThreadSnapshot.build(root: voiceRoot, related: related, ownUserId: me, now: now.addingTimeInterval(200)))
        // A clock set back: again as the thread read at that time.
        XCTAssertEqual(late.at(now), read)
    }

    func testAnApprovalCardIsNeverAVoiceEcho() {
        // A card with an echo's marks stays a card: what a notification shows of it without the room's trust
        // is what the thread shows with it.
        let marked = card("$card", 3, sender: agent, extra: ["com.mindroom.visible_router_voice_echo": true,
                                                             "com.mindroom.voice_source_event_id": "$root"])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [marked], ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(snapshot.pendingApproval?.eventId, "$card")
        XCTAssertEqual(snapshot.title, "Voice message")
        XCTAssertNil(ThreadSnapshot.kept((voiceRoot, [marked])))
    }

    func testAVoiceMessageWhoseShownVersionNamesNoKindTakesNoTranscript() {
        // As the web client: the version shown is audio by its own `msgtype`, not by the first version's.
        let voice = event("$voice", 2, sender: me, inThread(["msgtype": "m.audio", "body": "voice.m4a", "url": "mxc://x/v",
                                                             "org.matrix.msc3245.voice": [:] as JSON]))
        let unnamed = event("$voiceEdit", 3, sender: me, [
            "m.new_content": ["body": "voice.m4a", "url": "mxc://x/v", "org.matrix.msc3245.voice": [:] as JSON] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$voice"] as JSON,
        ])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [voice, unnamed, echo("$echo", 4, of: "$voice", "🎤 Its words")],
                                            ownUserId: me, now: now, trustedAccounts: [agent])
        XCTAssertEqual(ids(snapshot), ["$root", "$voice", "$echo"])
    }

    func testWorkFoldDetailsForV2MarkdownFinishedVsStreamingAndNoPreProse() {
        let finishedBody = "Looking up flights.\n🔧 `flights_search` [1]\nFound **2 options**."
        let finished = event("$r1", 10_000, inThread(["msgtype": "m.text", "body": finishedBody]))
        let finSnap = ThreadSnapshot.build(root: voiceRoot, related: [finished], ownUserId: me, now: now)
        XCTAssertEqual(finSnap.reply?.toolNames, ["flights_search"])
        XCTAssertEqual(finSnap.reply?.tools, 1)
        XCTAssertEqual(finSnap.reply?.workText, "Looking up flights.")
        XCTAssertEqual(finSnap.reply?.answerText, "Found 2 options.")
        XCTAssertNil(finSnap.reply?.durationSeconds)

        // Streaming reply keeps workText nil and renders full answerText.
        let streaming = event("$r2", 10_000, inThread([
            "msgtype": "m.text",
            "body": finishedBody,
            "io.mindroom.stream_status": "streaming",
        ]))
        let streamSnap = ThreadSnapshot.build(root: voiceRoot, related: [streaming], ownUserId: me, now: now)
        XCTAssertEqual(streamSnap.reply?.toolNames, ["flights_search"])
        XCTAssertNil(streamSnap.reply?.workText)
        XCTAssertEqual(streamSnap.reply?.answerText, "Looking up flights.\nFound 2 options.")

        // No prose before tool call: workText stays nil even when finished.
        let noPre = event("$r3", 10_000, inThread(["msgtype": "m.text", "body": "🔧 `flights_search` [1]\nFound 2 options."]))
        let noPreSnap = ThreadSnapshot.build(root: voiceRoot, related: [noPre], ownUserId: me, now: now)
        XCTAssertEqual(noPreSnap.reply?.toolNames, ["flights_search"])
        XCTAssertNil(noPreSnap.reply?.workText)
        XCTAssertEqual(noPreSnap.reply?.answerText, "Found 2 options.")
    }

    func testV3ToolTraceExtractsToolNamesBodyLineSplitAndDuration() {
        let initial = event("$reply", 1_700_000_000_000, inThread([
            "msgtype": "m.text",
            "body": "Working…",
            "io.mindroom.stream_status": "streaming",
        ]))
        let finalEdit = event("$replyEdit", 1_700_000_014_500, [
            "m.new_content": [
                "msgtype": "m.text",
                "body": "Inspecting calendar.\n\nBooked your meeting for 3 PM.",
                "io.mindroom.stream_status": "completed",
                "io.mindroom.tool_trace": [
                    "version": 3,
                    "events": [
                        ["type": "tool_call_completed", "tool_name": "calendar_list", "body_line": 1] as JSON,
                        ["type": "tool_call_completed", "tool_name": "calendar_create", "body_line": 2] as JSON,
                    ],
                ] as JSON,
            ] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON,
        ])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [initial, finalEdit], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.reply?.tools, 2)
        XCTAssertEqual(snapshot.reply?.toolNames, ["calendar_list", "calendar_create"])
        XCTAssertEqual(snapshot.reply?.workText, "Inspecting calendar.")
        XCTAssertEqual(snapshot.reply?.answerText, "Booked your meeting for 3 PM.")
        XCTAssertEqual(snapshot.reply?.durationSeconds, 14)

        // Sub-second edit produces nil durationSeconds.
        let fastEdit = event("$fastEdit", 1_700_000_000_400, [
            "m.new_content": ["msgtype": "m.text", "body": "Done."] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$reply"] as JSON,
        ])
        let fastSnap = ThreadSnapshot.build(root: voiceRoot, related: [initial, fastEdit], ownUserId: me, now: now)
        XCTAssertNil(fastSnap.reply?.durationSeconds)
    }
}
