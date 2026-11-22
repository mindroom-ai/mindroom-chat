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
    private var refreshing = false
    private var refreshAgain = false
    private var snapshots: [String: ThreadSnapshot] = [:]
    /// What the thread list said of each thread when its snapshot was read (newest event, reply count), and when.
    private var snapshotReads: [String: (key: String, at: Date)] = [:]
    /// How long a quiet thread's snapshot stands before it is read again (edits, keys that came later).
    private static let snapshotLifetime: TimeInterval = 60
    private var resolved: ResolvedRoots
    /// Whether this model writes `ResolvedCache`: the one the app shows does. The background refresh's own model
    /// only reads it, so that neither overwrites what the other resolved.
    private let persistsResolved: Bool
    private var stateRead: Task<Void, Never>?
    /// The thread rows by root, kept when the list cannot be read (offline): what the list says of a thread
    /// (`ThreadListEntry`) until the thread has been read, then its snapshot's row.
    private var threadRows: [String: ThreadRow] = [:]
    /// The person's messages nobody answered, as the last refresh found them.
    private var unanswered: [ThreadRow] = []
    /// The event ids of the messages this watch sent since the model started.
    private var sentHere: Set<String> = []
    private let client: Client
    private let session: Session?

    init(room: Room, userId: String, client: Client, persistsResolved: Bool = true) {
        self.room = room
        self.userId = userId
        self.client = client
        self.persistsResolved = persistsResolved
        session = try? client.session()
        roomName = room.displayName() ?? room.id()
        resolved = ResolvedRoots(ResolvedCache.get(userId: userId, roomId: room.id()))
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
            resolved.resolve(rootId)
            if persistsResolved { ResolvedCache.set(resolved.roots, userId: userId, roomId: room.id()) }
            threadRows[rootId] = nil
            unanswered.removeAll { $0.rootId == rootId }
            // Shows the rows without it now, and reads the room's state again: a read that began before the tag
            // was there does not bring the thread back (`ResolvedRoots`).
            scheduleRefresh()
        } catch {
            log.error("resolve failed: \(String(describing: error), privacy: .public)")
        }
    }

    func snapshot(of rootId: String) -> ThreadSnapshot? { snapshots[rootId] }

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

    /// The room came to the front: the next refresh reads the room's state again.
    func foregrounded() { resolved.expire() }

    /// Reads the threads now (background refresh). Nobody waits for rows there, so the room's state is read
    /// first: the complications count the threads that are open now.
    func refreshNow() async {
        readStateIfDue()
        await stateRead?.value
        await refresh()
    }

    /// Reads the room's state for its resolved threads when that is due (`ResolvedRoots`), one read at a time.
    private func readStateIfDue() {
        guard resolved.isDue(now: Date()) else { return }
        resolved.beginRead(now: Date())
        stateRead = Task {
            let before = resolved.roots
            let read = await resolvedRoots()
            resolved.endRead(read)
            guard resolved.roots != before else { return }
            if persistsResolved { ResolvedCache.set(resolved.roots, userId: userId, roomId: room.id()) }
            threadRows = threadRows.filter { !resolved.roots.contains($0.key) }
            show()
            // The threads resolved elsewhere left the list short, and one opened again is not in it: the list
            // is read once more after this refresh.
            refreshAgain = true
        }
    }

    /// A row is what `/threads` says until its thread has been read; after that it is exactly the
    /// `ThreadSnapshot` of the thread's full fetch, read again by the same rule as ever. Only the order and the
    /// time of showing differ from reading every thread first: rows show with the list's first page, before
    /// anything else is read, and then thread by thread, newest first (a long thread is megabytes).
    private func refresh() async {
        // Left, or replaced by a new version of the room: the person picks another.
        if room.membership() != .joined || room.successorRoom() != nil { gone = true; return }
        var entries: [ThreadListEntry] = []
        var listed = Set<String>()
        var from: String?
        var complete = true
        // Resolved threads do not count: read a few more pages while they fill the first one.
        for page in 0...3 {
            guard let result = try? await room.threadsJsonPage(from: from, limit: UInt32(Self.pageSize)) else {
                // Offline the list cannot be read: keep its rows (and the widget) as they were, with the person's
                // own messages, queued or failed, kept current.
                if page == 0 { show(); return }
                complete = false
                break
            }
            for json in result.roots {
                guard let entry = parse(json).flatMap({ ThreadListEntry.parse($0, ownUserId: userId) }),
                      listed.insert(entry.rootId).inserted, !resolved.roots.contains(entry.rootId) else { continue }
                entries.append(entry)
                // A thread read before keeps that row until it is read again.
                threadRows[entry.rootId] = snapshots[entry.rootId].map { row($0) } ?? row(entry)
            }
            show()
            if page == 0 {
                #if DEBUG
                E2EHooks.log("refresh painted rows=\(rows.count)")
                #endif
                // Not before the first rows show.
                readStateIfDue()
            }
            from = result.nextBatch
            if from == nil || entries.filter({ !resolved.roots.contains($0.rootId) }).count >= Self.pageSize { break }
        }
        let items = entries.filter { !resolved.roots.contains($0.rootId) }.prefix(Self.pageSize)
        // Only a list read without a failure (to its end, to 30 open threads or to the last page) says which
        // threads are no longer in it.
        if complete {
            let roots = Set(items.map(\.rootId))
            threadRows = threadRows.filter { roots.contains($0.key) }
            show()
        }
        for item in items.sorted(by: { $0.latestTs > $1.latestTs }) {
            let rootId = item.rootId
            let key = item.key
            // Resolved while the threads before it were read.
            if resolved.roots.contains(rootId) { continue }
            // A thread nothing new happened in keeps its snapshot for a minute, unless it streams or waits for
            // the person (edits and reactions do not show in the list).
            if let cached = snapshots[rootId], let read = snapshotReads[rootId], read.key == key,
               Date().timeIntervalSince(read.at) < Self.snapshotLifetime,
               ![.running, .needsYou].contains(cached.rowState) {
                continue
            }
            // A thread that cannot be read keeps its row.
            if let jsons = try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId),
               let root = jsons.first.flatMap(parse) {
                let related = jsons.dropFirst().compactMap(parse)
                let snapshot = ThreadSnapshot.build(root: root, related: related, ownUserId: userId, now: Date())
                snapshots[rootId] = snapshot
                snapshotReads[rootId] = (key, Date())
                if let reply = snapshot.reply { await learnNames([reply.sender] + PlainText.mentionedUserIds(reply.text)) }
                if resolved.roots.contains(rootId) { continue }
                threadRows[rootId] = row(snapshot)
                show()
                #if DEBUG
                E2EHooks.log("hydrated \(rootId) \(String(describing: snapshot.rowState)) \(snapshot.title) | \(row(snapshot).line)")
                #endif
            }
        }
        // The complications count what the threads' own reads found, without the threads the state resolves.
        await stateRead?.value
        show()
        publishWidgetSnapshot()
        #if DEBUG
        E2EHooks.log("refresh done rows=\(rows.count)")
        #endif
    }

    /// Shows the thread rows as they are now, with the person's messages that nobody answered.
    private func show() {
        unanswered = ownRows(sentHere: false, notIn: Set(threadRows.keys).union(resolved.roots))
        publish()
    }

    /// Shows the threads and the person's unanswered messages as the last refresh found them, and with them the
    /// messages this watch is sending or sent since it started, as the room's timeline has them now. A refresh
    /// takes several requests: a message just recorded shows at once, and stays until the thread list has its
    /// thread.
    private func publish() {
        for item in feed.events {
            if case let .sent(eventId) = item.localSendState { sentHere.insert(eventId) }
        }
        let own = unanswered + ownRows(sentHere: true, notIn: Set(threadRows.keys).union(resolved.roots))
        // By id where the times are equal: the thread rows come in no order.
        let rows = (Array(threadRows.values) + own).sorted { ($0.ts, $0.id) > ($1.ts, $1.id) }
        if rows != self.rows { self.rows = rows }
    }

    private func line(_ reply: ThreadSnapshot.Message?) -> String {
        guard let reply else { return String(localized: "Sent") }
        let text = reply.isVoiceOnly ? String(localized: "Voice message") : reply.text.isEmpty ? "…" : named(reply.text)
        return "\(name(reply.sender)): \(text)"
    }

    private func row(_ snapshot: ThreadSnapshot) -> ThreadRow {
        ThreadRow(id: snapshot.rootId, rootId: snapshot.rootId, title: snapshot.title, line: line(snapshot.reply),
                  state: snapshot.rowState, ts: snapshot.latestTs,
                  rootTs: snapshot.rootTs, voiceFile: snapshot.voiceFile)
    }

    /// The row of a thread not read yet. What it waits for or whether it runs only the thread's own read says:
    /// until then the row says how old it is.
    private func row(_ entry: ThreadListEntry) -> ThreadRow {
        ThreadRow(id: entry.rootId, rootId: entry.rootId, title: entry.title, line: line(entry.reply),
                  state: .idle(Date(timeIntervalSince1970: Double(entry.latestTs) / 1000)), ts: entry.latestTs,
                  rootTs: entry.rootTs, voiceFile: entry.voiceFile)
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

    /// The thread tags and pinned events in the room's state, in one request (state events are not encrypted);
    /// nil when it could not be read.
    private func resolvedRoots() async -> Set<String>? {
        guard let session, let base = URL(string: session.homeserverUrl) else { return nil }
        let roomId = room.id().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "!:/"))) ?? room.id()
        guard let url = URL(string: "\(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/_matrix/client/v3/rooms/\(roomId)/state") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        #if DEBUG
        E2EHooks.log("http GET \(url.path)")
        #endif
        guard let (data, response) = try? await URLSession.shared.data(for: request) else { return nil }
        #if DEBUG
        E2EHooks.log("http done \(url.path) \(data.count)")
        #endif
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let state = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return nil }
        return ThreadTags.resolvedRoots(state: state)
    }
}

enum RoomModelError: Error {
    case notReady
}
