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
    private static let firstThreadsPageSize: UInt32 = 10
    private static let nextThreadsPageSize: UInt32 = 20
    private static let maxExtraThreadsPages = 5
    private static let hydrationPageSize: UInt32 = 20
    private static let approvalPageSize: UInt32 = 10
    private static let headTitlePageSize: UInt32 = 10
    private static let reactionsPageSize: UInt32 = 50

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
    /// What `/threads` said of each thread when its snapshot was read (latest event, count, bundled edits), and when.
    private var snapshotReads: [String: (key: String, at: Date)] = [:]
    /// How long a quiet thread's snapshot stands before it is read again (edits, keys that came later).
    private static let snapshotLifetime: TimeInterval = 60
    /// Minimum interval between background `/state` refreshes; also refreshed when the app comes to the front.
    private static let stateLifetime: TimeInterval = 5 * 60
    private var lastStateRead: Date?
    private var stateTask: Task<Void, Never>?
    private var stateGeneration = 0
    private var locallyResolvedSinceState: Set<String> = []
    private var resolved: Set<String>
    private var cachedTitles: [String: String]
    /// Threads whose head page (`forward: true`) has already been read once to look for early titles/transcripts.
    private var headFetchedRoots: Set<String> = []
    /// The thread rows as last read from the server, kept when the list cannot be read (offline).
    private var threadRows: [ThreadRow] = []
    private var threadRoots: [String] = []
    /// The person's messages nobody answered, as the last refresh found them.
    private var unanswered: [ThreadRow] = []
    /// The event ids of the messages this watch sent since the model started.
    private var sentHere: Set<String> = []
    private let client: Client
    private let session: Session?

    init(room: Room, userId: String, client: Client) {
        self.room = room
        self.userId = userId
        self.client = client
        session = try? client.session()
        roomName = room.displayName() ?? room.id()
        resolved = ResolvedCache.get(userId: userId, roomId: room.id())
        cachedTitles = ThreadTitleCache.all(userId: userId, roomId: room.id())
        weak var model: RoomModel?
        feed = TimelineFeed { model?.scheduleRefresh() }
        model = self
    }

    deinit {
        stateTask?.cancel()
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

    /// Called when the room comes to the front: refreshes `/state` concurrently and schedules a thread list refresh.
    func foregrounded() {
        refreshStateIfNeeded(force: true)
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
            stateGeneration += 1
            locallyResolvedSinceState.insert(rootId)
            resolved.insert(rootId)
            ResolvedCache.set(resolved, userId: userId, roomId: room.id())
            threadRows.removeAll { $0.rootId == rootId }
            threadRoots.removeAll { $0 == rootId }
            unanswered.removeAll { $0.rootId == rootId }
            // Shows the rows without it now. A refresh that read the room's state before the tag was there
            // would bring the thread back.
            publish()
            publishWidgetSnapshot()
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

    /// Reads the threads now (background refresh).
    func refreshNow() async { await refresh() }

    private func rememberTitle(_ title: String, for rootId: String) {
        guard !title.isEmpty, cachedTitles[rootId] != title else { return }
        cachedTitles[rootId] = title
        ThreadTitleCache.set(title, userId: userId, roomId: room.id(), rootId: rootId)
    }

    /// Starts a concurrent `/state` read when due (every 5 minutes or on foregrounding), never blocking first paint.
    private func refreshStateIfNeeded(force: Bool) {
        guard stateTask == nil else { return }
        if let last = lastStateRead {
            let elapsed = Date().timeIntervalSince(last)
            if force {
                guard elapsed >= 5 else { return }
            } else {
                guard elapsed >= Self.stateLifetime else { return }
            }
        }
        let startedGen = stateGeneration
        locallyResolvedSinceState = []
        stateTask = Task { [weak self] in
            guard let self else { return }
            let started = Date()
            let result = await self.resolvedRoots()
            self.stateTask = nil
            guard let (fetched, stateBytes) = result else { return }
            let merged = startedGen == self.stateGeneration ? fetched : fetched.union(self.locallyResolvedSinceState)
            self.resolved = merged
            ResolvedCache.set(merged, userId: self.userId, roomId: self.room.id())
            self.lastStateRead = Date()
            if !merged.isEmpty {
                self.threadRows.removeAll { row in row.rootId.map(merged.contains) ?? false }
                self.threadRoots.removeAll { merged.contains($0) }
                self.unanswered.removeAll { row in row.rootId.map(merged.contains) ?? false }
                self.publish()
                self.publishWidgetSnapshot()
            }
            #if DEBUG
            let stateMs = Int(Date().timeIntervalSince(started) * 1000)
            E2EHooks.log("state done \(stateMs)ms bytes=\(stateBytes) resolved=\(merged.count)")
            #endif
        }
    }

    private func refresh() async {
        // Left, or replaced by a new version of the room: the person picks another.
        if room.membership() != .joined || room.successorRoom() != nil { gone = true; return }
        refreshStateIfNeeded(force: false)

        let started = Date()
        var requests = 0
        var bytes = 0

        // First page of /threads: publish provisional rows immediately before any relation, name, or /state read.
        let firstPage: ThreadsJsonPage
        do {
            firstPage = try await room.threadsJsonPage(from: nil, limit: Self.firstThreadsPageSize)
            requests += 1
            bytes += firstPage.roots.reduce(0) { $0 + $1.utf8.count }
        } catch {
            // Offline the list cannot be read: keep its rows (and the widget) as they were, with the person's own
            // messages, queued or failed, kept current.
            unanswered = ownRows(sentHere: false, notIn: Set(threadRoots).union(resolved))
            publish()
            return
        }

        var seenRoots = Set<String>()
        var openEntries: [ThreadListEntry] = []
        var rowsByRoot: [String: ThreadRow] = [:]

        func ingest(_ roots: [String]) {
            for json in roots {
                guard let parsed = parse(json), let entry = ThreadListEntry.parse(parsed),
                      seenRoots.insert(entry.rootId).inserted else { continue }
                if let serverTitle = entry.serverTitle { rememberTitle(serverTitle, for: entry.rootId) }
                guard !resolved.contains(entry.rootId) else { continue }
                openEntries.append(entry)
                if let cached = snapshots[entry.rootId], snapshotReads[entry.rootId]?.key == entry.cacheKey {
                    rowsByRoot[entry.rootId] = row(cached)
                } else {
                    rowsByRoot[entry.rootId] = provisionalRow(entry)
                }
            }
        }

        func publishCurrent() {
            let active = openEntries.prefix(Self.pageSize).filter { !resolved.contains($0.rootId) }
            threadRoots = active.map(\.rootId)
            threadRows = active.compactMap { rowsByRoot[$0.rootId] }
            unanswered = ownRows(sentHere: false, notIn: Set(threadRoots).union(resolved))
            publish()
        }

        ingest(firstPage.roots)
        publishCurrent()

        #if DEBUG
        let firstPaintMs = Int(Date().timeIntervalSince(started) * 1000)
        E2EHooks.log("refresh first-paint \(firstPaintMs)ms rows=\(rows.count) reqs=\(requests) bytes=\(bytes)")
        #endif

        // Read further pages of /threads until we have 30 open threads, publishing each time.
        var nextBatch = firstPage.nextBatch
        var extraPages = 0
        while openEntries.filter({ !resolved.contains($0.rootId) }).count < Self.pageSize,
              let token = nextBatch, extraPages < Self.maxExtraThreadsPages {
            extraPages += 1
            guard let page = try? await room.threadsJsonPage(from: token, limit: Self.nextThreadsPageSize) else { break }
            requests += 1
            bytes += page.roots.reduce(0) { $0 + $1.utf8.count }
            nextBatch = page.nextBatch
            ingest(page.roots)
            publishCurrent()
        }

        // Hydrate one thread at a time, visible rows (newest activity) first, publishing after each thread.
        let items = Array(openEntries.filter { !resolved.contains($0.rootId) }.prefix(Self.pageSize))
            .sorted { $0.latestTs > $1.latestTs }
        var hydratedCount = 0

        for item in items {
            let rootId = item.rootId
            if resolved.contains(rootId) { continue }
            let key = item.cacheKey
            // A quiet thread nothing new happened in keeps its snapshot for a minute, unless it streams or waits
            // for the person (running / needs-you re-read only their newest page).
            if let cached = snapshots[rootId], let read = snapshotReads[rootId], read.key == key,
               Date().timeIntervalSince(read.at) < Self.snapshotLifetime,
               ![.running, .needsYou].contains(cached.rowState) {
                rowsByRoot[rootId] = row(cached)
                continue
            }

            do {
                let rootJson = try await room.loadOrFetchEventJson(eventId: rootId)
                requests += 1
                bytes += rootJson.utf8.count
                guard let root = parse(rootJson) else { continue }

                let tailPage = try await room.relationsJsonPage(
                    eventId: rootId, relType: "m.thread", eventType: nil,
                    forward: false, limit: Self.hydrationPageSize, from: nil
                )
                requests += 1
                bytes += tailPage.events.reduce(0) { $0 + $1.utf8.count }

                var related = tailPage.events.compactMap(parse)
                var pageCursor = tailPage.nextBatch
                let cachedTitle = cachedTitles[rootId]

                var snapshot = ThreadSnapshot.build(
                    root: root, related: related, ownUserId: userId, now: Date(),
                    serverTitle: item.serverTitle, cachedTitle: cachedTitle
                )

                // If no reply from someone else was found and next_batch exists, read one more page.
                if snapshot.reply == nil, let token = pageCursor,
                   let page2 = try? await room.relationsJsonPage(
                       eventId: rootId, relType: "m.thread", eventType: nil,
                       forward: false, limit: Self.hydrationPageSize, from: token
                   ) {
                    requests += 1
                    bytes += page2.events.reduce(0) { $0 + $1.utf8.count }
                    related.append(contentsOf: page2.events.compactMap(parse))
                    pageCursor = page2.nextBatch
                }

                // Pending approval cards outside the window (unencrypted rooms only).
                if pageCursor != nil, room.encryptionState() != .encrypted,
                   let approvalPage = try? await room.relationsJsonPage(
                       eventId: rootId, relType: "m.thread", eventType: ApprovalCard.eventType,
                       forward: false, limit: Self.approvalPageSize, from: nil
                   ) {
                    requests += 1
                    bytes += approvalPage.events.reduce(0) { $0 + $1.utf8.count }
                    related.append(contentsOf: approvalPage.events.compactMap(parse))
                }

                snapshot = ThreadSnapshot.build(
                    root: root, related: related, ownUserId: userId, now: Date(),
                    serverTitle: item.serverTitle, cachedTitle: cachedTitle
                )

                // One head page once per thread when no title is known yet (holds voice transcript and early summaries).
                if snapshot.knownTitle == nil, cachedTitle == nil, pageCursor != nil,
                   !headFetchedRoots.contains(rootId) {
                    headFetchedRoots.insert(rootId)
                    if let headPage = try? await room.relationsJsonPage(
                        eventId: rootId, relType: "m.thread", eventType: nil,
                        forward: true, limit: Self.headTitlePageSize, from: nil
                    ) {
                        requests += 1
                        bytes += headPage.events.reduce(0) { $0 + $1.utf8.count }
                        let headEvents = ThreadSnapshot.headTitleEvents(rootId: rootId, from: headPage.events.compactMap(parse))
                        if !headEvents.isEmpty {
                            related.append(contentsOf: headEvents)
                            snapshot = ThreadSnapshot.build(
                                root: root, related: related, ownUserId: userId, now: Date(),
                                serverTitle: item.serverTitle, cachedTitle: cachedTitle
                            )
                        }
                    }
                }

                // Open question: fetch reactions on the question event so viewer answers clear the chip.
                if let question = snapshot.openQuestion,
                   let reactionsPage = try? await room.relationsJsonPage(
                       eventId: question.eventId, relType: "m.annotation", eventType: nil,
                       forward: false, limit: Self.reactionsPageSize, from: nil
                   ) {
                    requests += 1
                    bytes += reactionsPage.events.reduce(0) { $0 + $1.utf8.count }
                    related.append(contentsOf: reactionsPage.events.compactMap(parse))
                    snapshot = ThreadSnapshot.build(
                        root: root, related: related, ownUserId: userId, now: Date(),
                        serverTitle: item.serverTitle, cachedTitle: cachedTitle
                    )
                }

                if let known = snapshot.knownTitle { rememberTitle(known, for: rootId) }
                snapshots[rootId] = snapshot
                snapshotReads[rootId] = (key, Date())
                hydratedCount += 1
                if let reply = snapshot.reply { await learnNames([reply.sender] + PlainText.mentionedUserIds(reply.text)) }
                if !resolved.contains(rootId) {
                    rowsByRoot[rootId] = row(snapshot)
                    publishCurrent()
                }
            } catch {
                // Keep the provisional or previously cached row on transient fetch failure.
                continue
            }
        }

        publishCurrent()
        publishWidgetSnapshot()

        #if DEBUG
        let totalMs = Int(Date().timeIntervalSince(started) * 1000)
        E2EHooks.log("refresh done \(totalMs)ms rows=\(rows.count) hydrated=\(hydratedCount) reqs=\(requests) bytes=\(bytes)")
        #endif
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

    private func provisionalRow(_ entry: ThreadListEntry) -> ThreadRow {
        let title = entry.serverTitle ?? cachedTitles[entry.rootId] ?? entry.fallbackTitle
        let line: String
        if let sender = entry.previewSender, !sender.isEmpty {
            let text: String
            if entry.previewIsEncrypted {
                text = String(localized: "Encrypted message")
            } else if entry.previewIsVoiceOnly {
                text = String(localized: "Voice message")
            } else if let previewText = entry.previewText, !previewText.isEmpty {
                text = named(previewText)
            } else {
                text = "…"
            }
            line = "\(name(sender)): \(text)"
        } else {
            line = String(localized: "Sent")
        }
        return ThreadRow(
            id: entry.rootId, rootId: entry.rootId, title: title, line: line,
            state: .idle(Date(timeIntervalSince1970: Double(entry.latestTs) / 1000)),
            ts: entry.latestTs, rootTs: entry.rootTs, voiceFile: entry.voiceFile
        )
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

    /// The thread tags and pinned events in the room's state (state events are not encrypted), plus byte size;
    /// nil when it could not be read.
    private func resolvedRoots() async -> (Set<String>, Int)? {
        guard let session, let base = URL(string: session.homeserverUrl) else { return nil }
        let roomId = room.id().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "!:/"))) ?? room.id()
        guard let url = URL(string: "\(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/_matrix/client/v3/rooms/\(roomId)/state") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let state = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return nil }
        return (ThreadTags.resolvedRoots(state: state), data.count)
    }
}

enum RoomModelError: Error {
    case notReady
}
