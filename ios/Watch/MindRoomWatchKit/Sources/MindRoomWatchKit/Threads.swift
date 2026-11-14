import Foundation

/// Thread tags (`com.mindroom.thread.tags` state), as the web client writes them.
public enum ThreadTags {
    public static let eventType = "com.mindroom.thread.tags"

    public static func resolvedStateKey(root: String) -> String { key(root, "resolved") }

    public static func resolvedContent(userId: String, at date: Date) -> JSON {
        let formatter = ISO8601DateFormatter()
        return ["set_by": userId, "set_at": formatter.string(from: date)]
    }

    /// The roots whose thread is resolved and not pinned.
    public static func resolvedRoots(state: [JSON]) -> Set<String> {
        var resolved = Set<String>(), pinned = Set<String>()
        for event in state where event["type"] as? String == eventType {
            guard let stateKey = event["state_key"] as? String else { continue }
            let content = event.content
            if let parts = try? JSONSerialization.jsonObject(with: Data(stateKey.utf8)) as? [String], parts.count == 2 {
                guard !content.isEmpty else { continue }
                if parts[1] == "resolved" { resolved.insert(parts[0]) }
                if parts[1] == "pinned" { pinned.insert(parts[0]) }
            } else if let tags = content["tags"] as? JSON {
                if tags["resolved"] != nil { resolved.insert(stateKey) }
                if tags["pinned"] != nil { pinned.insert(stateKey) }
            }
        }
        return resolved.subtracting(pinned)
    }

    private static func key(_ root: String, _ tag: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [root, tag], options: [.withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }
}

/// What a thread's row says at its end, most urgent first.
public enum ThreadRowState: Equatable, Sendable {
    case failed, queued, needsYou, running, unread, idle(Date)

    public static func of(latest: JSON?, latestEdit: JSON?, pendingApproval: Bool, openQuestion: Bool,
                          lastSeenEventId: String?, sendFailed: Bool, queued: Bool) -> ThreadRowState {
        if sendFailed { return .failed }
        if queued { return .queued }
        if pendingApproval || openQuestion { return .needsYou }
        if let latest, RunState.of(latest, latestEdit: latestEdit) == .streaming { return .running }
        if let id = latest?.eventId, id != lastSeenEventId { return .unread }
        return .idle(Date(timeIntervalSince1970: Double(latest?.timestamp ?? 0) / 1000))
    }
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
