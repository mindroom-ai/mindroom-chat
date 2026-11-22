import Foundation

/// What the watch shows of a thread, built from its root and every event related to it (thread
/// replies, edits, reactions) as raw JSON.
public struct ThreadSnapshot: Equatable, Sendable {
    public struct Message: Equatable, Sendable {
        public let eventId: String
        public let sender: String
        public let isOwn: Bool
        /// Plain text. Of an audio message: its transcript or caption, else nothing.
        public let text: String
        /// An audio message's file, as the JSON the SDK reads a media source from.
        public let audio: String?
        public let tools: Int
        public let run: RunState
        public let toolNames: [String]
        public let durationSeconds: Int?
        public let workText: String?
        public let answerText: String

        public init(
            eventId: String,
            sender: String,
            isOwn: Bool,
            text: String,
            audio: String?,
            tools: Int,
            run: RunState,
            toolNames: [String] = [],
            durationSeconds: Int? = nil,
            workText: String? = nil,
            answerText: String? = nil
        ) {
            self.eventId = eventId
            self.sender = sender
            self.isOwn = isOwn
            self.text = text
            self.audio = audio
            self.tools = tools
            self.run = run
            self.toolNames = toolNames
            self.durationSeconds = durationSeconds
            self.workText = workText
            self.answerText = answerText ?? text
        }

        /// Audio with no words to show: there is only the sound.
        public var isVoiceOnly: Bool { audio != nil && text.isEmpty }
    }

    /// A step of the thread: a message, or a tool call's approval card.
    public enum Entry: Equatable, Sendable, Identifiable {
        case message(Message)
        case approval(ApprovalCard)

        public var id: String {
            switch self {
            case let .message(message): message.eventId
            case let .approval(card): card.eventId
            }
        }
    }

    public let rootId: String
    /// Milliseconds since the epoch of the root.
    public let rootTs: Int
    public let title: String
    /// The title where the first entry does not give it already: the AI title, or what stands for a
    /// root that is no entry (one that cannot be read).
    public let heading: String?
    public let isVoiceRoot: Bool
    /// A voice root's file name: Send follows its own recording by it.
    public let voiceFile: String?
    /// The whole thread in order: the root and every reply, without folded voice echoes, relays and titles,
    /// and each approval card that was decided or is the one waiting for this person (`pendingApproval`).
    public private(set) var entries: [Entry] = []
    /// The newest reply from anyone else, not a relay.
    public let reply: Message?
    public private(set) var approvals: [ApprovalCard] = []
    /// The newest card from an agent that waits for this person's decision.
    public private(set) var pendingApproval: ApprovalCard?
    public let openQuestion: Question?
    /// Milliseconds since the epoch of the newest message or its newest edit: a reply streams on in edits.
    public let latestTs: Int
    /// Every message and card in order, each card as its edits say it with no deadline applied, and the cards
    /// this person may decide: `at(_:)` tells `entries`, `approvals` and `pendingApproval` from them.
    private let all: [Entry]
    private let decidable: Set<String>

    /// Where the thread opens: at what waits for the person, else at the newest answer.
    public var focusId: String? {
        pendingApproval?.eventId ?? openQuestion?.eventId ?? reply?.eventId ?? entries.last?.id
    }

    public var rowState: ThreadRowState {
        if pendingApproval != nil || openQuestion != nil { return .needsYou }
        // The reply, not the newest event: a reply that began before an approval card goes on after it.
        if reply?.run == .streaming { return .running }
        return .idle(Date(timeIntervalSince1970: Double(latestTs) / 1000))
    }

    public static func build(root: JSON, related: [JSON], ownUserId: String, now: Date,
                             trustedAccounts: Set<String> = []) -> ThreadSnapshot {
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
        let latestEdits = shownEdits(of: [root] + messages, among: edits)
        let cardEdits = edits.filter { $0["type"] as? String == ApprovalCard.eventType }
        let edit = { (event: JSON) in latestEdits[event.eventId ?? ""] }
        // An edit replaces the whole content, what kind of message it is included (one that names no kind keeps it).
        let isAudio = { (event: JSON) in
            (effectiveContent(event, latestEdit: edit(event))["msgtype"] ?? event.content["msgtype"]) as? String == "m.audio"
        }

        // An internal relay of a message hands it to an agent; it is not an answer.
        let isMessage = { (event: JSON) in
            event["type"] as? String == "m.room.message" && event.content["com.mindroom.original_sender"] == nil
        }
        let isVoiceRoot = root.content["org.matrix.msc3245.voice"] is JSON || root.content["m.voice"] is JSON
        // The voice messages a transcript can show under, as the web client's `planVoiceTranscripts` takes
        // them: not redacted (an edit of a redacted one may still be read), and the version shown is audio by
        // its own `msgtype` and has the voice mark (`isVoiceMessageContent`). An audio file keeps its caption.
        let voiceIds = Set(([root] + messages).compactMap { event -> String? in
            let content = effectiveContent(event, latestEdit: edit(event))
            guard let id = event.eventId, isMessage(event), !event.isRedacted, content["msgtype"] as? String == "m.audio",
                  content["org.matrix.msc3245.voice"] != nil || content["m.voice"] != nil,
                  id == rootId || event.content["io.mindroom.thread_summary"] == nil else { return nil }
            return id
        })
        // Pair each of them with its first valid trusted echo (mirroring web's planVoiceTranscripts).
        var pairedVoiceIds = Set<String>()
        var transcripts: [String: String] = [:]
        var hiddenEchoIds = Set<String>()
        for message in messages {
            // A message only: an approval card with an echo's marks stays a card.
            guard let id = message.eventId, message["type"] as? String == "m.room.message",
                  let sender = message["sender"] as? String, trustedAccounts.contains(sender),
                  message.content["io.mindroom.thread_summary"] == nil,
                  let echo = VoiceEcho.transcript(message, latestEdit: edit(message)),
                  echo.voiceEventId != id,
                  voiceIds.contains(echo.voiceEventId),
                  !pairedVoiceIds.contains(echo.voiceEventId) else { continue }
            pairedVoiceIds.insert(echo.voiceEventId)
            hiddenEchoIds.insert(id)
            if let text = echo.text { transcripts[echo.voiceEventId] = text }
        }
        let transcript = transcripts[rootId]
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
        let summary = ThreadSummary.title(from: notices)
        // Audio's body is its file's name, with the voice mark or without it.
        let title = summary ?? transcript
            ?? (isAudio(root) ? String(localized: "Voice message") : encryptedRoot ? String(localized: "Encrypted message") : rootText)

        // The conversation: what people and agents said, without folded voice echoes and titles.
        let conversation = messages.filter { message in
            !(message.eventId.map(hiddenEchoIds.contains) ?? false) && message.content["io.mindroom.thread_summary"] == nil
        }
        let isAgent = { (userId: String?) in MindRoomAgent.isAgent(userId, viewer: ownUserId) }
        let message = { (event: JSON) -> Message in
            let id = event.eventId ?? ""
            let sender = event["sender"] as? String ?? ""
            let isOwn = sender == ownUserId
            let latestEdit = edit(event)
            let content = effectiveContent(event, latestEdit: latestEdit)
            let body = content["body"] as? String ?? ""
            let run = RunState.of(event, latestEdit: latestEdit)
            let audio = isAudio(event)
            if audio {
                let spoken = transcripts[id] ?? AudioCaption.of(content) ?? ""
                return Message(eventId: id, sender: sender, isOwn: isOwn, text: spoken,
                               audio: mediaSource(content) ?? mediaSource(event.content),
                               tools: 0, run: run, toolNames: [], durationSeconds: nil,
                               workText: nil, answerText: spoken)
            }
            let details = PlainText.withToolDetails(body)
            // The calls whose lines MindRoom left out of the text, of an agent on any homeserver: main counted
            // those lines whoever sent them, and a count shows no call and trusts no one.
            let trace = MindRoomAgent.hasAgentName(sender) ? toolTraceOutOfText(content) : (names: [String](), maxBodyLine: nil as Int?)
            let totalTools = details.toolNames.count + trace.names.count
            let trustedAgent = !isOwn && !event.isRedacted && isAgent(sender)
            var toolNames: [String] = []
            var workText: String?
            var answerText = details.text
            var durationSeconds: Int?
            if trustedAgent {
                toolNames = details.toolNames + trace.names
                let streamStatus = content["io.mindroom.stream_status"] as? String
                let isFinished = run == .finished && (streamStatus == nil || streamStatus == "completed")
                if isFinished {
                    var splitWork = details.workText
                    var splitAnswer = details.answerText
                    if splitWork == nil, let maxBodyLine = trace.maxBodyLine,
                       let split = PlainText.splitFinishedWork(markdown: body, atLFLine: maxBodyLine) {
                        splitWork = split.workText
                        splitAnswer = split.answerText
                    }
                    workText = splitWork
                    answerText = workText != nil ? splitAnswer : details.text
                    if let latestEdit, event.timestamp > 0, latestEdit.timestamp > 0 {
                        let (delta, overflow) = latestEdit.timestamp.subtractingReportingOverflow(event.timestamp)
                        if !overflow && delta >= 1000 { durationSeconds = delta / 1000 }
                    }
                }
            }
            return Message(eventId: id, sender: sender, isOwn: isOwn, text: details.text,
                           audio: nil, tools: totalTools, run: run,
                           toolNames: toolNames, durationSeconds: durationSeconds,
                           workText: workText, answerText: answerText)
        }
        let reply = conversation.last { ($0["sender"] as? String) != ownUserId && isMessage($0) }.map(message)
        let cards = conversation.compactMap(ApprovalCard.parse).map { $0.applying(edits: cardEdits, now: .distantPast) }
        let decidable = cards.filter { isAgent($0.sender) && ($0.approverUserId == nil || $0.approverUserId == ownUserId) }
        // As the web client: only the newest agent reply asks (not an internal relay of a message), until
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
        let all = ([root] + conversation).compactMap { event -> Entry? in
            if let card = cards.first(where: { $0.eventId == event.eventId }) { return .approval(card) }
            return isMessage(event) ? .message(message(event)) : nil
        }
        let latestTs = ([root] + conversation).map { max($0.timestamp, edit($0)?.timestamp ?? 0) }.max() ?? root.timestamp
        return ThreadSnapshot(
            rootId: rootId, rootTs: root.timestamp, title: title,
            heading: summary ?? (all.first?.id == rootId ? nil : title), isVoiceRoot: isVoiceRoot,
            voiceFile: isVoiceRoot ? root.content["filename"] as? String ?? root.content["body"] as? String : nil,
            reply: reply, openQuestion: openQuestion, latestTs: latestTs,
            all: all, decidable: Set(decidable.map(\.eventId))).at(now)
    }
}

/// The tool calls whose marker lines are not in the content's text: MindRoom sends a reply without the line
/// "🔧 `tool_name` [n]" of each call, and with the number of lines before it on the call instead (`body_line`
/// in a tool trace of version 3, as the web client's `toolPositions.ts` reads it). A call without that number
/// had no line. A version-2 trace has every line in the text, where `PlainText` counts them.
func toolTraceOutOfText(_ content: JSON) -> (names: [String], maxBodyLine: Int?) {
    guard let trace = content["io.mindroom.tool_trace"] as? JSON, trace["version"] as? Int == 3,
          let calls = trace["events"] as? [Any] else { return ([], nil) }
    var names: [String] = []
    var maxLine: Int?
    var monotonic = true
    for case let call as JSON in calls {
        guard let name = call["tool_name"] as? String, !name.isEmpty,
              let line = call["body_line"] as? Int, line >= 0 else { continue }
        names.append(name)
        if let prev = maxLine, line < prev { monotonic = false }
        maxLine = max(maxLine ?? line, line)
    }
    return (names, monotonic ? maxLine : nil)
}

/// A media content's file as the JSON the SDK reads a media source from: `url`, or `file` with its keys in an
/// encrypted room.
func mediaSource(_ content: JSON) -> String? {
    var source: JSON = [:]
    if let file = content["file"] as? JSON { source["file"] = file } else if let url = content["url"] as? String { source["url"] = url }
    guard !source.isEmpty, let data = try? JSONSerialization.data(withJSONObject: source) else { return nil }
    return String(decoding: data, as: UTF8.self)
}

/// A thread's events as a snapshot is built from them: its root, and every event related to it.
public typealias ThreadEvents = (root: JSON, related: [JSON])

extension ThreadSnapshot {
    /// Whether a message of the thread is marked as a voice echo: no trust changes a thread without one.
    public static func hasEcho(_ events: ThreadEvents) -> Bool {
        events.related.contains { $0["type"] as? String == "m.room.message" && jsonBool($0.content[VoiceEcho.flag]) == true }
    }

    /// What to keep of a thread's events to build it again when the room's trust changes. Nothing when it has
    /// no voice echo (`hasEcho`). Else the events with, of each message's edits, only the one `build` shows
    /// (`shownEdits`; a streamed reply has an edit for each step, with all of the text so far). A card's edits
    /// all stay: a card reads each of them.
    public static func kept(_ events: ThreadEvents) -> ThreadEvents? {
        guard hasEcho(events) else { return nil }
        let isEdit = { (event: JSON) in event.replacedEventId != nil && event["type"] as? String != ApprovalCard.eventType }
        let others = events.related.filter { !isEdit($0) }
        return (events.root, others + shownEdits(of: [events.root] + others, among: events.related.filter(isEdit)).values)
    }
}

extension ThreadSnapshot {
    /// The snapshot as `build` makes it at `now`, with nothing read again: a card past its deadline is expired,
    /// the newest card still pending that this person may decide is the one that waits, and the entries have
    /// each decided card and that one. `build` ends with this; a thread that opens from a snapshot read before
    /// asks it, and Approve and Deny before they send: the network may not answer.
    public func at(_ now: Date) -> ThreadSnapshot {
        var snapshot = self
        let cards = all.compactMap { entry -> ApprovalCard? in
            guard case let .approval(card) = entry else { return nil }
            return card.applying(edits: [], now: now)
        }
        let pending = cards.last { $0.status == .pending && decidable.contains($0.eventId) }
        snapshot.approvals = cards
        snapshot.pendingApproval = pending
        snapshot.entries = all.compactMap { entry -> Entry? in
            guard case .approval = entry, let card = cards.first(where: { $0.eventId == entry.id }) else { return entry }
            return card.status != .pending || card.eventId == pending?.eventId ? .approval(card) : nil
        }
        return snapshot
    }
}

/// The edit each of `events` shows, by the event's id. As the Matrix spec and the web client: the newest edit by
/// the event's own sender that can be read (one that does not decrypt has no new content), by its time and then
/// by the greater event id (`isEventOrderedAfter`). What it does not say of a voice echo's marks, in its new
/// content or beside it, is taken from that sender's older edits, newest first (`getEditedEvent`).
func shownEdits(of events: [JSON], among edits: [JSON]) -> [String: JSON] {
    var senders: [String: String] = [:]
    for event in events { if let id = event.eventId { senders[id] = event["sender"] as? String } }
    var own: [String: [JSON]] = [:]
    for edit in edits {
        guard let target = edit.replacedEventId, let sender = senders[target], sender == edit["sender"] as? String,
              edit.newContent != nil else { continue }
        own[target, default: []].append(edit)
    }
    return own.mapValues { edits in
        let newestFirst = edits.sorted { ($0.timestamp, $0.eventId ?? "") > ($1.timestamp, $1.eventId ?? "") }
        var shown = newestFirst[0], content = shown.content, newContent = shown.newContent ?? [:]
        for mark in VoiceEcho.marks where newContent[mark] == nil && content[mark] == nil {
            newContent[mark] = newestFirst.dropFirst().lazy.compactMap { $0.newContent?[mark] ?? $0.content[mark] }.first
        }
        content["m.new_content"] = newContent
        shown["content"] = content
        return shown
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

    /// The event a push is about: the message an edit replaces, else the event itself. The homeserver names the
    /// edit that finished an agent's reply (it does not notify for the unfinished reply), not the reply.
    public static func pushedEventId(of event: JSON) -> String {
        event.replacedEventId ?? event.eventId ?? ""
    }

    /// The root of the thread an event belongs to: its `m.thread` relation, a card's `thread_id`, else itself.
    public static func threadRootId(of event: JSON) -> String {
        if event.relation?["rel_type"] as? String == "m.thread", let root = event.relation?["event_id"] as? String { return root }
        if event["type"] as? String == ApprovalCard.eventType, let root = event.content["thread_id"] as? String { return root }
        return event.eventId ?? ""
    }
}
