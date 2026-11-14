import Foundation

/// What the watch shows of a thread, built from its root and every event related to it (thread
/// replies, edits, reactions) as raw JSON.
public struct ThreadSnapshot: Equatable, Sendable {
    public struct Reply: Equatable, Sendable {
        public let eventId: String
        public let sender: String
        public let text: String
        public let tools: Int
        public let run: RunState
    }

    public let rootId: String
    /// Milliseconds since the epoch of the root.
    public let rootTs: Int
    public let title: String
    public let isVoiceRoot: Bool
    /// The newest agent (anyone else's) reply.
    public let reply: Reply?
    public let approvals: [ApprovalCard]
    public let openQuestion: Question?
    public let latestEventId: String
    /// Milliseconds since the epoch of the newest message.
    public let latestTs: Int
    private let latestFromMe: Bool
    private let latestRun: RunState

    public var pendingApproval: ApprovalCard? { approvals.last { $0.status == .pending } }

    public func rowState(lastSeenEventId: String?, sendFailed: Bool = false, queued: Bool = false) -> ThreadRowState {
        if sendFailed { return .failed }
        if queued { return .queued }
        if pendingApproval != nil || openQuestion != nil { return .needsYou }
        if latestRun == .streaming { return .running }
        if !latestFromMe && latestEventId != lastSeenEventId { return .unread }
        return .idle(Date(timeIntervalSince1970: Double(latestTs) / 1000))
    }

    public static func build(root: JSON, related: [JSON], ownUserId: String, now: Date) -> ThreadSnapshot {
        let rootId = root.eventId ?? ""
        var latestEdits: [String: JSON] = [:]
        var cardEdits: [JSON] = []
        var reactions: [JSON] = []
        var messages: [JSON] = []
        for event in related {
            let type = event["type"] as? String
            if type == "m.reaction" {
                reactions.append(event)
            } else if let target = event.replacedEventId {
                if type == ApprovalCard.eventType { cardEdits.append(event) }
                if (latestEdits[target]?.timestamp ?? -1) < event.timestamp { latestEdits[target] = event }
            } else if type == "m.room.message" || type == ApprovalCard.eventType {
                messages.append(event)
            }
        }
        messages.sort { $0.timestamp < $1.timestamp }
        let edit = { (event: JSON) in latestEdits[event.eventId ?? ""] }

        let isVoiceRoot = root.content["org.matrix.msc3245.voice"] is JSON || root.content["m.voice"] is JSON
        let transcript = messages.lazy
            .compactMap { VoiceEcho.transcript($0, latestEdit: edit($0)) }
            .first { $0.voiceEventId == rootId }?.text
        let notices = messages.map { message in edit(message).map { e -> JSON in
            var merged = message
            var content = message.content
            content["body"] = e.newContent?["body"] ?? content["body"]
            merged["content"] = content
            return merged
        } ?? message }
        let rootText = PlainText.of(markdown: effectiveContent(root, latestEdit: edit(root))["body"] as? String ?? "")
        let title = ThreadSummary.title(from: notices) ?? transcript ?? (isVoiceRoot ? "Voice message" : rootText)

        // The conversation: what people and agents said, without the router's echo and titles.
        let conversation = messages.filter { message in
            VoiceEcho.transcript(message, latestEdit: nil) == nil && message.content["io.mindroom.thread_summary"] == nil
        }
        let reply = conversation.last { ($0["sender"] as? String) != ownUserId && $0["type"] as? String == "m.room.message" }
            .map { message -> Reply in
                let body = effectiveContent(message, latestEdit: edit(message))["body"] as? String ?? ""
                let plain = PlainText.withToolCount(body)
                return Reply(eventId: message.eventId ?? "", sender: message["sender"] as? String ?? "", text: plain.text,
                             tools: plain.tools, run: RunState.of(message, latestEdit: edit(message)))
            }
        let approvals = conversation.compactMap(ApprovalCard.parse).map { $0.applying(edits: cardEdits, now: now) }
        let openQuestion = conversation.reversed().lazy.compactMap { message -> Question? in
            guard let question = Question.parse(message, latestEdit: edit(message)) else { return nil }
            let reacted = reactions.contains {
                ($0["sender"] as? String) == ownUserId && ($0.relation?["event_id"] as? String) == question.eventId
            }
            let answered = conversation.contains { ($0["sender"] as? String) == ownUserId && $0.timestamp > message.timestamp }
            return reacted || answered ? nil : question
        }.first
        let latest = conversation.last ?? root
        return ThreadSnapshot(
            rootId: rootId, rootTs: root.timestamp, title: title, isVoiceRoot: isVoiceRoot, reply: reply, approvals: approvals,
            openQuestion: openQuestion, latestEventId: latest.eventId ?? rootId, latestTs: latest.timestamp,
            latestFromMe: (latest["sender"] as? String) == ownUserId,
            latestRun: RunState.of(latest, latestEdit: edit(latest)))
    }
}
