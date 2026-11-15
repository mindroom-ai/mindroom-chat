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
    /// A voice root's file name: Send follows its own recording by it.
    public let voiceFile: String?
    /// The newest reply from anyone else, not a relay.
    public let reply: Reply?
    public let approvals: [ApprovalCard]
    /// The newest card from an agent that waits for this person's decision.
    public let pendingApproval: ApprovalCard?
    public let openQuestion: Question?
    /// Milliseconds since the epoch of the newest message or its newest edit: a reply streams on in edits.
    public let latestTs: Int

    public var rowState: ThreadRowState {
        if pendingApproval != nil || openQuestion != nil { return .needsYou }
        // The reply, not the newest event: a reply that began before an approval card goes on after it.
        if reply?.run == .streaming { return .running }
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
        // As the Matrix spec and the web client: only the sender's own edits replace a message, and the
        // newest one that can be read (an edit that does not decrypt has no new content).
        var senders: [String: String] = [:]
        for event in [root] + messages { if let id = event.eventId { senders[id] = event["sender"] as? String } }
        var latestEdits: [String: JSON] = [:]
        for event in edits {
            guard let target = event.replacedEventId, let sender = senders[target], sender == event["sender"] as? String,
                  event.newContent != nil else { continue }
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
        let latestTs = ([root] + conversation).map { max($0.timestamp, edit($0)?.timestamp ?? 0) }.max() ?? root.timestamp
        return ThreadSnapshot(
            rootId: rootId, rootTs: root.timestamp, title: title, isVoiceRoot: isVoiceRoot,
            voiceFile: isVoiceRoot ? root.content["filename"] as? String ?? root.content["body"] as? String : nil,
            reply: reply, approvals: approvals, pendingApproval: pendingApproval, openQuestion: openQuestion,
            latestTs: latestTs)
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
