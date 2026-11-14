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
    /// The person sent the root (a message of theirs, which Send follows).
    let ownRoot: Bool
}

/// The default room: its threads (and the user's own messages nobody answered yet), new voice
/// messages, resolving.
@MainActor
final class RoomModel: ObservableObject {
    static let pageSize = 30

    let room: Room
    let userId: String
    let roomName: String
    @Published private(set) var rows: [ThreadRow] = []
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
    /// What the thread list said of each thread when its snapshot was read (newest event, reply count), and when.
    private var snapshotReads: [String: (key: String, at: Date)] = [:]
    /// How long a quiet thread's snapshot stands before it is read again (edits, keys that came later).
    private static let snapshotLifetime: TimeInterval = 60
    private var resolved: Set<String> = []
    /// The thread rows as last read from the server, kept when the list cannot be read (offline).
    private var threadRows: [ThreadRow] = []
    private var threadRoots: [String] = []
    private let session: Session?

    init(room: Room, userId: String, session: Session?) {
        self.room = room
        self.userId = userId
        self.session = session
        roomName = room.displayName() ?? room.id()
        threads = room.threadListService()
        weak var model: RoomModel?
        feed = TimelineFeed { model?.scheduleRefresh() }
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

    /// Drops a message that could not be sent, which also frees the room's queue behind it. (A failure the
    /// SDK can recover from, such as no network, it retries by itself.)
    func discard(transactionId: String) async {
        try? await timeline?.redactEvent(eventOrTransactionId: .transactionId(transactionId: transactionId), reason: nil)
        scheduleRefresh()
    }

    func resolve(_ rootId: String) async {
        let content = ThreadTags.resolvedContent(userId: userId, at: Date())
        guard let data = try? JSONSerialization.data(withJSONObject: content) else { return }
        do {
            _ = try await room.sendStateEventRaw(eventType: ThreadTags.eventType, stateKey: ThreadTags.resolvedStateKey(root: rootId),
                                                 content: String(decoding: data, as: UTF8.self))
            rows.removeAll { $0.rootId == rootId }
        } catch {
            log.error("resolve failed: \(String(describing: error), privacy: .public)")
        }
    }

    func snapshot(of rootId: String) -> ThreadSnapshot? { snapshots[rootId] }

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
            rows = (threadRows + ownUnansweredRoots(excluding: Set(threadRoots).union(resolved))).sorted { $0.ts > $1.ts }
            return
        }
        if let resolved = await resolvedRoots() { self.resolved = resolved }
        // Resolved threads do not count: read a few more pages while they fill the first one.
        for _ in 0..<3 {
            let open = threads.items().filter { !resolved.contains($0.rootEvent.eventId) }.count
            guard open < Self.pageSize, threads.paginationState() != .idle(endReached: true) else { break }
            do { try await threads.paginate() } catch { break }
        }
        let items = threads.items().filter { !resolved.contains($0.rootEvent.eventId) }.prefix(Self.pageSize)
        let roots = items.map(\.rootEvent.eventId)
        var rows: [ThreadRow] = []
        for item in items {
            let rootId = item.rootEvent.eventId
            let key = "\(item.latestEvent?.eventId ?? rootId) \(item.numReplies)"
            // A thread nothing new happened in keeps its snapshot for a minute, unless it streams or waits for
            // the person (edits and reactions do not show in the list).
            if let cached = snapshots[rootId], let read = snapshotReads[rootId], read.key == key,
               Date().timeIntervalSince(read.at) < Self.snapshotLifetime,
               ![.running, .needsYou].contains(cached.rowState(lastSeenEventId: nil)) {
                rows.append(row(cached))
                continue
            }
            if let jsons = try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId),
               let root = jsons.first.flatMap(parse) {
                let related = jsons.dropFirst().compactMap(parse)
                let snapshot = ThreadSnapshot.build(root: root, related: related, ownUserId: userId, now: Date())
                snapshots[rootId] = snapshot
                snapshotReads[rootId] = (key, Date())
                if let reply = snapshot.reply { await learnNames([reply.sender] + PlainText.mentionedUserIds(reply.text)) }
                rows.append(row(snapshot))
            } else if let cached = snapshots[rootId] {
                rows.append(row(cached))
            }
        }
        threadRows = rows
        threadRoots = roots
        rows += ownUnansweredRoots(excluding: Set(roots).union(resolved))
        self.rows = rows.sorted { $0.ts > $1.ts }
        publishWidgetSnapshot()
        #if DEBUG
        for row in self.rows.prefix(3) { E2EHooks.log("row \(row.rootId ?? row.id) \(String(describing: row.state))") }
        #endif
    }

    private func row(_ snapshot: ThreadSnapshot) -> ThreadRow {
        let line: String
        if let reply = snapshot.reply {
            line = "\(name(reply.sender)): \(reply.text.isEmpty ? "…" : named(reply.text))"
        } else {
            line = String(localized: "Sent")
        }
        return ThreadRow(id: snapshot.rootId, rootId: snapshot.rootId, title: snapshot.title, line: line,
                         state: snapshot.rowState(lastSeenEventId: SeenStore.lastSeen(snapshot.rootId)), ts: snapshot.latestTs,
                         rootTs: snapshot.rootTs, ownRoot: snapshot.rootFromMe)
    }

    /// The user's own messages in the room that no thread holds yet: a voice message just sent,
    /// still sending, or failed.
    private func ownUnansweredRoots(excluding roots: Set<String>) -> [ThreadRow] {
        feed.events.suffix(20).compactMap { item -> ThreadRow? in
            guard item.isOwn, case let .msgLike(content) = item.content, content.threadRoot == nil,
                  content.threadSummary == nil, case let .message(message) = content.kind else { return nil }
            var id = ""
            var rootId: String?
            switch item.eventOrTransactionId {
            case let .eventId(eventId): id = eventId; rootId = eventId
            case let .transactionId(transactionId): id = transactionId
            }
            if let rootId, roots.contains(rootId) { return nil }
            var queued = false, failed = false
            switch item.localSendState {
            case .notSentYet: queued = true
            // The SDK retries a recoverable failure (no network) by itself: still queued.
            case let .sendingFailed(_, isRecoverable): if isRecoverable { queued = true } else { failed = true }
            default: break
            }
            let isVoice: Bool
            if case .audio = message.msgType { isVoice = true } else { isVoice = false }
            let title = isVoice ? String(localized: "Voice message") : PlainText.of(markdown: message.body)
            let state: ThreadRowState = failed ? .failed : queued ? .queued : .idle(Date(timeIntervalSince1970: Double(item.timestamp) / 1000))
            return ThreadRow(id: id, rootId: rootId, title: title, line: String(localized: "Sent"), state: state,
                             ts: Int(item.timestamp), rootTs: Int(item.timestamp), ownRoot: true)
        }
    }

    /// The thread tags and pinned events in the room's state: one request per refresh (state events are not
    /// encrypted); nil when it could not be read.
    private func resolvedRoots() async -> Set<String>? {
        guard let session, let base = URL(string: session.homeserverUrl) else { return nil }
        let roomId = room.id().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "!:/"))) ?? room.id()
        guard let url = URL(string: "\(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/_matrix/client/v3/rooms/\(roomId)/state") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let state = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return nil }
        return ThreadTags.resolvedRoots(state: state)
    }
}

enum RoomModelError: Error {
    case notReady
}
