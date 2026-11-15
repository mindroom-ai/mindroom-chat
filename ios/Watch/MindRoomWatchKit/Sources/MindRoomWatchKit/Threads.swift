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
