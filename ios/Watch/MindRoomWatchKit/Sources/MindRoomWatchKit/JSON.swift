import Foundation

/// A Matrix event or event content as JSONSerialization gives it.
public typealias JSON = [String: Any]

extension Dictionary where Key == String, Value == Any {
    /// The event's content.
    var content: JSON { self["content"] as? JSON ?? [:] }

    /// The content an edit carries, else the event's own content.
    var newContent: JSON? { content["m.new_content"] as? JSON }

    var relation: JSON? { content["m.relates_to"] as? JSON }

    /// The id of the event this one replaces, when it is an `m.replace` edit.
    var replacedEventId: String? {
        guard relation?["rel_type"] as? String == "m.replace" else { return nil }
        return relation?["event_id"] as? String
    }

    var eventId: String? { self["event_id"] as? String }

    var timestamp: Int { (self["origin_server_ts"] as? NSNumber)?.intValue ?? 0 }

    /// The newest edit the server bundled with the event (`unsigned.m.relations.m.replace`), when it names this
    /// event as the one it replaces. `ThreadSnapshot.build` checks its sender and content, as of every edit.
    var bundledEdit: JSON? {
        guard let id = eventId,
              let edit = ((self["unsigned"] as? JSON)?["m.relations"] as? JSON)?["m.replace"] as? JSON,
              edit.replacedEventId == id else { return nil }
        return edit
    }
}

/// The content to read: the latest edit's `m.new_content` when there is one, else the event's.
func effectiveContent(_ event: JSON, latestEdit: JSON?) -> JSON {
    latestEdit?.newContent ?? event.content
}
