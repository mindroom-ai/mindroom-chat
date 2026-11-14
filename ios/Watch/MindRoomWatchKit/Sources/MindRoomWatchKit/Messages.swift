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
        // The number keys (typed answers) carry the agent's order; the emoji keys are the buttons.
        let numbered = options.compactMap { key, value -> (Int, String)? in
            guard let number = Int(key), let value = value as? String else { return nil }
            return (number, value)
        }
        let order = { (key: String) -> Int in
            numbered.filter { $0.1 == options[key] as? String }.map(\.0).min() ?? Int.max
        }
        let buttons = options
            .filter { key, value in !key.allSatisfy(\.isNumber) && value is String }
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

/// Where an agent's reply is: still streaming, finished, stopped, or not an agent run.
public enum RunState: Equatable, Sendable {
    case streaming, finished, stopped, none

    public static func of(_ event: JSON, latestEdit: JSON?) -> RunState {
        let content = effectiveContent(event, latestEdit: latestEdit)
        if let run = content["io.mindroom.ai_run"] as? JSON, (run["version"] as? NSNumber)?.intValue == 1 {
            switch run["status"] as? String {
            case "completed", "cached": return .finished
            case "cancelled", "error", "interrupted": return .stopped
            default: break
            }
        }
        switch content["io.mindroom.stream_status"] as? String {
        case "pending", "streaming", "active", "running": return .streaming
        case "completed": return .finished
        case "cancelled", "interrupted", "error": return .stopped
        default: return .none
        }
    }
}

/// The thread's AI title: the router's newest `io.mindroom.thread_summary` notice.
public enum ThreadSummary {
    public static func title(from events: [JSON]) -> String? {
        events
            .compactMap { event -> (Int, String)? in
                guard let summary = event.content["io.mindroom.thread_summary"] as? JSON,
                      (summary["version"] as? NSNumber)?.intValue == 1 else { return nil }
                let text = (summary["summary"] as? String) ?? (event.content["body"] as? String)
                return text.map { (event.timestamp, $0) }
            }
            .max { $0.0 < $1.0 }?
            .1
    }
}

/// The router's echo of a voice message: a reply that says it is transcribing, edited into the transcript.
public enum VoiceEcho {
    public static let placeholder = "Router agent is transcribing…"

    public static func transcript(_ event: JSON, latestEdit: JSON?) -> (voiceEventId: String, text: String?)? {
        guard event.content["com.mindroom.visible_router_voice_echo"] as? Bool == true,
              let voiceId = (event.relation?["m.in_reply_to"] as? JSON)?["event_id"] as? String else { return nil }
        let body = effectiveContent(event, latestEdit: latestEdit)["body"] as? String
        return (voiceId, body == placeholder ? nil : body)
    }
}
