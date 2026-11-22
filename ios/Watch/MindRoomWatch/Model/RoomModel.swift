import Combine
import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import os

private let log = Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "room")

/// One row of the threads list.
struct ThreadRow: Identifiable, Equatable {
    /// The root's event id, or the transaction id of a message still on its way.
    let id: String
    let rootId: String?
    let title: String
    let line: String
    let state: ThreadRowState
    let ts: Int
    /// When the root was sent.
    let rootTs: Int
    /// A voice root's file name: Send follows its own recording by it.
    let voiceFile: String?
}

/// The default room: its threads (and the user's own messages nobody answered yet), new voice
/// messages, resolving.
@MainActor
final class RoomModel: ObservableObject {
    static let pageSize = 30

    let room: Room
    let userId: String
    let roomName: String
    @Published private(set) var rows: [ThreadRow] = [] {
        didSet {
            #if DEBUG
            for row in rows.prefix(3) { E2EHooks.log("row \(row.rootId ?? row.id) \(String(describing: row.state)) \(row.voiceFile ?? "")") }
            #endif
        }
    }
    @Published private(set) var gone = false
    /// Display names of the room's members met so far.
    @Published private(set) var names: [String: String] = [:]
    private var timeline: Timeline?
    private let feed: TimelineFeed
    private var handles: [TaskHandle] = []
    private var threads: ThreadListService
    private var refreshing = false
    private var refreshAgain = false
    private var snapshots: [String: ThreadSnapshot] = [:]
    /// What is kept of the events of each listed thread with a voice echo (`ThreadSnapshot.kept`): its snapshot
    /// is built again from them when the room's trust changes. No trust changes the other threads.
    private var keptEvents: [String: ThreadEvents] = [:]
    /// What the thread list said of each thread when its snapshot was read (newest event, reply count), and when.
    private var snapshotReads: [String: (key: String, at: Date)] = [:]
    /// How long a quiet thread's snapshot stands before it is read again (edits, keys that came later).
    private static let snapshotLifetime: TimeInterval = 60
    /// The room's trusted accounts and resolved threads, of one read of its state.
    private let trust: RoomTrust
    private var resolved: Set<String> { trust.resolved }
    private var trustChanges: AnyCancellable?
    /// The thread rows as last read from the server, kept when the list cannot be read (offline).
    private var threadRows: [ThreadRow] = []
    private var threadRoots: [String] = []
    /// The person's messages nobody answered, as the last refresh found them.
    private var unanswered: [ThreadRow] = []
    /// The event ids of the messages this watch sent since the model started.
    private var sentHere: Set<String> = []
    private let client: Client

    init(room: Room, userId: String, client: Client) {
        self.room = room
        self.userId = userId
        self.client = client
        trust = RoomTrust.of(room.id())
        roomName = room.displayName() ?? room.id()
        threads = room.threadListService()
        weak var model: RoomModel?
        feed = TimelineFeed { model?.scheduleRefresh() }
        trustChanges = trust.changed.sink { model?.trustChanged() }
        model = self
    }

    func start() async {
        guard timeline == nil else { return }
        do {
            let timeline = try await mindroomTimeline(room, focus: .live(hideThreadedEvents: true))
            self.timeline = timeline
            // Thread replies change their root's summary in this timeline, so it also signals thread changes.
            handles.append(await timeline.addListener(listener: feed))
            _ = try? await timeline.paginateBackwards(numEvents: 30)
            #if DEBUG
            Task { await E2EHooks.send(on: timeline) }
            #endif
        } catch {
            log.error("timeline failed: \(String(describing: error), privacy: .public)")
        }
        scheduleRefresh()
    }

    func sendVoice(_ take: Take) async throws {
        guard let timeline else { throw RoomModelError.notReady }
        try await sendVoiceMessage(take, on: timeline)
    }

    /// Drops a message that could not be sent and turns the room's queue, which any failed send stops,
    /// back on for the messages behind it. (A failure the SDK can recover from, such as no network, it
    /// retries by itself.)
    func discard(transactionId: String) async {
        try? await timeline?.redactEvent(eventOrTransactionId: .transactionId(transactionId: transactionId), reason: nil)
        room.enableSendQueue(enable: true)
        scheduleRefresh()
    }

    func resolve(_ rootId: String) async {
        let content = ThreadTags.resolvedContent(userId: userId, at: Date())
        guard let data = try? JSONSerialization.data(withJSONObject: content) else { return }
        do {
            _ = try await room.sendStateEventRaw(eventType: ThreadTags.eventType, stateKey: ThreadTags.resolvedStateKey(root: rootId),
                                                 content: String(decoding: data, as: UTF8.self))
            trust.resolve(rootId)
            threadRows.removeAll { $0.rootId == rootId }
            unanswered.removeAll { $0.rootId == rootId }
            // Shows the rows without it now. A refresh that read the room's state before the tag was there
            // would bring the thread back.
            scheduleRefresh()
        } catch {
            log.error("resolve failed: \(String(describing: error), privacy: .public)")
        }
    }

    func snapshot(of rootId: String) -> ThreadSnapshot? { snapshots[rootId] }

    /// What is kept of a listed thread's events: its screen builds the thread again from them when the room's
    /// trust changes before it read the thread itself.
    func events(of rootId: String) -> ThreadEvents? { keptEvents[rootId] }

    /// Reads the room's trust again unless a read began in the last 30 s. An open thread asks every 5 s and
    /// does not wait: `RoomTrust.changed` tells it, and this list, when the trust is another.
    func refreshTrust() {
        Task { await trust.refresh(ifOlderThan: 30) { [client, room] in await roomState(client, roomId: room.id()) } }
    }

    /// The room's trust changed: the listed threads with a voice echo are built again from the events kept, and
    /// shown. A refresh under way goes on with these snapshots. The complication follows only rows that
    /// changed: a model that has read no list yet has none, and leaves the last counts as they are.
    private func trustChanged() {
        let before = threadRows
        for (rootId, events) in keptEvents { snapshots[rootId] = threadSnapshot(events, trust: trust, userId: userId) }
        threadRows = threadRows.map { shown in shown.rootId.flatMap { snapshots[$0] }.map(row) ?? shown }
        publish()
        if threadRows != before { publishWidgetSnapshot() }
    }

    /// A voice message's audio (`ThreadSnapshot.Message.audio`), decrypted.
    func audio(_ source: String) async throws -> Data {
        try await client.getMediaContent(mediaSource: MediaSource.fromJson(json: source))
    }

    func name(_ userId: String) -> String { names[userId] ?? agentName(userId) }

    /// Plain text with the user ids in it shown as names.
    func named(_ text: String) -> String { PlainText.replacingMentions(text, names: names) }

    /// Looks up the display names of these users that are not known yet.
    func learnNames(_ userIds: [String]) async {
        for userId in Set(userIds) where names[userId] == nil {
            if let name = try? await room.memberDisplayName(userId: userId), !name.isEmpty { names[userId] = name }
        }
    }

    func scheduleRefresh() {
        publish()
        if refreshing { refreshAgain = true; return }
        refreshing = true
        Task {
            repeat {
                refreshAgain = false
                // Coalesces a burst of changes (a streaming reply edits many times a second).
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await refresh()
            } while refreshAgain
            refreshing = false
        }
    }

    /// Reads the threads now (background refresh).
    func refreshNow() async { await refresh() }

    private func refresh() async {
        // Left, or replaced by a new version of the room: the person picks another.
        if room.membership() != .joined || room.successorRoom() != nil { gone = true; return }
        await threads.reset()
        // Offline the list cannot be read: keep its rows (and the widget) as they were, with the person's own
        // messages, queued or failed, kept current.
        do { try await threads.paginate() } catch {
            unanswered = ownRows(sentHere: false, notIn: Set(threadRoots).union(resolved))
            publish()
            return
        }
        // One request for the room's state per refresh. The resolved tags and the trust are those of the newest
        // read that succeeded, this one or another caller's; when none does, they stay as they were.
        await trust.refresh { [client, room] in await roomState(client, roomId: room.id()) }
        // Resolved threads do not count: read a few more pages while they fill the first one.
        for _ in 0..<3 {
            let open = threads.items().filter { !resolved.contains($0.rootEvent.eventId) }.count
            guard open < Self.pageSize, threads.paginationState() != .idle(endReached: true) else { break }
            do { try await threads.paginate() } catch { break }
        }
        let items = threads.items().filter { !resolved.contains($0.rootEvent.eventId) }.prefix(Self.pageSize)
        let roots = items.map(\.rootEvent.eventId)
        for item in items {
            let rootId = item.rootEvent.eventId
            let key = "\(item.latestEvent?.eventId ?? rootId) \(item.numReplies)"
            // A thread nothing new happened in keeps its snapshot for a minute, unless it streams or waits for
            // the person (edits and reactions do not show in the list).
            if let cached = snapshots[rootId], let read = snapshotReads[rootId], read.key == key,
               Date().timeIntervalSince(read.at) < Self.snapshotLifetime,
               ![.running, .needsYou].contains(cached.rowState) {
                continue
            }
            if let read = try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId), let events = threadEvents(read) {
                let snapshot = threadSnapshot(events, trust: trust, userId: userId)
                snapshots[rootId] = snapshot
                keptEvents[rootId] = ThreadSnapshot.kept(events)
                snapshotReads[rootId] = (key, Date())
                if let reply = snapshot.reply { await learnNames([reply.sender] + PlainText.mentionedUserIds(reply.text)) }
            }
        }
        // Only the listed threads keep their snapshot and events. The rows are of the snapshots as they are
        // now: `trustChanged` built those read before the room's trust changed again. A thread that could not
        // be read keeps its last snapshot.
        snapshots = snapshots.filter { roots.contains($0.key) }
        keptEvents = keptEvents.filter { roots.contains($0.key) }
        threadRows = roots.compactMap { snapshots[$0] }.map(row)
        threadRoots = roots
        unanswered = ownRows(sentHere: false, notIn: Set(roots).union(resolved))
        publish()
        publishWidgetSnapshot()
    }

    /// Shows the threads and the person's unanswered messages as the last refresh found them, and with them the
    /// messages this watch is sending or sent since it started, as the room's timeline has them now. A refresh
    /// takes several requests: a message just recorded shows at once, and stays until the thread list has its
    /// thread.
    private func publish() {
        for item in feed.events {
            if case let .sent(eventId) = item.localSendState { sentHere.insert(eventId) }
        }
        let own = unanswered + ownRows(sentHere: true, notIn: Set(threadRoots).union(resolved))
        let rows = (threadRows + own).sorted { $0.ts > $1.ts }
        if rows != self.rows { self.rows = rows }
    }

    private func row(_ snapshot: ThreadSnapshot) -> ThreadRow {
        let line: String
        if let reply = snapshot.reply {
            let text = reply.isVoiceOnly ? String(localized: "Voice message") : reply.text.isEmpty ? "…" : named(reply.text)
            line = "\(name(reply.sender)): \(text)"
        } else {
            line = String(localized: "Sent")
        }
        return ThreadRow(id: snapshot.rootId, rootId: snapshot.rootId, title: snapshot.title, line: line,
                         state: snapshot.rowState, ts: snapshot.latestTs,
                         rootTs: snapshot.rootTs, voiceFile: snapshot.voiceFile)
    }

    /// The user's own messages in the room that none of these threads holds, as rows. With `sentHere`: the ones
    /// this watch is sending or sent since the model started, answered or not (one still to send always shows,
    /// with its Delete: a message the server refused holds up every message queued behind it). Without: the
    /// others that nobody answered, among the newest 20 events.
    private func ownRows(sentHere wanted: Bool, notIn roots: Set<String>) -> [ThreadRow] {
        let events = feed.events
        return events.enumerated().compactMap { index, item -> ThreadRow? in
            guard item.isOwn, case let .msgLike(content) = item.content, content.threadRoot == nil,
                  case let .message(message) = content.kind else { return nil }
            var id = ""
            var rootId: String?
            switch item.eventOrTransactionId {
            case let .eventId(eventId): id = eventId; rootId = eventId
            case let .transactionId(transactionId): id = transactionId
            }
            guard (item.localSendState != nil || sentHere.contains(id)) == wanted,
                  !(rootId.map(roots.contains) ?? false) else { return nil }
            if !wanted, content.threadSummary != nil || index < events.count - 20 { return nil }
            var queued = false, failed = false
            switch item.localSendState {
            case .notSentYet: queued = true
            // The SDK retries a recoverable failure (no network) by itself: still queued.
            case let .sendingFailed(_, isRecoverable): if isRecoverable { queued = true } else { failed = true }
            default: break
            }
            var voiceFile: String?
            if case let .audio(audio) = message.msgType { voiceFile = audio.filename }
            let title = voiceFile != nil ? String(localized: "Voice message") : PlainText.of(markdown: message.body)
            let state: ThreadRowState = failed ? .failed : queued ? .queued : .idle(Date(timeIntervalSince1970: Double(item.timestamp) / 1000))
            return ThreadRow(id: id, rootId: rootId, title: title, line: String(localized: "Sent"), state: state,
                             ts: Int(item.timestamp), rootTs: Int(item.timestamp), voiceFile: voiceFile)
        }
    }
}

/// A room's state events (they are not encrypted) in one request, which gives up when nothing arrives for
/// 10 s; nil when they could not be read.
@MainActor
func roomState(_ client: Client, roomId: String) async -> [JSON]? {
    guard let session = try? client.session(), let base = URL(string: session.homeserverUrl) else { return nil }
    let roomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "!:/"))) ?? roomId
    guard let url = URL(string: "\(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/_matrix/client/v3/rooms/\(roomId)/state") else { return nil }
    var request = URLRequest(url: url, timeoutInterval: 10)
    request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let state = try? JSONSerialization.jsonObject(with: data) as? [JSON] else { return nil }
    return state
}

/// A thread's events from the JSON the SDK read them as: its root, then every event related to it.
func threadEvents(_ jsons: [String]) -> ThreadEvents? {
    guard let root = jsons.first.flatMap(parse) else { return nil }
    return (root, jsons.dropFirst().compactMap(parse))
}

/// A thread as the watch shows it, built with the room's trust as it is at this moment: the threads list, an
/// open thread and a notification all build here, so they fold the same voice echoes.
@MainActor
func threadSnapshot(_ events: ThreadEvents, trust: RoomTrust, userId: String) -> ThreadSnapshot {
    ThreadSnapshot.build(root: events.root, related: events.related, ownUserId: userId, now: Date(), trustedAccounts: trust.accounts)
}

enum RoomModelError: Error {
    case notReady
}
