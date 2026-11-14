import Foundation
import MatrixRustSDK
import MindRoomWatchKit

/// What a MindRoom push is about, read with the watch's own client: the push carries only the room
/// and event ids (Sygnal's `event_id_only` format, or content the watch cannot read when encrypted).
enum PushedEvent {
    case approval(ApprovalCard, roomId: String)
    case question(Question, roomId: String)
    case message(sender: String, text: String, roomId: String, threadId: String?)

    static let category = "MINDROOM_EVENT"

    @MainActor
    static func load(userInfo: [AnyHashable: Any], session: MatrixSession) async -> PushedEvent? {
        guard let roomId = userInfo["room_id"] as? String, let eventId = userInfo["event_id"] as? String else { return nil }
        if session.client == nil { await session.restore() }
        guard let client = session.client, let userId = try? client.userId(),
              let room = try? client.getRoom(roomId: roomId),
              let jsons = try? await room.loadOrFetchEventJsonWithRelations(eventId: eventId),
              let event = jsons.first.flatMap(parse) else { return nil }
        let related = jsons.dropFirst().compactMap(parse)
        if let card = ApprovalCard.parse(event) {
            return .approval(card.applying(edits: related, now: Date()), roomId: roomId)
        }
        let edits = related.filter { ($0["content"] as? [String: Any]).flatMap { ($0["m.relates_to"] as? [String: Any])?["rel_type"] as? String } == "m.replace" }
        let latestEdit = edits.max { ($0["origin_server_ts"] as? Int ?? 0) < ($1["origin_server_ts"] as? Int ?? 0) }
        let answered = related.contains { $0["type"] as? String == "m.reaction" && $0["sender"] as? String == userId }
        if !answered, let question = Question.parse(event, latestEdit: latestEdit) {
            return .question(question, roomId: roomId)
        }
        let content = (latestEdit?["content"] as? [String: Any])?["m.new_content"] as? [String: Any] ?? event["content"] as? [String: Any] ?? [:]
        let relation = (event["content"] as? [String: Any])?["m.relates_to"] as? [String: Any]
        let threadId = relation?["rel_type"] as? String == "m.thread" ? relation?["event_id"] as? String : nil
        return .message(sender: event["sender"] as? String ?? "", text: PlainText.of(markdown: content["body"] as? String ?? ""),
                        roomId: roomId, threadId: threadId ?? eventId)
    }
}
