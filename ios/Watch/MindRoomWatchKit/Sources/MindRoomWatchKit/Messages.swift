import Foundation

/// An agent's multiple-choice question (`io.mindroom.interactive`); a reaction with an option's key answers it.
public struct Question: Equatable, Sendable {
    public let eventId: String
    public let text: String
    public let options: [Option]

    public struct Option: Equatable, Sendable {
        public let key: String
        public let label: String
    }

    public static func parse(_ event: JSON, latestEdit: JSON?) -> Question? {
        guard let eventId = event.eventId,
              let interactive = effectiveContent(event, latestEdit: latestEdit)["io.mindroom.interactive"] as? JSON,
              let options = interactive["options"] as? JSON,
              let text = interactive["question_text"] as? String, !text.isEmpty else { return nil }
        let labels = interactive["option_labels"] as? JSON ?? [:]
        // The number keys (typed answers, ASCII digits only as in the web client: a keycap emoji is a
        // button) carry the agent's order; the other keys are the buttons.
        let numbered = options.compactMap { key, value -> (Int, String)? in
            guard let number = Int(key), let value = value as? String else { return nil }
            return (number, value)
        }
        let order = { (key: String) -> Int in
            numbered.filter { $0.1 == options[key] as? String }.map(\.0).min() ?? Int.max
        }
        let buttons = options
            .filter { key, value in key.unicodeScalars.contains { !("0"..."9").contains($0) } && value is String }
            .map(\.key)
            .sorted { (order($0), $0) < (order($1), $1) }
            .map { key -> Option in
                let label = labels[key] as? String
                return Option(key: key, label: label?.isEmpty == false ? label! : options[key] as? String ?? key)
            }
        guard !buttons.isEmpty else { return nil }
        return Question(eventId: eventId, text: text, options: buttons)
    }
}

/// Reads `io.mindroom.stream_status` in string or `{status | state}` record form from `content` or its edit wrapper,
/// matching the web client's `aiRun.ts` `readStreamStatus`.
func readStreamStatus(content: JSON, editWrapper: JSON?) -> (present: Bool, normalized: String?) {
    let key = "io.mindroom.stream_status"
    let raw = content[key] ?? editWrapper?[key]
    guard let raw else { return (false, nil) }
    if let string = raw as? String, !string.isEmpty {
        return (true, string.lowercased())
    }
    if let record = raw as? JSON {
        if let status = record["status"] as? String, !status.isEmpty { return (true, status.lowercased()) }
        if let state = record["state"] as? String, !state.isEmpty { return (true, state.lowercased()) }
    }
    return (true, nil)
}

/// Where an agent's reply is: still streaming, finished, stopped, or not an agent run.
public enum RunState: Equatable, Sendable {
    case streaming, finished, stopped, none

    public static func of(_ event: JSON, latestEdit: JSON?) -> RunState {
        let content = effectiveContent(event, latestEdit: latestEdit)
        let editWrapper = latestEdit?.newContent == nil ? nil : latestEdit?.content
        let stream = readStreamStatus(content: content, editWrapper: editWrapper)
        let aiRunStatus: String? = {
            guard let run = content["io.mindroom.ai_run"] as? JSON,
                  jsonExactInt(run["version"]) == 1 else { return nil }
            return (run["status"] as? String)?.lowercased()
        }()

        // Explicit active or stopped stream_status takes precedence over a stale ai_run.status
        // (e.g. a regenerated reply that kept its previous answer's completed metadata).
        if stream.present {
            switch stream.normalized {
            case "pending", "streaming", "active", "running": return .streaming
            case "cancelled", "interrupted", "error": return .stopped
            case "completed", "complete", "done": break
            default:
                // Present but neither active, stopped, nor successful (e.g. "approval_pending" or malformed):
                // do not report finished from stale ai_run, while preserving explicit ai_run stopped states.
                switch aiRunStatus {
                case "cancelled", "error", "interrupted": return .stopped
                default: return .none
                }
            }
        }
        switch aiRunStatus {
        case "completed", "cached": return .finished
        case "cancelled", "error", "interrupted": return .stopped
        default: break
        }
        switch stream.normalized {
        case "completed", "complete", "done": return .finished
        default: return .none
        }
    }
}

/// The thread's AI title: the newest `io.mindroom.thread_summary` notice.
public enum ThreadSummary {
    public static func title(from events: [JSON]) -> String? {
        events
            .compactMap { event -> (Int, String)? in
                guard let summary = event.content["io.mindroom.thread_summary"] as? JSON,
                      jsonExactInt(summary["version"]) == 1 else { return nil }
                let text = (summary["summary"] as? String) ?? (event.content["body"] as? String)
                return text.map { (event.timestamp, $0) }
            }
            .max { $0.0 < $1.0 }?
            .1
    }
}

/// An `m.audio` message's caption: its body, when a `filename` beside it differs. Without one the body is the
/// file's name, which says nothing.
public enum AudioCaption {
    public static func of(_ content: JSON) -> String? {
        guard let filename = content["filename"] as? String, let body = content["body"] as? String,
              filename != body else { return nil }
        return PlainText.of(markdown: body)
    }
}

/// A voice message's transcript echo: posted directly or edited from the legacy transcribing placeholder.
public enum VoiceEcho {
    public static let placeholder = "Router agent is transcribing…"
    static let flag = "com.mindroom.visible_router_voice_echo"
    private static let source = "com.mindroom.voice_source_event_id"
    private static let fallback = "com.mindroom.voice_raw_audio_fallback"
    /// What an echo says of itself: read across its sender's edits (`shownEdits`).
    static let marks = [flag, source, fallback]

    /// As the web client's `planVoiceTranscripts`: the first version and the one shown carry the flag, and the
    /// one shown is not the raw-audio fallback, holds all of the text (no preview of a long text) and names
    /// the voice message. An older backend's echo names it by its reply relation, which no edit repeats.
    public static func transcript(_ event: JSON, latestEdit: JSON?) -> (voiceEventId: String, text: String?)? {
        let content = effectiveContent(event, latestEdit: latestEdit)
        // As the web client's `getLatestMessageContent`: MindRoom metadata an edit carries beside its
        // `m.new_content` counts where the new content does not name it (never the long-text mark).
        let beside = latestEdit?.newContent == nil ? nil : latestEdit?.content
        let shown = { (key: String) in content[key] ?? beside?[key] }
        guard jsonBool(event.content[flag]) == true, jsonBool(shown(flag)) == true,
              jsonBool(shown(fallback)) != true,
              !(content["io.mindroom.long_text"] is JSON) else { return nil }
        let nonEmpty: (Any?) -> String? = { ($0 as? String).flatMap { $0.isEmpty ? nil : $0 } }
        guard let voiceId = nonEmpty(shown(source))
            ?? nonEmpty((event.relation?["m.in_reply_to"] as? JSON)?["event_id"]) else { return nil }
        let body = content["body"] as? String
        return (voiceId, body == placeholder ? nil : body)
    }
}
