import Foundation
import MatrixRustSDK

/// MindRoom's own event types, which the SDK's default timeline filter would drop.
let mindroomEventTypes = ["io.mindroom.tool_approval", "io.mindroom.tool_approval_response"]

/// A timeline's items, kept current from the SDK's diffs; calls `onChange` on the main actor.
final class TimelineFeed: TimelineListener, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [TimelineItem] = []
    private let onChange: @MainActor () -> Void

    init(onChange: @escaping @MainActor () -> Void) { self.onChange = onChange }

    func onUpdate(diff: [TimelineDiff]) {
        lock.lock()
        for change in diff {
            switch change {
            case let .append(values): items += values
            case .clear: items = []
            case let .pushFront(value): items.insert(value, at: 0)
            case let .pushBack(value): items.append(value)
            case .popFront: if !items.isEmpty { items.removeFirst() }
            case .popBack: if !items.isEmpty { items.removeLast() }
            case let .insert(index, value): items.insert(value, at: min(Int(index), items.count))
            case let .set(index, value): if Int(index) < items.count { items[Int(index)] = value }
            case let .remove(index): if Int(index) < items.count { items.remove(at: Int(index)) }
            case let .truncate(length): items = Array(items.prefix(Int(length)))
            case let .reset(values): items = values
            }
        }
        lock.unlock()
        Task { @MainActor in onChange() }
    }

    var events: [EventTimelineItem] {
        lock.lock(); defer { lock.unlock() }
        return items.compactMap { $0.asEvent() }
    }
}

/// A timeline with MindRoom's events kept.
func mindroomTimeline(_ room: Room, focus: TimelineFocus) async throws -> Timeline {
    try await room.timelineWithConfiguration(configuration: TimelineConfiguration(
        focus: focus, filter: .defaultAndEventTypes(eventTypes: mindroomEventTypes), internalIdPrefix: nil,
        dateDividerMode: .daily, trackReadReceipts: .disabled, reportUtds: false))
}

func parse(_ json: String?) -> [String: Any]? {
    guard let json else { return nil }
    return (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
}
