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

    public var eventId: String? { self["event_id"] as? String }

    public var timestamp: Int { (self["origin_server_ts"] as? NSNumber)?.intValue ?? 0 }

    /// The raw bundled `m.replace` edit in `unsigned.m.relations.m.replace`, before validation.
    public var bundledEdit: JSON? {
        ((self["unsigned"] as? JSON)?["m.relations"] as? JSON)?["m.replace"] as? JSON
    }

    /// The bundled `m.replace` edit when it is readable (`m.new_content`), from the same sender and of the
    /// same type, and targets this event.
    public var validBundledEdit: JSON? {
        guard let id = eventId, let sender = self["sender"] as? String, let type = self["type"] as? String,
              var edit = bundledEdit,
              edit["sender"] as? String == sender,
              edit["type"] as? String == type,
              edit.newContent != nil else { return nil }
        if let relation = edit.relation {
            guard relation["rel_type"] as? String == "m.replace",
                  relation["event_id"] as? String == id else { return nil }
            return edit
        }
        var content = edit.content
        content["m.relates_to"] = ["rel_type": "m.replace", "event_id": id] as JSON
        edit["content"] = content
        return edit
    }
}

/// The content to read: the latest edit's `m.new_content` when there is one, else the event's.
func effectiveContent(_ event: JSON, latestEdit: JSON?) -> JSON {
    latestEdit?.newContent ?? event.content
}
