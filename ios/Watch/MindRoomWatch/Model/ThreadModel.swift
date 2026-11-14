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
        guard timeline == nil else { return }
        do {
            let timeline = try await mindroomTimeline(room, focus: .thread(rootEventId: rootId))
            handle = await timeline.addListener(listener: feed)
            // A thread-focused timeline starts empty: load the thread.
            _ = try? await timeline.paginateBackwards(numEvents: 50)
            self.timeline = timeline
        } catch {
            log.error("thread timeline failed: \(String(describing: error), privacy: .public)")
        }
    }

    func stop() {
        handle?.cancel()
        handle = nil
        timeline = nil
    }

    private func update() {
        let events = feed.json
        guard let root = events.first(where: { $0["event_id"] as? String == rootId }) else { return }
        let next = ThreadSnapshot.build(root: root, related: events.filter { $0["event_id"] as? String != rootId },
                                        ownUserId: userId, now: Date())
        // A haptic when an agent's answer finishes while the thread is open.
        if snapshot?.reply?.run == .streaming, next.reply?.run == .finished {
            WKInterfaceDevice.current().play(.success)
        }
        snapshot = next
        SeenStore.markSeen(rootId, eventId: next.latestEventId)
    }

    func replyVoice(_ take: Take) async {
        guard let timeline else { return }
        do {
            try await sendVoiceMessage(take, on: timeline)
        } catch {
            self.error = String(describing: error)
        }
    }
}
