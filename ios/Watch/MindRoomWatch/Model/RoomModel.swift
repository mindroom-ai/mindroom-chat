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
            // Thread replies change their root's summary in this timeline, so it also signals thread changes.
            handles.append(await timeline.addListener(listener: feed))
            _ = try? await timeline.paginateBackwards(numEvents: 30)
            self.timeline = timeline
            #if DEBUG
            Task { await E2EHooks.send(on: timeline) }
            #endif
        } catch {
            log.error("timeline failed: \(String(describing: error), privacy: .public)")
        }
        scheduleRefresh()
    }

    func sendVoice(_ take: Take) async throws {
        guard let timeline else { return }
        try await sendVoiceMessage(take, on: timeline)
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

    private func refresh() async {
        if room.membership() != .joined { gone = true; return }
        await threads.reset()
        try? await threads.paginate()
        let resolved = await resolvedRoots()
        let roots = threads.items().prefix(Self.pageSize).map(\.rootEvent.eventId).filter { !resolved.contains($0) }
        var rows: [ThreadRow] = []
        for rootId in roots {
            guard let jsons = try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId),
                  let root = jsons.first.flatMap(parse) else { continue }
            let snapshot = ThreadSnapshot.build(root: root, related: jsons.dropFirst().compactMap(parse), ownUserId: userId, now: Date())
            snapshots[rootId] = snapshot
            if let reply = snapshot.reply { await learnNames([reply.sender] + PlainText.mentionedUserIds(reply.text)) }
            rows.append(row(snapshot))
        }
        rows += ownUnansweredRoots(excluding: Set(roots).union(resolved))
        self.rows = rows.sorted { $0.ts > $1.ts }
    }

    private func row(_ snapshot: ThreadSnapshot) -> ThreadRow {
        let line: String
        if let reply = snapshot.reply {
            line = "\(name(reply.sender)): \(reply.text.isEmpty ? "…" : named(reply.text))"
        } else {
            line = String(localized: "Sent")
        }
        return ThreadRow(id: snapshot.rootId, rootId: snapshot.rootId, title: snapshot.title, line: line,
                         state: snapshot.rowState(lastSeenEventId: SeenStore.lastSeen(snapshot.rootId)), ts: snapshot.latestTs)
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
            return ThreadRow(id: id, rootId: rootId, title: title, line: String(localized: "Sent"), state: state, ts: Int(item.timestamp))
        }
    }

    /// The thread tags in the room's state: one request per refresh (state events are not encrypted).
    private func resolvedRoots() async -> Set<String> {
        guard let session, let base = URL(string: session.homeserverUrl) else { return [] }
        let roomId = room.id().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "!:/"))) ?? room.id()
        guard let url = URL(string: "\(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/_matrix/client/v3/rooms/\(roomId)/state") else { return [] }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let state = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return ThreadTags.resolvedRoots(state: state)
    }
}
