import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import os
import WatchKit

private let log = Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "thread")

/// One thread, live: seeded from the room list's snapshot, reading the newest bounded page on each poll
/// and paginating older replies on demand via "Load earlier".
@MainActor
final class ThreadModel: ObservableObject {
    private static let pageSize: UInt32 = 30
    private static let approvalPageSize: UInt32 = 10
    private static let reactionsPageSize: UInt32 = 50

    let room: Room
    let rootId: String
    let userId: String
    @Published private(set) var snapshot: ThreadSnapshot?
    @Published private(set) var canLoadEarlier = false
    @Published private(set) var loadingEarlier = false
    @Published var error: String?
    /// Cards and questions answered from this watch, until the thread shows the outcome.
    @Published private(set) var answered: Set<String> = []
    /// The transaction ids of this person's replies the server refused: they hold up the room's queue
    /// until deleted.
    @Published private(set) var failedReplies: [String] = []
    private var timeline: Timeline?
    private let feed: TimelineFeed
    private var handle: TaskHandle?
    private var rootEvent: JSON?
    private var eventsById: [String: JSON] = [:]
    private var reactionsByQuestion: [String: [JSON]] = [:]
    private var earlierToken: String?
    private var hasLoadedEarlier = false
    private var cachedTitle: String?

    init(room: Room, rootId: String, userId: String, initial: ThreadSnapshot?) {
        self.room = room
        self.rootId = rootId
        self.userId = userId
        snapshot = initial
        cachedTitle = initial?.knownTitle ?? ThreadTitleCache.get(userId: userId, roomId: room.id(), rootId: rootId)
        weak var model: ThreadModel?
        feed = TimelineFeed { model?.update() }
        model = self
    }

    func start() async {
        if timeline == nil {
            do {
                let timeline = try await mindroomTimeline(room, focus: .thread(rootEventId: rootId))
                self.timeline = timeline
                handle = await timeline.addListener(listener: feed)
                // A thread-focused timeline starts empty: load the newest window.
                _ = try? await timeline.paginateBackwards(numEvents: 30)
            } catch {
                log.error("thread timeline failed: \(String(describing: type(of: error)), privacy: .public)")
            }
        }
        update()
        guard poll == nil else { return }
        // Cards and their outcomes may come with no other change in the thread: look again every 5 s.
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                self?.update()
            }
        }
    }

    /// Stops polling while the thread is not on screen; the timeline stays for replies sent meanwhile.
    func stop() {
        poll?.cancel()
        poll = nil
    }

    deinit {
        poll?.cancel()
        handle?.cancel()
    }

    private var fetching = false
    private var fetchAgain = false
    private var poll: Task<Void, Never>?

    /// Reads the newest page of the thread as raw JSON and merges it into loaded history: the thread-focused
    /// timeline leaves MindRoom's approval cards out, so it only says when something changed.
    private func update() {
        failedReplies = feed.events.compactMap { item in
            guard item.isOwn, case let .sendingFailed(_, isRecoverable) = item.localSendState, !isRecoverable,
                  case let .transactionId(transactionId) = item.eventOrTransactionId else { return nil }
            return transactionId
        }
        if fetching { fetchAgain = true; return }
        fetching = true
        Task {
            repeat {
                fetchAgain = false
                // The first read starts at once (the thread just opened); the wait after each coalesces a
                // streaming reply's edits to about one read a second.
                await fetch()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            } while fetchAgain
            fetching = false
        }
    }

    private func merge(_ events: [JSON], preferIncoming: Bool) {
        for event in events {
            guard let id = event.eventId else { continue }
            if let existing = eventsById[id] {
                let existingEncrypted = existing["type"] as? String == "m.room.encrypted"
                let incomingEncrypted = event["type"] as? String == "m.room.encrypted"
                if preferIncoming {
                    if !incomingEncrypted || existingEncrypted { eventsById[id] = event }
                } else {
                    let existingEditTs = existing.validBundledEdit?.timestamp ?? -1
                    let incomingEditTs = event.validBundledEdit?.timestamp ?? -1
                    if (existingEncrypted && !incomingEncrypted) || (!incomingEncrypted && incomingEditTs > existingEditTs) {
                        eventsById[id] = event
                    }
                }
            } else {
                eventsById[id] = event
            }
        }
    }

    private func allRelated() -> [JSON] {
        Array(eventsById.values) + reactionsByQuestion.values.flatMap { $0 }
    }

    private func fetch() async {
        if let rootJson = try? await room.loadOrFetchEventJson(eventId: rootId), let parsed = parse(rootJson) {
            rootEvent = parsed
        }
        guard let root = rootEvent else { return }
        guard let page = try? await room.relationsJsonPage(
            eventId: rootId, relType: "m.thread", eventType: nil,
            forward: false, limit: Self.pageSize, from: nil
        ) else { return }
        merge(page.events.compactMap(parse), preferIncoming: true)
        if !hasLoadedEarlier {
            earlierToken = page.nextBatch
            canLoadEarlier = earlierToken != nil
        }

        // Pending approval cards outside the newest window (unencrypted rooms only).
        if earlierToken != nil, room.encryptionState() != .encrypted,
           let approvalPage = try? await room.relationsJsonPage(
               eventId: rootId, relType: "m.thread", eventType: ApprovalCard.eventType,
               forward: false, limit: Self.approvalPageSize, from: nil
           ) {
            merge(approvalPage.events.compactMap(parse), preferIncoming: true)
        }

        var next = ThreadSnapshot.build(
            root: root, related: allRelated(), ownUserId: userId, now: Date(), cachedTitle: cachedTitle
        )

        if let question = next.openQuestion,
           let reactionsPage = try? await room.relationsJsonPage(
               eventId: question.eventId, relType: "m.annotation", eventType: nil,
               forward: false, limit: Self.reactionsPageSize, from: nil
           ) {
            reactionsByQuestion[question.eventId] = reactionsPage.events.compactMap(parse)
            next = ThreadSnapshot.build(
                root: root, related: allRelated(), ownUserId: userId, now: Date(), cachedTitle: cachedTitle
            )
        }

        if let known = next.knownTitle {
            cachedTitle = known
            ThreadTitleCache.set(known, userId: userId, roomId: room.id(), rootId: rootId)
        }

        // A haptic when an agent's answer finishes while the thread is open.
        if snapshot?.reply?.run == .streaming, next.reply?.run == .finished {
            WKInterfaceDevice.current().play(.success)
        }
        snapshot = next
        #if DEBUG
        E2EHooks.log("thread \(rootId) \(next.entries.map(\.id).joined(separator: ","))")
        for card in next.approvals { log.notice("card \(card.eventId, privacy: .public) \(card.status.rawValue, privacy: .public)") }
        E2EHooks.act(on: next, model: self)
        #endif
    }

    /// Loads one older page of replies via `next_batch` and merges it into the open thread without discarding
    /// newer history.
    func loadEarlier() async {
        guard !loadingEarlier, let token = earlierToken else { return }
        loadingEarlier = true
        defer { loadingEarlier = false }
        guard let page = try? await room.relationsJsonPage(
            eventId: rootId, relType: "m.thread", eventType: nil,
            forward: false, limit: Self.pageSize, from: token
        ) else { return }
        merge(page.events.compactMap(parse), preferIncoming: false)
        hasLoadedEarlier = true
        earlierToken = page.nextBatch
        canLoadEarlier = earlierToken != nil
        guard let root = rootEvent else { return }
        let next = ThreadSnapshot.build(
            root: root, related: allRelated(), ownUserId: userId, now: Date(), cachedTitle: cachedTitle
        )
        if let known = next.knownTitle {
            cachedTitle = known
            ThreadTitleCache.set(known, userId: userId, roomId: room.id(), rootId: rootId)
        }
        snapshot = next
    }

    /// Approve or deny a tool call, as the web client does. A card answered elsewhere first is not pending
    /// any more, so the buttons are gone and nothing is sent.
    func approve(_ card: ApprovalCard, _ yes: Bool) async {
        guard snapshot?.pendingApproval?.eventId == card.eventId, !answered.contains(card.eventId),
              card.approvable || !yes else { return }
        error = nil
        answered.insert(card.eventId)
        let content = approvalResponseContent(cardId: card.eventId, threadId: card.threadId, approve: yes)
        do {
            let data = try JSONSerialization.data(withJSONObject: content)
            try await room.sendRaw(eventType: ApprovalCard.responseEventType, content: String(decoding: data, as: UTF8.self))
        } catch {
            answered.remove(card.eventId)
            self.error = String(localized: "Not sent")
            log.error("approval failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Answers an agent's question with the option's reaction, as the web client does.
    func answer(_ question: Question, key: String) async {
        guard !answered.contains(question.eventId) else { return }
        error = nil
        answered.insert(question.eventId)
        let content: [String: Any] = ["m.relates_to": ["rel_type": "m.annotation", "event_id": question.eventId, "key": key]]
        do {
            let data = try JSONSerialization.data(withJSONObject: content)
            try await room.sendRaw(eventType: "m.reaction", content: String(decoding: data, as: UTF8.self))
        } catch {
            answered.remove(question.eventId)
            self.error = String(localized: "Not sent")
            log.error("answer failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Drops a reply that could not be sent and turns the room's queue back on (`RoomModel.discard`).
    func discard(_ transactionId: String) async {
        try? await timeline?.redactEvent(eventOrTransactionId: .transactionId(transactionId: transactionId), reason: nil)
        room.enableSendQueue(enable: true)
    }

    func replyVoice(_ take: Take) async {
        error = nil
        guard let timeline else {
            error = String(localized: "Not sent")
            return
        }
        do {
            try await sendVoiceMessage(take, on: timeline)
        } catch {
            self.error = String(localized: "Not sent")
            log.error("reply failed: \(String(describing: error), privacy: .public)")
        }
    }
}
