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
        // Text is not a voice message.
        let text = ThreadSnapshot.build(root: voiceRoot, related: [event("$t", 4, inThread(["msgtype": "m.text", "body": "Hi"]))],
                                        ownUserId: me, now: now)
        XCTAssertEqual(text.reply?.isVoiceOnly, false)
        XCTAssertNil(text.reply?.audio)
        // Audio the router wrote out has words to show, and still plays.
        let echo = event("$echo", 5, sender: "@mindroom_router:x", ["msgtype": "m.text", "body": "🎤 The table is booked",
            "com.mindroom.visible_router_voice_echo": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$spoken"]] as JSON])
        let written = ThreadSnapshot.build(root: voiceRoot, related: [spoken, echo], ownUserId: me, now: now).reply
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
        let snapshot = ThreadSnapshot.build(root: first, related: [again, echo], ownUserId: me, now: now)
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

    private func withBundledEdit(_ base: JSON, _ edit: JSON) -> JSON {
        var copy = base
        var unsigned = copy["unsigned"] as? JSON ?? [:]
        var relations = unsigned["m.relations"] as? JSON ?? [:]
        relations["m.replace"] = edit
        unsigned["m.relations"] = relations
        copy["unsigned"] = unsigned
        return copy
    }

    func testBundledEditUnfoldsIntoMessageAndApprovalCard() {
        let replyEdit = event("$e1", 5, sender: agent, [
            "msgtype": "m.text", "body": "* Final answer",
            "m.new_content": ["msgtype": "m.text", "body": "Final answer", "io.mindroom.stream_status": "completed"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$r1"] as JSON,
        ])
        let reply = withBundledEdit(
            event("$r1", 2, sender: agent, inThread(["msgtype": "m.text", "body": "Working…", "io.mindroom.stream_status": "streaming"])),
            replyEdit
        )
        let cardEdit = event("$ce1", 6, sender: "@mindroom_router:x", type: ApprovalCard.eventType, [
            "m.new_content": ["tool_name": "send_email", "status": "approved"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$c1"] as JSON,
        ])
        let approval = withBundledEdit(card("$c1", 3), cardEdit)

        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply, approval], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.reply?.text, "Final answer")
        XCTAssertEqual(snapshot.reply?.run, .finished)
        XCTAssertEqual(snapshot.latestTs, 6)
        XCTAssertNil(snapshot.pendingApproval)
        XCTAssertEqual(snapshot.approvals.first?.status, .approved)
    }

    func testWrongSenderOrWrongTargetBundledEditIsIgnored() {
        let wrongSenderEdit = event("$bad1", 10, sender: "@mallory:x", [
            "m.new_content": ["msgtype": "m.text", "body": "Hijacked"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$r1"] as JSON,
        ])
        let r1 = withBundledEdit(event("$r1", 2, sender: agent, inThread(["msgtype": "m.text", "body": "Original"])), wrongSenderEdit)

        let wrongTargetEdit = event("$bad2", 11, sender: agent, [
            "m.new_content": ["msgtype": "m.text", "body": "Wrong target"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$other"] as JSON,
        ])
        let r2 = withBundledEdit(event("$r2", 3, sender: agent, inThread(["msgtype": "m.text", "body": "Intact"])), wrongTargetEdit)

        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [r1, r2], ownUserId: me, now: now)
        let texts = snapshot.entries.compactMap { entry -> String? in
            if case let .message(m) = entry { return m.text }
            return nil
        }
        XCTAssertTrue(texts.contains("Original"))
        XCTAssertTrue(texts.contains("Intact"))
        XCTAssertFalse(texts.contains("Hijacked"))
        XCTAssertFalse(texts.contains("Wrong target"))
    }

    func testNewerUnbundledEditBeatsBundledEdit() {
        let bundled = event("$e1", 5, sender: agent, [
            "m.new_content": ["msgtype": "m.text", "body": "Bundled v1"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$r1"] as JSON,
        ])
        let reply = withBundledEdit(event("$r1", 2, sender: agent, inThread(["msgtype": "m.text", "body": "Initial"])), bundled)
        let unbundled = event("$e2", 8, sender: agent, [
            "m.new_content": ["msgtype": "m.text", "body": "Unbundled v2"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$r1"] as JSON,
        ])
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply, unbundled], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.reply?.text, "Unbundled v2")
        XCTAssertEqual(snapshot.latestTs, 8)
    }

    func testTitlePrecedenceAndNeverOverwritingKnownTitleWithRootText() {
        let root = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "Raw root message"])
        let windowSummary = event("$sum", 4, sender: "@mindroom_router:x", inThread([
            "msgtype": "m.notice", "body": "Window Summary",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Window Summary"] as JSON,
        ]))

        // 1. io.mindroom.title (serverTitle) wins over window summary and cache.
        let s1 = ThreadSnapshot.build(root: root, related: [windowSummary], ownUserId: me, now: now,
                                      serverTitle: KnownTitle(text: "Server Title", sourceEventId: "$st", kind: .summary), cachedTitle: KnownTitle(text: "Cached Title", sourceEventId: "$ct", kind: .summary))
        XCTAssertEqual(s1.title, "Server Title")
        XCTAssertEqual(s1.knownTitle?.text, "Server Title")

        // 2. Window summary wins over cache when serverTitle is nil.
        let s2 = ThreadSnapshot.build(root: root, related: [windowSummary], ownUserId: me, now: now,
                                      serverTitle: nil, cachedTitle: KnownTitle(text: "Cached Title", sourceEventId: "$ct", kind: .summary))
        XCTAssertEqual(s2.title, "Window Summary")
        XCTAssertEqual(s2.knownTitle?.text, "Window Summary")

        // 3. Cached title wins over root text when summary scrolled out of the window.
        let s3 = ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now,
                                      serverTitle: nil, cachedTitle: KnownTitle(text: "Cached Title", sourceEventId: "$ct", kind: .summary))
        XCTAssertEqual(s3.title, "Cached Title")
        XCTAssertNil(s3.knownTitle)

        // 4. Fallback to root text only when no serverTitle, summary, cache, or transcript exists.
        let s4 = ThreadSnapshot.build(root: root, related: [], ownUserId: me, now: now)
        XCTAssertEqual(s4.title, "Raw root message")
        XCTAssertNil(s4.knownTitle)
    }

    func testPendingApprovalCardOutsideRecentWindowIsDetectedAndDeduplicated() {
        // Older pending card merged from filtered approval page alongside 20 newer replies.
        let oldCard = card("$oldCard", 2)
        let recent = (10..<30).map { i in
            event("$m\(i)", i, sender: agent, inThread(["msgtype": "m.text", "body": "Reply \(i)"]))
        }
        // Pass oldCard twice to ensure merging pages deduplicates by event_id.
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: recent + [oldCard, oldCard], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.pendingApproval?.eventId, "$oldCard")
        XCTAssertEqual(snapshot.rowState, .needsYou)
        XCTAssertEqual(snapshot.approvals.count, 1)
    }

    func testThreadListEntryParsesServerPreviewsAndEditOnlyCacheKeyChanges() {
        let titleEdit = event("$te1", 12, sender: "@mindroom_router:x", [
            "m.new_content": ["msgtype": "m.notice", "body": "Renamed Thread",
                              "io.mindroom.thread_summary": ["version": 1, "summary": "Renamed Thread"] as JSON] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$t1"] as JSON,
        ])
        let titleEvent = withBundledEdit(event("$t1", 5, sender: "@mindroom_router:x", [
            "msgtype": "m.notice", "body": "Old Title",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Old Title"] as JSON,
        ]), titleEdit)

        let replyEdit1 = event("$re1", 20, sender: agent, [
            "m.new_content": ["msgtype": "m.text", "body": "Draft 1"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$r1"] as JSON,
        ])
        let replyEdit2 = event("$re2", 25, sender: agent, [
            "m.new_content": ["msgtype": "m.text", "body": "Final 2"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$r1"] as JSON,
        ])
        let reply1 = withBundledEdit(event("$r1", 15, sender: agent, ["msgtype": "m.text", "body": "Init"]), replyEdit1)
        let reply2 = withBundledEdit(event("$r1", 15, sender: agent, ["msgtype": "m.text", "body": "Init"]), replyEdit2)

        func makeRoot(reply: JSON) -> JSON {
            var r = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "Root body"])
            r["unsigned"] = ["m.relations": ["m.thread": [
                "count": 3,
                "latest_event": titleEvent,
                "io.mindroom.title": titleEvent,
                "io.mindroom.latest_reply": reply,
            ] as JSON] as JSON] as JSON
            return r
        }

        let entry1 = ThreadListEntry.parse(makeRoot(reply: reply1), ownUserId: me)
        let entry2 = ThreadListEntry.parse(makeRoot(reply: reply2), ownUserId: me)
        XCTAssertEqual(entry1?.serverTitle?.text, "Renamed Thread")
        XCTAssertEqual(entry1?.previewSender, agent)
        XCTAssertEqual(entry1?.previewText, "Draft 1")
        XCTAssertEqual(entry2?.previewText, "Final 2")
        XCTAssertEqual(entry2?.latestTs, 25)
        // Same latest_event and count, only the reply's bundled edit changed -> cacheKey MUST change.
        XCTAssertNotEqual(entry1?.cacheKey, entry2?.cacheKey)
    }

    func testHeadTitleEventsKeepsOnlySummariesAndRootVoiceEchoes() {
        let root = voiceRoot
        let echo = event("$echo", 2, sender: "@mindroom_router:x", [
            "msgtype": "m.text", "body": "🎤 Hello watch",
            "com.mindroom.visible_router_voice_echo": true,
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$root"]] as JSON,
        ])
        let summary = event("$sum", 3, sender: "@mindroom_router:x", inThread([
            "msgtype": "m.notice", "body": "Early title",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Early title"] as JSON,
        ]))
        let oldMsg = event("$old", 4, sender: agent, inThread(["msgtype": "m.text", "body": "Old message"]))
        let filtered = ThreadSnapshot.headTitleEvents(rootId: "$root", from: [echo, summary, oldMsg])
        XCTAssertEqual(Set(filtered.compactMap(\.eventId)), Set(["$echo", "$sum"]))
        let snapshot = ThreadSnapshot.build(root: root, related: filtered, ownUserId: me, now: now)
        XCTAssertEqual(snapshot.title, "Early title")
        // Old message was not added to entries!
        XCTAssertEqual(snapshot.entries.map(\.id), ["$root"])
    }

    func testEncryptedRoomPendingCardOutsideWindowRemainsNeedsYouWhenFetchedById() {
        // Card at ts 2 followed by 31 replies (ts 10..40): card is outside a 20-reply window,
        // re-fetched by its known id alongside its m.replace page.
        let oldCard = card("$oldEncCard", 2)
        let recentReplies = (21...40).map { i in
            event("$r\(i)", i, sender: agent, inThread(["msgtype": "m.text", "body": "Reply \(i)"]))
        }
        let stillPending = ThreadSnapshot.build(root: voiceRoot, related: recentReplies + [oldCard], ownUserId: me, now: now)
        XCTAssertEqual(stillPending.pendingApproval?.eventId, "$oldEncCard")
        XCTAssertEqual(stillPending.rowState, .needsYou)

        // Once its m.replace edit approves it, it clears needsYou.
        let cardEdit = event("$ce", 45, sender: "@mindroom_router:x", type: ApprovalCard.eventType, [
            "m.new_content": ["tool_name": "send_email", "status": "approved"] as JSON,
            "m.relates_to": ["rel_type": "m.replace", "event_id": "$oldEncCard"] as JSON,
        ])
        let decided = ThreadSnapshot.build(root: voiceRoot, related: recentReplies + [oldCard, cardEdit], ownUserId: me, now: now)
        XCTAssertNil(decided.pendingApproval)
        XCTAssertNotEqual(decided.rowState, .needsYou)
    }

    func testQuestionWithMissingSourceIsNotActionableUntilSourceIsFetched() {
        let q = event("$q1", 50, sender: agent, inThread([
            "msgtype": "m.text", "body": "Pick one",
            "io.mindroom.interactive": [
                "question_text": "Pick one",
                "options": ["1": "A", "🍎": "A"] as JSON,
                "source_event_id": "$oldSource",
            ] as JSON,
        ]))
        // Missing source -> not actionable yet, exposes missingQuestionSourceId.
        let unknown = ThreadSnapshot.build(root: voiceRoot, related: [q], ownUserId: me, now: now)
        XCTAssertNil(unknown.openQuestion)
        XCTAssertEqual(unknown.missingQuestionSourceId, "$oldSource")

        // Source from someone else -> still not actionable, no longer missing.
        let annasPrompt = event("$oldSource", 10, sender: "@anna:x", inThread(["msgtype": "m.text", "body": "Ask me"]))
        let forAnna = ThreadSnapshot.build(root: voiceRoot, related: [q], ownUserId: me, now: now, questionSource: annasPrompt)
        XCTAssertNil(forAnna.openQuestion)
        XCTAssertNil(forAnna.missingQuestionSourceId)

        // Source from viewer -> actionable, without polluting entries with the old source event.
        let myPrompt = event("$oldSource", 10, sender: me, inThread(["msgtype": "m.text", "body": "Ask me"]))
        let forMe = ThreadSnapshot.build(root: voiceRoot, related: [q], ownUserId: me, now: now, questionSource: myPrompt)
        XCTAssertEqual(forMe.openQuestion?.eventId, "$q1")
        XCTAssertNil(forMe.missingQuestionSourceId)
        XCTAssertFalse(forMe.entries.map(\.id).contains("$oldSource"))
    }

    func testQuestionCandidateIdStaysSetAfterViewerReactionForWithdrawalPolling() {
        let q = question("$q1", 5)
        let reaction = event("$rx", 6, sender: me, type: "m.reaction", [
            "m.relates_to": ["rel_type": "m.annotation", "event_id": "$q1", "key": "✈️"] as JSON,
        ])
        let answered = ThreadSnapshot.build(root: voiceRoot, related: [q, reaction], ownUserId: me, now: now)
        XCTAssertNil(answered.openQuestion)
        XCTAssertEqual(answered.questionCandidateId, "$q1")
    }

    func testCachedVoiceTranscriptShowsInVoiceRootNotAsHeading() {
        let cached = KnownTitle(text: "🎤 Book dinner at seven", sourceEventId: "$echo1", kind: .transcript)
        let reply = event("$r1", 50, sender: agent, inThread(["msgtype": "m.text", "body": "Booked."]))
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply], ownUserId: me, now: now, cachedTitle: cached)
        XCTAssertEqual(snapshot.title, "🎤 Book dinner at seven")
        XCTAssertNil(snapshot.heading)
        guard case let .message(rootMsg) = snapshot.entries.first else { return XCTFail("missing root entry") }
        XCTAssertEqual(rootMsg.text, "🎤 Book dinner at seven")
        XCTAssertFalse(rootMsg.isVoiceOnly)
    }

    func testRedactedCachedTitleSourceIsDropped() {
        let root = event("$root", 1, sender: me, ["msgtype": "m.text", "body": "Fallback root"])
        let cached = KnownTitle(text: "Old Title", sourceEventId: "$sum1", kind: .summary)
        let redactedNotice = event("$sum1", 3, sender: "@mindroom_router:x", [:])
        let snapshot = ThreadSnapshot.build(root: root, related: [redactedNotice], ownUserId: me, now: now, cachedTitle: cached)
        XCTAssertTrue(snapshot.cachedTitleWasRedacted)
        XCTAssertEqual(snapshot.title, "Fallback root")
        XCTAssertNil(snapshot.heading)
    }

    func testThreadListEntrySkipsOwnAndRelayPreviewsAndIgnoresTitleNoticeTimestamp() {
        let titleNotice = event("$t1", 99, sender: "@mindroom_router:x", [
            "msgtype": "m.notice", "body": "Title",
            "io.mindroom.thread_summary": ["version": 1, "summary": "Title"] as JSON,
        ])
        let ownReply = event("$own", 20, sender: me, ["msgtype": "m.text", "body": "My follow-up"])
        let relay = event("$relay", 30, sender: "@mindroom_router:x", [
            "msgtype": "m.text", "body": "Relayed", "com.mindroom.original_sender": me,
        ])
        var root1 = event("$root1", 10, sender: me, ["msgtype": "m.text", "body": "Hello"])
        root1["unsigned"] = ["m.relations": ["m.thread": [
            "count": 2, "latest_event": titleNotice, "io.mindroom.title": titleNotice, "io.mindroom.latest_reply": ownReply,
        ] as JSON] as JSON] as JSON
        let e1 = ThreadListEntry.parse(root1, ownUserId: me)
        XCTAssertNil(e1?.previewSender)
        XCTAssertEqual(e1?.latestTs, 20)

        var root2 = event("$root2", 10, sender: me, ["msgtype": "m.text", "body": "Hello"])
        root2["unsigned"] = ["m.relations": ["m.thread": [
            "count": 2, "latest_event": titleNotice, "io.mindroom.title": titleNotice, "io.mindroom.latest_reply": relay,
        ] as JSON] as JSON] as JSON
        let e2 = ThreadListEntry.parse(root2, ownUserId: me)
        XCTAssertNil(e2?.previewSender)
    }

    func testBundledEditWithoutRelatesToIsIgnored() {
        let noRelEdit = event("$e1", 5, sender: agent, [
            "m.new_content": ["msgtype": "m.text", "body": "Missing relation"] as JSON,
        ])
        let reply = withBundledEdit(event("$r1", 2, sender: agent, inThread(["msgtype": "m.text", "body": "Original"])), noRelEdit)
        let snapshot = ThreadSnapshot.build(root: voiceRoot, related: [reply], ownUserId: me, now: now)
        XCTAssertEqual(snapshot.reply?.text, "Original")
    }
}
