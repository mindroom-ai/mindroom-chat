import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import WatchKit

/// What a MindRoom push is about, read with the watch's own client: the push carries only the room
/// and event ids (Sygnal's `event_id_only` format, or content the watch cannot read when encrypted).
/// Its thread is read too, so a notification offers only what the thread screen would.
enum PushedEvent {
    /// `actionable` when the card waits for this person's decision.
    case approval(ApprovalCard, actionable: Bool, roomId: String)
    /// The thread's open question.
    case question(Question, roomId: String, threadId: String)
    case message(sender: String, text: String, roomId: String, threadId: String)

    static let category = "MINDROOM_EVENT"

    @MainActor
    static func load(userInfo: [AnyHashable: Any], session: MatrixSession) async -> PushedEvent? {
        guard let roomId = userInfo["room_id"] as? String, let pushedId = userInfo["event_id"] as? String else { return nil }
        if session.client == nil { await session.restore() }
        guard let client = session.client, let userId = try? client.userId(),
              let room = try? client.getRoom(roomId: roomId) else { return nil }
        var read = try? await room.loadOrFetchEventJsonWithRelations(eventId: pushedId)
        // A room's newer keys reach the watch only through sync, which runs while the app is in front: when
        // the event does not decrypt, sync for a few seconds and read it again.
        let locked = { (jsons: [String]?) in jsons?.first.flatMap(parse)?["type"] as? String == "m.room.encrypted" }
        if locked(read) {
            await session.setActive(true)
            for _ in 0..<5 where locked(read) {
                try? await Task.sleep(for: .seconds(1))
                read = try? await room.loadOrFetchEventJsonWithRelations(eventId: pushedId)
            }
            if WKApplication.shared().applicationState != .active { await session.setActive(false) }
        }
        guard var jsons = read, var event = jsons.first.flatMap(parse) else { return nil }
        // A finished agent reply is pushed as the edit that finished it: the push is about the reply.
        var eventId = pushedId
        let subject = ThreadSnapshot.pushedEventId(of: event)
        if subject != pushedId, let original = try? await room.loadOrFetchEventJsonWithRelations(eventId: subject),
           let originalEvent = original.first.flatMap(parse) {
            (eventId, jsons, event) = (subject, original, originalEvent)
        }
        let rootId = ThreadSnapshot.threadRootId(of: event)
        let threadJsons = rootId == eventId ? jsons : (try? await room.loadOrFetchEventJsonWithRelations(eventId: rootId)) ?? []
        if let root = threadJsons.first.flatMap(parse) {
            let snapshot = ThreadSnapshot.build(root: root, related: threadJsons.dropFirst().compactMap(parse), ownUserId: userId, now: Date())
            switch snapshot.pushed(eventId: eventId) {
            case let .approval(card, actionable): return .approval(card, actionable: actionable, roomId: roomId)
            case let .question(question): return .question(question, roomId: roomId, threadId: rootId)
            case .message: break
            }
        }
        // The message as its sender's newest edit that can be read says it.
        let sender = event["sender"] as? String
        let latestEdit = jsons.dropFirst().compactMap(parse)
            .filter { edit in
                let relation = (edit["content"] as? [String: Any])?["m.relates_to"] as? [String: Any]
                return relation?["rel_type"] as? String == "m.replace" && relation?["event_id"] as? String == eventId
                    && edit["sender"] as? String == sender && (edit["content"] as? [String: Any])?["m.new_content"] != nil
            }
            .max { ($0["origin_server_ts"] as? Int ?? 0) < ($1["origin_server_ts"] as? Int ?? 0) }
        let content = (latestEdit?["content"] as? [String: Any])?["m.new_content"] as? [String: Any] ?? event["content"] as? [String: Any] ?? [:]
        return .message(sender: sender ?? "", text: PlainText.of(markdown: content["body"] as? String ?? ""),
                        roomId: roomId, threadId: rootId)
    }
}
