import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import os
import WatchKit

private let log = Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "thread")

/// One thread, live: seeded from the room list's snapshot, reading 30 replies on first open and 10 on each
/// 5 s poll, replacing the covered window on poll (so redactions disappear) while keeping older loaded pages
/// and paginating older replies on demand via "Load earlier".
@MainActor
final class ThreadModel: ObservableObject {
    private static let firstPageSize: UInt32 = 30
    private static let pollPageSize: UInt32 = 10
    private static let bridgeMaxPages = 3
    private static let approvalPageSize: UInt32 = 10
    private static let encryptedCardScanPageSize: UInt32 = 50
    private static let encryptedCardScanMaxPages = 3
    private static let rootEditsPageSize: UInt32 = 5
    private static let cardEditsPageSize: UInt32 = 10
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
    private var rootEdits: [JSON] = []
    private var eventsById: [String: JSON] = [:]
    private var extraCardsById: [String: JSON] = [:]
    private var cardEditsByCardId: [String: [JSON]] = [:]
    private var knownPendingCardIds: Set<String> = []
    private var coldScannedEncrypted = false
    private var reactionsByQuestion: [String: [JSON]] = [:]
    private var questionSources: [String: JSON] = [:]
    private var earlierToken: String?
    private var hasFetchedOnce = false
    private var hasLoadedEarlier = false
    private var cachedTitle: KnownTitle?

    init(room: Room, rootId: String, userId: String, initial: ThreadSnapshot?) {
        self.room = room
        self.rootId = rootId
        self.userId = userId
        snapshot = initial
        cachedTitle = initial?.knownTitle ?? ThreadTitleCache.get(userId: userId, roomId: room.id(), rootId: rootId)
        if let initial {
            knownPendingCardIds = Set(initial.approvals.filter { $0.status == .pending }.map(\.eventId))
        }
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

    private func allRelated() -> [JSON] {
        Array(eventsById.values)
            + Array(extraCardsById.values)
            + rootEdits
            + cardEditsByCardId.values.flatMap { $0 }
            + reactionsByQuestion.values.flatMap { $0 }
    }

    private func fetch() async {
        if let rootJson = try? await room.loadOrFetchEventJson(eventId: rootId), let parsed = parse(rootJson) {
            rootEvent = parsed
        }
        guard let root = rootEvent else { return }
        // Read root's m.replace edits so an edited root never reverts to its unedited cache copy.
        if let editsPage = try? await room.relationsJsonPage(
            eventId: rootId, relType: "m.replace", eventType: nil,
            forward: false, limit: Self.rootEditsPageSize, from: nil
        ) {
            rootEdits = editsPage.events.compactMap(parse)
        }

        let limit = hasFetchedOnce ? Self.pollPageSize : Self.firstPageSize
        guard let page = try? await room.relationsJsonPage(
            eventId: rootId, relType: "m.thread", eventType: nil,
            forward: false, limit: limit, from: nil
        ) else { return }
        hasFetchedOnce = true

        let previousIds = Set(eventsById.keys)
        var incoming = page.events.compactMap(parse)
        var bridgeCursor = page.nextBatch

        // If user loaded earlier history and the newest page does not overlap it, bridge up to 3 pages
        // before dropping disconnected older history.
        if hasLoadedEarlier, !previousIds.isEmpty, bridgeCursor != nil {
            var overlapped = incoming.contains { $0.eventId.map { previousIds.contains($0) } ?? false }
            var bridged = 0
            while !overlapped, let token = bridgeCursor, bridged < Self.bridgeMaxPages {
                bridged += 1
                guard let extra = try? await room.relationsJsonPage(
                    eventId: rootId, relType: "m.thread", eventType: nil,
                    forward: false, limit: Self.firstPageSize, from: token
                ) else { break }
                let parsedExtra = extra.events.compactMap(parse)
                incoming.append(contentsOf: parsedExtra)
                bridgeCursor = extra.nextBatch
                overlapped = parsedExtra.contains { $0.eventId.map { previousIds.contains($0) } ?? false }
            }
            if !overlapped, bridgeCursor != nil {
                eventsById.removeAll()
                hasLoadedEarlier = false
                earlierToken = bridgeCursor
                canLoadEarlier = earlierToken != nil
            }
        }

        // Replace the window covered by `incoming` so redacted replies disappear while preserving older loaded pages.
        let incomingIds = Set(incoming.compactMap(\.eventId))
        if bridgeCursor == nil {
            eventsById.removeAll()
        } else if let oldestTs = incoming.map(\.timestamp).min() {
            eventsById = eventsById.filter { id, event in
                event.timestamp < oldestTs || incomingIds.contains(id)
            }
        }
        MatrixEvents.merge(incoming, into: &eventsById, preferIncoming: true, excluding: rootId)

        if !hasLoadedEarlier {
            earlierToken = bridgeCursor
            canLoadEarlier = earlierToken != nil
        }

        // Refresh older pending approval cards independently of `earlierToken`.
        let isEncrypted = room.encryptionState() == .encrypted
        if !isEncrypted {
            if let approvalPage = try? await room.relationsJsonPage(
                eventId: rootId, relType: "m.thread", eventType: ApprovalCard.eventType,
                forward: false, limit: Self.approvalPageSize, from: nil
            ) {
                var refreshed: [String: JSON] = [:]
                MatrixEvents.merge(approvalPage.events.compactMap(parse), into: &refreshed, preferIncoming: true, excluding: rootId)
                extraCardsById = refreshed
            }
        } else if !coldScannedEncrypted, let startToken = earlierToken {
            var scanCursor: String? = startToken
            var scanComplete = true
            for _ in 0..<Self.encryptedCardScanMaxPages {
                guard let token = scanCursor else { break }
                do {
                    let scanPage = try await room.relationsJsonPage(
                        eventId: rootId, relType: "m.thread", eventType: nil,
                        forward: false, limit: Self.encryptedCardScanPageSize, from: token
                    )
                    let cards = scanPage.events.compactMap(parse).filter { ApprovalCard.parse($0) != nil }
                    if !cards.isEmpty {
                        MatrixEvents.merge(cards, into: &extraCardsById, preferIncoming: true, excluding: rootId)
                        for card in cards {
                            if let id = card.eventId { knownPendingCardIds.insert(id) }
                        }
                        break
                    }
                    scanCursor = scanPage.nextBatch
                } catch {
                    scanComplete = false
                    break
                }
            }
            if scanComplete { coldScannedEncrypted = true }
        }

        // Re-read each known pending card by id (+ its m.replace edits) until decided.
        for cardId in knownPendingCardIds {
            if eventsById[cardId] == nil,
               let cardJson = try? await room.loadOrFetchEventJson(eventId: cardId),
               let parsedCard = parse(cardJson) {
                extraCardsById[cardId] = parsedCard
            }
            if let editsPage = try? await room.relationsJsonPage(
                eventId: cardId, relType: "m.replace", eventType: nil,
                forward: false, limit: Self.cardEditsPageSize, from: nil
            ) {
                cardEditsByCardId[cardId] = editsPage.events.compactMap(parse)
            }
        }

        var next = ThreadSnapshot.build(
            root: root, related: allRelated(), ownUserId: userId, now: Date(), cachedTitle: cachedTitle
        )

        // Fetch missing question source_event_id by id before offering the question.
        var questionSource: JSON?
        if let sourceId = next.missingQuestionSourceId {
            if questionSources[sourceId] == nil,
               let sourceJson = try? await room.loadOrFetchEventJson(eventId: sourceId),
               let parsedSource = parse(sourceJson) {
                questionSources[sourceId] = parsedSource
            }
            questionSource = questionSources[sourceId]
            if questionSource != nil {
                next = ThreadSnapshot.build(
                    root: root, related: allRelated(), ownUserId: userId, now: Date(),
                    cachedTitle: cachedTitle, questionSource: questionSource
                )
            }
        }

        // Re-read the viewer's reactions for the current question candidate on EVERY poll so a withdrawn reaction
        // brings the question back.
        if let qId = next.questionCandidateId ?? next.openQuestion?.eventId {
            if let reactionsPage = try? await room.relationsJsonPage(
                eventId: qId, relType: "m.annotation", eventType: nil,
                forward: false, limit: Self.reactionsPageSize, from: nil
            ) {
                reactionsByQuestion = [qId: reactionsPage.events.compactMap(parse)]
                next = ThreadSnapshot.build(
                    root: root, related: allRelated(), ownUserId: userId, now: Date(),
                    cachedTitle: cachedTitle, questionSource: questionSource
                )
            }
        } else {
            reactionsByQuestion.removeAll()
        }

        // Update tracked pending approval card ids.
        for card in next.approvals {
            if card.status == .pending {
                knownPendingCardIds.insert(card.eventId)
            } else {
                knownPendingCardIds.remove(card.eventId)
                cardEditsByCardId.removeValue(forKey: card.eventId)
            }
        }

        if next.cachedTitleWasRedacted {
            cachedTitle = nil
            ThreadTitleCache.remove(userId: userId, roomId: room.id(), rootId: rootId)
        } else if let known = next.knownTitle {
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
            forward: false, limit: Self.firstPageSize, from: token
        ) else { return }
        MatrixEvents.merge(page.events.compactMap(parse), into: &eventsById, preferIncoming: false, excluding: rootId)
        hasLoadedEarlier = true
        earlierToken = page.nextBatch
        canLoadEarlier = earlierToken != nil
        guard let root = rootEvent else { return }
        let next = ThreadSnapshot.build(
            root: root, related: allRelated(), ownUserId: userId, now: Date(), cachedTitle: cachedTitle
        )
        if next.cachedTitleWasRedacted {
            cachedTitle = nil
            ThreadTitleCache.remove(userId: userId, roomId: room.id(), rootId: rootId)
        } else if let known = next.knownTitle {
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
