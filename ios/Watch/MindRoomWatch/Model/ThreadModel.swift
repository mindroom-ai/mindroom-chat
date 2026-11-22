import Combine
import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import os
import WatchKit

private let log = Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "thread")

/// One thread, live: its root and every reply, read from a thread-focused timeline.
@MainActor
final class ThreadModel: ObservableObject {
    let room: Room
    let rootId: String
    let userId: String
    @Published private(set) var snapshot: ThreadSnapshot?
    @Published var error: String?
    /// Cards and questions answered from this watch, until the thread shows the outcome.
    @Published private(set) var answered: Set<String> = []
    /// The transaction ids of this person's replies the server refused: they hold up the room's queue
    /// until deleted.
    @Published private(set) var failedReplies: [String] = []
    private var timeline: Timeline?
    private let feed: TimelineFeed
    private var handle: TaskHandle?
    /// The room's trust, the one its threads list reads too: the thread is built with it as it is then.
    private let trust: RoomTrust
    private var trustChanges: AnyCancellable?
    private let refreshTrust: @MainActor () -> Void
    /// What is kept of the thread's events as last read, when it has a voice echo (`ThreadSnapshot.kept`): the
    /// thread is built again from them when the room's trust changes. No trust changes a thread without one.
    private var events: ThreadEvents?

    /// `initial` and `events`: the thread as the threads list last read it, and what that kept of its events.
    /// `refreshTrust` asks the room to read its state when that is due, and does not wait for it
    /// (`RoomModel.readStateIfDue`).
    init(room: Room, rootId: String, userId: String, trust: RoomTrust, initial: ThreadSnapshot?, events: ThreadEvents?,
         refreshTrust: @escaping @MainActor () -> Void) {
        self.room = room
        self.rootId = rootId
        self.userId = userId
        self.trust = trust
        self.events = events
        self.refreshTrust = refreshTrust
        snapshot = initial
        weak var model: ThreadModel?
        feed = TimelineFeed { model?.update() }
        trustChanges = trust.changed.sink { model?.trustChanged() }
        model = self
    }

    func start() async {
        // The trust is read beside the thread, never ahead of it: the timeline, the messages and Reply do not
        // wait for the room's state, and the thread shows again once the trust is there.
        refreshTrust()
        if timeline == nil {
            do {
                let timeline = try await mindroomTimeline(room, focus: .thread(rootEventId: rootId))
                self.timeline = timeline
                handle = await timeline.addListener(listener: feed)
                // A thread-focused timeline starts empty: load the thread.
                _ = try? await timeline.paginateBackwards(numEvents: 50)
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
                self?.refreshTrust()
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

    /// Reads the thread again as raw JSON (root and everything related to it): the thread-focused
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

    private func fetch() async {
        guard let jsons = try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId),
              let read = threadEvents(jsons) else { return }
        events = ThreadSnapshot.kept(read)
        show(threadSnapshot(read, trust: trust, userId: userId))
    }

    /// The room's trust changed: the thread is built again from the events kept, and nothing is read for it.
    private func trustChanged() {
        if let events { show(threadSnapshot(events, trust: trust, userId: userId)) }
    }

    private func show(_ next: ThreadSnapshot) {
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
