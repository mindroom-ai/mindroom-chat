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
    private var timeline: Timeline?
    private let feed: TimelineFeed
    private var handle: TaskHandle?

    init(room: Room, rootId: String, userId: String, initial: ThreadSnapshot?) {
        self.room = room
        self.rootId = rootId
        self.userId = userId
        snapshot = initial
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
        if fetching { fetchAgain = true; return }
        fetching = true
        Task {
            repeat {
                fetchAgain = false
                try? await Task.sleep(nanoseconds: 300_000_000)
                await fetch()
            } while fetchAgain
            fetching = false
        }
    }

    private func fetch() async {
        guard let jsons = try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId),
              let root = jsons.first.flatMap(parse) else { return }
        let next = ThreadSnapshot.build(root: root, related: jsons.dropFirst().compactMap(parse), ownUserId: userId, now: Date())
        // A haptic when an agent's answer finishes while the thread is open.
        if snapshot?.reply?.run == .streaming, next.reply?.run == .finished {
            WKInterfaceDevice.current().play(.success)
        }
        snapshot = next
        SeenStore.markSeen(rootId, eventId: next.latestEventId)
        #if DEBUG
        for card in next.approvals { log.notice("card \(card.eventId, privacy: .public) \(card.status.rawValue, privacy: .public)") }
        E2EHooks.act(on: next, model: self)
        #endif
    }

    /// Approve or deny a tool call, as the web client does. A card answered elsewhere first is not pending
    /// any more, so the buttons are gone and nothing is sent.
    func approve(_ card: ApprovalCard, _ yes: Bool) async {
        guard snapshot?.pendingApproval?.eventId == card.eventId, !answered.contains(card.eventId),
              card.approvable || !yes else { return }
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

    func replyVoice(_ take: Take) async {
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
