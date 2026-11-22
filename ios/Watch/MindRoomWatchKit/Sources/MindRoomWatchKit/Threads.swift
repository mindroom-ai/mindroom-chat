import Foundation

/// Thread tags (`com.mindroom.thread.tags` state), as the web client writes them.
public enum ThreadTags {
    public static let eventType = "com.mindroom.thread.tags"

    public static func resolvedStateKey(root: String) -> String { key(root, "resolved") }

    public static func resolvedContent(userId: String, at date: Date) -> JSON {
        let formatter = ISO8601DateFormatter()
        return ["set_by": userId, "set_at": formatter.string(from: date)]
    }

    /// The roots whose thread is resolved and not pinned, as the web client reads them: a per-tag record
    /// overrides the legacy per-thread tags, an empty one (a tombstone) removes the tag, and a pinned event
    /// (`m.room.pinned_events`) never reads as resolved.
    public static func resolvedRoots(state: [JSON]) -> Set<String> {
        var legacy = Set<String>(), perTag = Set<String>(), tombstones = Set<String>(), pinned = Set<String>()
        for event in state {
            if event["type"] as? String == "m.room.pinned_events" {
                pinned.formUnion(event.content["pinned"] as? [String] ?? [])
            }
            guard event["type"] as? String == eventType, let stateKey = event["state_key"] as? String else { continue }
            let content = event.content
            if let parts = try? JSONSerialization.jsonObject(with: Data(stateKey.utf8)) as? [String], parts.count == 2 {
                guard parts[1] == "resolved" else { continue }
                if content.isEmpty { tombstones.insert(parts[0]) } else { perTag.insert(parts[0]) }
            } else if let tags = content["tags"] as? JSON, tags["resolved"] != nil {
                legacy.insert(stateKey)
            }
        }
        return legacy.subtracting(tombstones).union(perTag).subtracting(pinned)
    }

    private static func key(_ root: String, _ tag: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [root, tag], options: [.withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }
}

/// The room's resolved threads as one model knows them between reads of the room's state, which is megabytes in
/// a busy room: read when the room comes to the front, after a thread is resolved here, and every 5 minutes.
public struct ResolvedRoots: Equatable, Sendable {
    /// How long a read stands.
    public static let lifetime: TimeInterval = 5 * 60

    public private(set) var roots: Set<String>
    /// When the last read that succeeded began; nil asks the next refresh for one.
    private var readAt: Date?
    /// When the read under way began, the roots resolved here since, and whether another read was asked for since.
    private var reading: Date?
    private var resolvedSince: Set<String> = []
    private var askedSince = false

    public init(_ roots: Set<String>) { self.roots = roots }

    /// Whether to read the state now: no read is under way, and the last one failed, began 5 minutes ago or
    /// after `now` (the clock was set back, so how old it is cannot be told), or came before `expire()` or
    /// `resolve(_:)`.
    public func isDue(now: Date) -> Bool {
        reading == nil && (readAt.map { !(0..<Self.lifetime).contains(now.timeIntervalSince($0)) } ?? true)
    }

    public mutating func beginRead(now: Date) {
        reading = now
        resolvedSince = []
        askedSince = false
    }

    /// The read's answer, nil when it failed. A thread resolved here since the read began stays resolved (the
    /// answer may be from before its tag was there). After a resolve or `expire()` since it began, the next
    /// refresh reads again.
    public mutating func endRead(_ read: Set<String>?) {
        if let read {
            roots = read.union(resolvedSince)
            readAt = askedSince ? nil : reading
        }
        reading = nil
    }

    /// A thread resolved here.
    public mutating func resolve(_ root: String) {
        roots.insert(root)
        resolvedSince.insert(root)
        expire()
    }

    /// The room came to the front: the next refresh reads its state.
    public mutating func expire() {
        readAt = nil
        askedSince = true
    }
}

/// A thread as the room's thread list (`/threads`) gives it, before the thread itself is read: what
/// `ThreadSnapshot` makes of the root and the events bundled with it (`latest_event` and, from our homeserver,
/// `io.mindroom.title` and `io.mindroom.latest_reply`; each with its newest edit).
public struct ThreadListEntry: Equatable, Sendable {
    public let rootId: String
    /// The newest event's id and the reply count: another when something new happened in the thread.
    public let key: String
    public let rootTs: Int
    /// Milliseconds since the epoch of the newest message the list carries, or its newest edit.
    public let latestTs: Int
    /// The bundled title, else what a thread without one is called.
    public let title: String
    /// The newest reply, when it is from someone else and no relay, echo or title.
    public let reply: ThreadSnapshot.Message?
    public let voiceFile: String?

    public static func parse(_ root: JSON, ownUserId: String, trustedAccounts: Set<String> = []) -> ThreadListEntry? {
        guard let rootId = root.eventId else { return nil }
        let thread = ((root["unsigned"] as? JSON)?["m.relations"] as? JSON)?["m.thread"] as? JSON ?? [:]
        let latest = thread["latest_event"] as? JSON
        // The newest reply is mostly both `latest_event` and `io.mindroom.latest_reply`: once.
        var bundled: [String: JSON] = [:]
        for name in ["io.mindroom.title", "io.mindroom.latest_reply", "latest_event"] {
            if let event = thread[name] as? JSON, let id = event.eventId { bundled[id] = event }
        }
        let events = Array(bundled.values)
        let snapshot = ThreadSnapshot.build(root: root, related: events + ([root] + events).compactMap(\.bundledEdit),
                                            ownUserId: ownUserId, now: Date(), trustedAccounts: trustedAccounts)
        // An encrypted room's newest event cannot be read here; its time still says when the thread last moved.
        let encryptedTs = latest?["type"] as? String == "m.room.encrypted" ? latest?.timestamp ?? 0 : 0
        return ThreadListEntry(
            rootId: rootId, key: "\(latest?.eventId ?? rootId) \((thread["count"] as? NSNumber)?.intValue ?? 0)",
            rootTs: snapshot.rootTs, latestTs: max(snapshot.latestTs, encryptedTs), title: snapshot.title,
            reply: snapshot.reply, voiceFile: snapshot.voiceFile)
    }
}

/// What a thread's row says at its end, most urgent first.
public enum ThreadRowState: Equatable, Sendable {
    case failed, queued, needsYou, running, idle(Date)
}

/// A recording's meter samples (dB, -160 to 0) as bars from 0 to 1.
public enum Waveform {
    public static func bars(from levels: [Float], count: Int = 48) -> [Float] {
        guard !levels.isEmpty else { return Array(repeating: 0, count: count) }
        let scaled = levels.map { max(0, min(1, ($0 + 50) / 50)) }
        return (0..<count).map { index in
            let start = index * scaled.count / count
            let end = max(start + 1, (index + 1) * scaled.count / count)
            let slice = scaled[min(start, scaled.count - 1)..<min(end, scaled.count)]
            return slice.reduce(0, +) / Float(slice.count)
        }
    }
}
