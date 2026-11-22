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

    /// Whether the event is redacted (empty content or `unsigned.redacted_because`).
    var isRedacted: Bool {
        content.isEmpty || (self["unsigned"] as? JSON)?["redacted_because"] != nil
    }

    /// The raw bundled `m.replace` edit in `unsigned.m.relations.m.replace`, before validation.
    public var bundledEdit: JSON? {
        ((self["unsigned"] as? JSON)?["m.relations"] as? JSON)?["m.replace"] as? JSON
    }

    /// The bundled `m.replace` edit when it is readable (`m.new_content`), from the same sender and of the
    /// same type, and explicitly targets this event.
    public var validBundledEdit: JSON? {
        guard let id = eventId, let sender = self["sender"] as? String, let type = self["type"] as? String,
              let edit = bundledEdit,
              edit["sender"] as? String == sender,
              edit["type"] as? String == type,
              edit.replacedEventId == id,
              edit.newContent != nil else { return nil }
        return edit
    }
}

/// Shared event merging and deduplication helpers used by both `ThreadSnapshot.build` and `ThreadModel`.
public enum MatrixEvents {
    /// Merges `incoming` events into `existing` keyed by `event_id`.
    /// When `preferIncoming` is true, decrypted incoming copies replace existing copies (catching fresher
    /// bundled edits); otherwise an incoming copy replaces an existing one only when decrypting an encrypted
    /// placeholder or carrying a newer valid bundled edit.
    public static func merge(_ incoming: [JSON], into existing: inout [String: JSON], preferIncoming: Bool,
                             excluding excludedId: String? = nil) {
        for event in incoming {
            guard let id = event.eventId, id != excludedId else { continue }
            if let current = existing[id] {
                let currentEncrypted = current["type"] as? String == "m.room.encrypted"
                let incomingEncrypted = event["type"] as? String == "m.room.encrypted"
                if preferIncoming {
                    if !incomingEncrypted || currentEncrypted { existing[id] = event }
                } else {
                    let currentEditTs = current.validBundledEdit?.timestamp ?? -1
                    let incomingEditTs = event.validBundledEdit?.timestamp ?? -1
                    if (currentEncrypted && !incomingEncrypted) || (!incomingEncrypted && incomingEditTs > currentEditTs) {
                        existing[id] = event
                    }
                }
            } else {
                existing[id] = event
            }
        }
    }

    /// Deduplicates `events` by `event_id` (preserving anonymous events without an `event_id`).
    public static func deduplicate(_ events: [JSON], excluding excludedId: String? = nil) -> [JSON] {
        var byId: [String: JSON] = [:]
        var anonymous: [JSON] = []
        for event in events where event.eventId == nil { anonymous.append(event) }
        merge(events, into: &byId, preferIncoming: false, excluding: excludedId)
        return Array(byId.values) + anonymous
    }
}

/// The content to read: the latest edit's `m.new_content` when there is one, else the event's.
func effectiveContent(_ event: JSON, latestEdit: JSON?) -> JSON {
    latestEdit?.newContent ?? event.content
}
