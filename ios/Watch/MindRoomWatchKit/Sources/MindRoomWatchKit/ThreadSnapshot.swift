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
    /// The newest reply from anyone else, not a relay.
    public let reply: Reply?
    public let approvals: [ApprovalCard]
    /// The newest card from an agent that waits for this person's decision.
    public let pendingApproval: ApprovalCard?
    public let openQuestion: Question?
    public let latestEventId: String
    /// Milliseconds since the epoch of the newest message.
    public let latestTs: Int
    private let latestFromMe: Bool
    private let latestRun: RunState


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
        var edits: [JSON] = []
        var reactions: [JSON] = []
        var messages: [JSON] = []
        for event in related {
            let type = event["type"] as? String
            if type == "m.reaction" {
                reactions.append(event)
            } else if event.replacedEventId != nil {
                edits.append(event)
            } else if type == "m.room.message" || type == ApprovalCard.eventType {
                messages.append(event)
            }
        }
        messages.sort { $0.timestamp < $1.timestamp }
        // As the Matrix spec and the web client: only the sender's own edits replace a message.
        var senders: [String: String] = [:]
        for event in [root] + messages { if let id = event.eventId { senders[id] = event["sender"] as? String } }
        var latestEdits: [String: JSON] = [:]
        for event in edits {
            guard let target = event.replacedEventId, let sender = senders[target], sender == event["sender"] as? String else { continue }
            if (latestEdits[target]?.timestamp ?? -1) < event.timestamp { latestEdits[target] = event }
        }
        let cardEdits = edits.filter { $0["type"] as? String == ApprovalCard.eventType }
        let edit = { (event: JSON) in latestEdits[event.eventId ?? ""] }

        let isVoiceRoot = root.content["org.matrix.msc3245.voice"] is JSON || root.content["m.voice"] is JSON
        let transcript = messages.lazy
            .compactMap { VoiceEcho.transcript($0, latestEdit: edit($0)) }
            .first { $0.voiceEventId == rootId }?.text
        // Each message as its newest edit says it (the whole new content, keeping its thread relation).
        let notices = messages.map { message in edit(message).flatMap(\.newContent).map { newContent -> JSON in
            var merged = message
            var content = newContent
            content["m.relates_to"] = message.relation
            merged["content"] = content
            return merged
        } ?? message }
        let rootText = PlainText.of(markdown: effectiveContent(root, latestEdit: edit(root))["body"] as? String ?? "")
        let encryptedRoot = root["type"] as? String == "m.room.encrypted"
        let title = ThreadSummary.title(from: notices) ?? transcript
            ?? (isVoiceRoot ? String(localized: "Voice message") : encryptedRoot ? String(localized: "Encrypted message") : rootText)

        // The conversation: what people and agents said, without the router's echo and titles.
        let conversation = messages.filter { message in
            VoiceEcho.transcript(message, latestEdit: nil) == nil && message.content["io.mindroom.thread_summary"] == nil
        }
        // The router's relay of a message hands it to an agent; it is not an answer.
        let reply = conversation.last {
            ($0["sender"] as? String) != ownUserId && $0["type"] as? String == "m.room.message"
                && $0.content["com.mindroom.original_sender"] == nil
        }
            .map { message -> Reply in
                let body = effectiveContent(message, latestEdit: edit(message))["body"] as? String ?? ""
                let plain = PlainText.withToolCount(body)
                return Reply(eventId: message.eventId ?? "", sender: message["sender"] as? String ?? "", text: plain.text,
                             tools: plain.tools, run: RunState.of(message, latestEdit: edit(message)))
            }
        let approvals = conversation.compactMap(ApprovalCard.parse).map { $0.applying(edits: cardEdits, now: now) }
        let isAgent = { (userId: String?) in MindRoomAgent.isAgent(userId, viewer: ownUserId) }
        let pendingApproval = approvals.last {
            $0.status == .pending && isAgent($0.sender) && ($0.approverUserId == nil || $0.approverUserId == ownUserId)
        }
        // As the web client: only the newest agent reply asks (not the router's relay of a message), until
        // the person writes or reacts, for 7 days, and only when it answers this person.
        var openQuestion: Question?
        if let asking = conversation.last(where: {
            isAgent($0["sender"] as? String) && $0["type"] as? String == "m.room.message"
                && $0.content["com.mindroom.original_sender"] == nil
        }), let question = Question.parse(asking, latestEdit: edit(asking)) {
            let askedAt = edit(asking)?.timestamp ?? asking.timestamp
            let wroteSince = conversation.contains { ($0["sender"] as? String) == ownUserId && $0.timestamp > askedAt }
            let keys = Set(question.options.map(\.key))
            let reacted = reactions.contains {
                ($0["sender"] as? String) == ownUserId && ($0.relation?["event_id"] as? String) == question.eventId
                    && keys.contains($0.relation?["key"] as? String ?? "")
            }
            let sourceId = (effectiveContent(asking, latestEdit: edit(asking))["io.mindroom.interactive"] as? JSON)?["source_event_id"] as? String
            let source = ([root] + messages).first { $0.eventId == sourceId }
            let asker = source.flatMap { ($0.content["com.mindroom.original_sender"] as? String) ?? $0["sender"] as? String }
            let askedSomeoneElse = asker.map { $0 != ownUserId && !isAgent($0) } ?? false
            let stale = Double(askedAt) / 1000 < now.timeIntervalSince1970 - 7 * 24 * 3600
            if !wroteSince && !reacted && !askedSomeoneElse && !stale { openQuestion = question }
        }
        let latest = conversation.last ?? root
        return ThreadSnapshot(
            rootId: rootId, rootTs: root.timestamp, title: title, isVoiceRoot: isVoiceRoot, reply: reply, approvals: approvals,
            pendingApproval: pendingApproval, openQuestion: openQuestion, latestEventId: latest.eventId ?? rootId, latestTs: latest.timestamp,
            latestFromMe: (latest["sender"] as? String) == ownUserId,
            latestRun: RunState.of(latest, latestEdit: edit(latest)))
    }
}

/// What a pushed event lets the person do from its notification: the thread screen's own rules.
public enum PushedState: Equatable, Sendable {
    case approval(ApprovalCard, actionable: Bool)
    case question(Question)
    case message
}

extension ThreadSnapshot {
    /// The pushed event as the thread shows it: a card only this person may decide is actionable, a question
    /// only while it is the thread's open one.
    public func pushed(eventId: String) -> PushedState {
        if let card = approvals.first(where: { $0.eventId == eventId }) {
            return .approval(card, actionable: pendingApproval?.eventId == eventId)
        }
        if let openQuestion, openQuestion.eventId == eventId { return .question(openQuestion) }
        return .message
    }

    /// The root of the thread an event belongs to: its `m.thread` relation, a card's `thread_id`, else itself.
    public static func threadRootId(of event: JSON) -> String {
        if event.relation?["rel_type"] as? String == "m.thread", let root = event.relation?["event_id"] as? String { return root }
        if event["type"] as? String == ApprovalCard.eventType, let root = event.content["thread_id"] as? String { return root }
        return event.eventId ?? ""
    }
}
