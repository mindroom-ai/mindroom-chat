import XCTest
@testable import MindRoomWatchKit

private func message(_ content: JSON, id: String = "$m", ts: Int = 1) -> JSON {
    ["type": "m.room.message", "event_id": id, "origin_server_ts": ts, "sender": "@mindroom_code:x", "content": content]
}

private func edit(of id: String, _ newContent: JSON, ts: Int = 2) -> JSON {
    message(["m.new_content": newContent, "m.relates_to": ["rel_type": "m.replace", "event_id": id]], id: "$e\(ts)", ts: ts)
}

final class QuestionTests: XCTestCase {
    private let interactive: JSON = [
        "creator_agent": "code",
        "question_text": "Which deck should I polish?",
        "options": ["✅": "v3", "📄": "v4", "1": "v3", "2": "v4"],
        "option_labels": ["✅": "v3 final", "📄": "v4 draft", "1": "v3 final", "2": "v4 draft"],
        "source_event_id": "$source",
    ]

    func testReadsEmojiOptionsWithLabels() throws {
        let q = try XCTUnwrap(Question.parse(message(["body": "Which deck?", "io.mindroom.interactive": interactive], id: "$q"), latestEdit: nil))
        XCTAssertEqual(q.eventId, "$q")
        XCTAssertEqual(q.text, "Which deck should I polish?")
        XCTAssertEqual(q.options.map(\.key).sorted(), ["✅", "📄"])
        XCTAssertEqual(q.options.first { $0.key == "📄" }?.label, "v4 draft")
    }

    func testKeycapEmojiAreButtonsNotTypedNumbers() throws {
        let keycaps: JSON = ["question_text": "Which?", "options": ["1️⃣": "a", "2️⃣": "b", "1": "a", "2": "b"]]
        let q = try XCTUnwrap(Question.parse(message(["body": "Which?", "io.mindroom.interactive": keycaps], id: "$q"), latestEdit: nil))
        XCTAssertEqual(q.options.map(\.key), ["1️⃣", "2️⃣"])
    }

    func testReadsTheQuestionFromTheLatestEdit() throws {
        let q = Question.parse(message(["body": "Thinking…"], id: "$q"), latestEdit: edit(of: "$q", ["body": "Which?", "io.mindroom.interactive": interactive]))
        XCTAssertEqual(q?.options.count, 2)
    }

    func testPlainMessageIsNoQuestion() {
        XCTAssertNil(Question.parse(message(["body": "hello"]), latestEdit: nil))
    }
}

final class RunStateTests: XCTestCase {
    func testStreamingStatusFromTheEdit() {
        XCTAssertEqual(RunState.of(message(["body": "…"]), latestEdit: edit(of: "$m", ["body": "partial", "io.mindroom.stream_status": "streaming"])), .streaming)
        XCTAssertEqual(RunState.of(message(["body": "…", "io.mindroom.stream_status": "pending"]), latestEdit: nil), .streaming)
    }

    func testFinishedRun() {
        let done = edit(of: "$m", ["body": "done", "io.mindroom.ai_run": ["version": 1, "status": "completed"]])
        XCTAssertEqual(RunState.of(message(["body": "…"]), latestEdit: done), .finished)
        let cached = message(["body": "done", "io.mindroom.ai_run": ["version": 1, "status": "cached"]])
        XCTAssertEqual(RunState.of(cached, latestEdit: nil), .finished)
    }

    func testStoppedRun() {
        XCTAssertEqual(RunState.of(message(["body": "x", "io.mindroom.ai_run": ["version": 1, "status": "error"]]), latestEdit: nil), .stopped)
        XCTAssertEqual(RunState.of(message(["body": "x", "io.mindroom.stream_status": "cancelled"]), latestEdit: nil), .stopped)
    }

    func testUnknownVersionAndPlainMessagesAreNone() {
        XCTAssertEqual(RunState.of(message(["body": "x", "io.mindroom.ai_run": ["version": 2, "status": "completed"]]), latestEdit: nil), .none)
        XCTAssertEqual(RunState.of(message(["body": "x"]), latestEdit: nil), .none)
    }
}

final class ThreadSummaryTests: XCTestCase {
    private func notice(_ summary: String, ts: Int, version: Int = 1) -> JSON {
        message(["msgtype": "m.notice", "body": summary, "io.mindroom.thread_summary": ["version": version, "summary": summary, "message_count": 3]], id: "$n\(ts)", ts: ts)
    }

    func testNewestSummaryWins() {
        XCTAssertEqual(ThreadSummary.title(from: [notice("Old", ts: 1), notice("Flights to Lisbon", ts: 5)]), "Flights to Lisbon")
    }

    func testIgnoresOtherVersionsAndPlainMessages() {
        XCTAssertNil(ThreadSummary.title(from: [notice("X", ts: 1, version: 2), message(["body": "hi"])]))
    }
}

final class VoiceEchoTests: XCTestCase {
    private func echo(_ body: String) -> JSON {
        message(["msgtype": "m.text", "body": body, "com.mindroom.visible_router_voice_echo": true,
                 "com.mindroom.original_sender": "@bas:x", "m.relates_to": ["m.in_reply_to": ["event_id": "$voice"]]], id: "$echo")
    }

    func testTranscribingPlaceholderHasNoText() throws {
        let result = try XCTUnwrap(VoiceEcho.transcript(echo("Router agent is transcribing…"), latestEdit: nil))
        XCTAssertEqual(result.voiceEventId, "$voice")
        XCTAssertNil(result.text)
    }

    func testTheEditCarriesTheTranscript() throws {
        let result = try XCTUnwrap(VoiceEcho.transcript(echo("Router agent is transcribing…"), latestEdit: edit(of: "$echo", ["body": "🎤 Remind me to call the dentist", "com.mindroom.visible_router_voice_echo": true])))
        XCTAssertEqual(result.text, "🎤 Remind me to call the dentist")
    }

    func testOrdinaryReplyIsNoEcho() {
        XCTAssertNil(VoiceEcho.transcript(message(["body": "hi", "m.relates_to": ["m.in_reply_to": ["event_id": "$voice"]]]), latestEdit: nil))
    }

    func testPrefersVoiceSourceEventIdOverReplyRelation() throws {
        let content: JSON = [
            "msgtype": "m.text",
            "body": "🎤 Hello",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$voice",
            "m.relates_to": ["rel_type": "m.thread", "event_id": "$root", "m.in_reply_to": ["event_id": "$other"]] as JSON,
        ]
        let result = try XCTUnwrap(VoiceEcho.transcript(message(content, id: "$echo"), latestEdit: nil))
        XCTAssertEqual(result.voiceEventId, "$voice")
        XCTAssertEqual(result.text, "🎤 Hello")
    }

    func testReadsVoiceSourceEventIdWithoutReplyRelation() throws {
        let content: JSON = [
            "msgtype": "m.text",
            "body": "🎤 Direct",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$voice",
        ]
        let result = try XCTUnwrap(VoiceEcho.transcript(message(content, id: "$echo"), latestEdit: nil))
        XCTAssertEqual(result.voiceEventId, "$voice")
        XCTAssertEqual(result.text, "🎤 Direct")
    }

    func testSkipsRawAudioFallback() {
        let direct = message([
            "msgtype": "m.text",
            "body": "🎤 [Attached voice message]",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$voice",
            "com.mindroom.voice_raw_audio_fallback": true,
        ], id: "$echo")
        XCTAssertNil(VoiceEcho.transcript(direct, latestEdit: nil))
        let editedFallback = edit(of: "$echo", [
            "msgtype": "m.text",
            "body": "🎤 [Attached voice message]",
            "com.mindroom.visible_router_voice_echo": true,
            "com.mindroom.voice_source_event_id": "$voice",
            "com.mindroom.voice_raw_audio_fallback": true,
        ])
        XCTAssertNil(VoiceEcho.transcript(echo("Router agent is transcribing…"), latestEdit: editedFallback))
    }

    func testEchoFlagsRequireStrictJSONBooleans() throws {
        func decode(_ raw: String) throws -> JSON {
            try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? JSON)
        }
        // JSON number 1 bridges to Bool in Swift, but must not satisfy com.mindroom.visible_router_voice_echo === true.
        let numericVisible = try decode(#"""
        {"type": "m.room.message", "event_id": "$e", "origin_server_ts": 1, "sender": "@mindroom_code:x",
         "content": {"msgtype": "m.text", "body": "🎤 Hi", "com.mindroom.visible_router_voice_echo": 1, "com.mindroom.voice_source_event_id": "$voice"}}
        """#)
        XCTAssertNil(VoiceEcho.transcript(numericVisible, latestEdit: nil))

        // JSON number 1 must not trigger com.mindroom.voice_raw_audio_fallback === true.
        let numericFallback = try decode(#"""
        {"type": "m.room.message", "event_id": "$e", "origin_server_ts": 1, "sender": "@mindroom_code:x",
         "content": {"msgtype": "m.text", "body": "🎤 Hi", "com.mindroom.visible_router_voice_echo": true, "com.mindroom.voice_source_event_id": "$voice", "com.mindroom.voice_raw_audio_fallback": 1}}
        """#)
        let result = try XCTUnwrap(VoiceEcho.transcript(numericFallback, latestEdit: nil))
        XCTAssertEqual(result.voiceEventId, "$voice")
        XCTAssertEqual(result.text, "🎤 Hi")
    }

    func testTheNewestVersionSaysWhetherItIsAnEchoAndOfWhichVoiceMessage() throws {
        let named: JSON = ["msgtype": "m.text", "body": "🎤 Hello", "com.mindroom.visible_router_voice_echo": true,
                           "com.mindroom.voice_source_event_id": "$voice"]
        let original = message(named, id: "$echo")
        // As the web client's `getVoiceSourceEventId`: the flag and the name are those of the version shown.
        XCTAssertNil(VoiceEcho.transcript(original, latestEdit: edit(of: "$echo", ["body": "Not an echo", "com.mindroom.voice_source_event_id": "$voice"])))
        XCTAssertNil(VoiceEcho.transcript(original, latestEdit: edit(of: "$echo", named.merging(["com.mindroom.visible_router_voice_echo": false]) { $1 })))
        XCTAssertNil(VoiceEcho.transcript(original, latestEdit: edit(of: "$echo", ["body": "🎤 Hello", "com.mindroom.visible_router_voice_echo": true])))
        let moved = try XCTUnwrap(VoiceEcho.transcript(original, latestEdit: edit(of: "$echo", named.merging(["com.mindroom.voice_source_event_id": "$other"]) { $1 })))
        XCTAssertEqual(moved.voiceEventId, "$other")
        // An older backend's echo names its voice message by its reply relation, which an edit does not repeat.
        let legacy = try XCTUnwrap(VoiceEcho.transcript(echo("Router agent is transcribing…"), latestEdit: edit(of: "$echo", ["body": "🎤 Hello", "com.mindroom.visible_router_voice_echo": true])))
        XCTAssertEqual(legacy.voiceEventId, "$voice")
        XCTAssertEqual(legacy.text, "🎤 Hello")
    }

    func testAPreviewOfALongTextIsNoTranscript() {
        let preview: JSON = ["msgtype": "m.text", "body": "🎤 The first words…", "com.mindroom.visible_router_voice_echo": true,
                             "com.mindroom.voice_source_event_id": "$voice", "io.mindroom.long_text": ["version": 2] as JSON]
        XCTAssertNil(VoiceEcho.transcript(message(preview, id: "$echo"), latestEdit: nil))
        XCTAssertNil(VoiceEcho.transcript(echo("Router agent is transcribing…"), latestEdit: edit(of: "$echo", preview)))
    }
}
