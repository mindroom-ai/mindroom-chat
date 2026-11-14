import Foundation

public enum ApprovalStatus: String, Equatable, Sendable {
    case pending, approved, denied, expired
}

/// A tool call waiting for a person's OK: the backend's `io.mindroom.tool_approval` event.
public struct ApprovalCard: Equatable, Sendable {
    public static let eventType = "io.mindroom.tool_approval"
    public static let responseEventType = "io.mindroom.tool_approval_response"

    public let eventId: String
    public let sender: String
    public let threadId: String
    public let toolName: String
    public let agentName: String?
    /// Every argument, sorted by name, values as text (JSON for anything that is not a string).
    public let arguments: [Argument]
    public let argumentsTruncated: Bool
    public let status: ApprovalStatus
    public let expiresAt: Date?
    /// The one person who may decide, when the backend names one.
    public let approverUserId: String?
    /// False when the backend could not show every argument for review: then only Deny is offered.
    public let approvable: Bool

    public struct Argument: Equatable, Sendable {
        public let key: String
        public let value: String
    }

    /// The card, or nil for any other event, including an edit of a card.
    public static func parse(_ event: JSON) -> ApprovalCard? {
        guard event["type"] as? String == eventType, event.replacedEventId == nil,
              let eventId = event.eventId else { return nil }
        let content = event.content
        guard let toolName = content["tool_name"] as? String,
              let status = ApprovalStatus(rawValue: content["status"] as? String ?? "") else { return nil }
        let threadId = content["thread_id"] as? String
            ?? (event.relation?["rel_type"] as? String == "m.thread" ? event.relation?["event_id"] as? String : nil)
            ?? eventId
        let arguments = (content["arguments"] as? JSON ?? [:])
            .map { Argument(key: $0.key, value: text(of: $0.value)) }
            .sorted { $0.key < $1.key }
        return ApprovalCard(
            eventId: eventId, sender: event["sender"] as? String ?? "", threadId: threadId, toolName: toolName,
            agentName: content["agent_name"] as? String, arguments: arguments,
            argumentsTruncated: content["arguments_truncated"] as? Bool ?? false,
            status: status, expiresAt: (content["expires_at"] as? String).flatMap(parseDate),
            approverUserId: content["approver_user_id"] as? String, approvable: content["approvable"] as? Bool ?? true)
    }

    /// The id of the card an `m.replace` edit of a card changes.
    public static func editTarget(_ event: JSON) -> String? {
        event["type"] as? String == eventType ? event.replacedEventId : nil
    }

    /// The card with the newest edit's status applied; a pending card past its expiry is expired.
    public func applying(edits: [JSON], now: Date) -> ApprovalCard {
        let newest = edits
            .filter { ApprovalCard.editTarget($0) == eventId }
            .max { $0.timestamp < $1.timestamp }
        var status = (newest?.newContent?["status"] as? String).flatMap(ApprovalStatus.init(rawValue:)) ?? self.status
        if status == .pending, let expiresAt, expiresAt <= now { status = .expired }
        return ApprovalCard(eventId: eventId, sender: sender, threadId: threadId, toolName: toolName, agentName: agentName,
                            arguments: arguments, argumentsTruncated: argumentsTruncated, status: status, expiresAt: expiresAt,
                            approverUserId: approverUserId, approvable: approvable)
    }
}

/// The content of the `io.mindroom.tool_approval_response` the web client sends for Approve or Deny.
public func approvalResponseContent(cardId: String, threadId: String, approve: Bool) -> JSON {
    [
        "status": approve ? "approved" : "denied",
        "reason": NSNull(),
        "m.relates_to": [
            "rel_type": "m.thread",
            "event_id": threadId,
            "is_falling_back": true,
            "m.in_reply_to": ["event_id": cardId],
        ] as JSON,
    ]
}

private func text(of value: Any) -> String {
    if let string = value as? String { return string }
    if JSONSerialization.isValidJSONObject(value),
       let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        return String(decoding: data, as: UTF8.self)
    }
    return "\(value)"
}

private func parseDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

/// MindRoom's agents: accounts whose localpart starts with `mindroom_`, on the person's own homeserver
/// (as the web client's `isMindroomAgentUserIdForViewer`).
public enum MindRoomAgent {
    public static func isAgent(_ userId: String?, viewer: String) -> Bool {
        guard let userId, let local = userId.dropFirst().split(separator: ":").first,
              local.lowercased().hasPrefix("mindroom_") else { return false }
        return server(userId) != nil && server(userId) == server(viewer)
    }

    private static func server(_ userId: String) -> Substring? {
        userId.firstIndex(of: ":").map { userId[userId.index(after: $0)...] }
    }
}
