import Foundation
import MindRoomWatchKit

/// The room voice messages go to, per account, on this watch.
enum DefaultRoom {
    private static func key(_ userId: String) -> String { "defaultRoom:\(userId)" }

    static func get(userId: String) -> String? { UserDefaults.standard.string(forKey: key(userId)) }

    static func set(_ roomId: String?, userId: String) {
        UserDefaults.standard.set(roomId, forKey: key(userId))
    }
}

/// Last known resolved (and not pinned) thread roots per room, used for instant first paint before `/state` returns.
enum ResolvedCache {
    private static func key(userId: String, roomId: String) -> String { "resolvedRoots:\(userId):\(roomId)" }

    static func get(userId: String, roomId: String) -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key(userId: userId, roomId: roomId)) ?? [])
    }

    static func set(_ roots: Set<String>, userId: String, roomId: String) {
        UserDefaults.standard.set(Array(roots), forKey: key(userId: userId, roomId: roomId))
    }
}

/// Shared per-account, per-room deadline for `/state` reads (5 min after success, 1 min backoff after failure),
/// shared across foreground, background, and periodic refreshes.
enum StateDeadlineCache {
    private static func key(userId: String, roomId: String) -> String { "stateDeadline:\(userId):\(roomId)" }

    static func isDue(userId: String, roomId: String, now: Date = Date()) -> Bool {
        let nextAllowed = UserDefaults.standard.double(forKey: key(userId: userId, roomId: roomId))
        return now.timeIntervalSince1970 >= nextAllowed
    }

    static func setNextAllowed(_ date: Date, userId: String, roomId: String) {
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: key(userId: userId, roomId: roomId))
    }
}

/// Persisted `[rootId: KnownTitle]` per room with source event id, kind, and timestamp-based LRU eviction.
enum ThreadTitleCache {
    private static let maxEntries = 500
    private static func key(userId: String, roomId: String) -> String { "threadTitlesV2:\(userId):\(roomId)" }

    private static func rawMap(userId: String, roomId: String) -> [String: [String: Any]] {
        UserDefaults.standard.dictionary(forKey: key(userId: userId, roomId: roomId)) as? [String: [String: Any]] ?? [:]
    }

    private static func decode(_ entry: [String: Any]) -> KnownTitle? {
        guard let text = entry["t"] as? String, !text.isEmpty,
              let source = entry["s"] as? String,
              let kindRaw = entry["k"] as? String,
              let kind = KnownTitle.Kind(rawValue: kindRaw) else { return nil }
        return KnownTitle(text: text, sourceEventId: source, kind: kind)
    }

    static func all(userId: String, roomId: String) -> [String: KnownTitle] {
        var result: [String: KnownTitle] = [:]
        for (rootId, entry) in rawMap(userId: userId, roomId: roomId) {
            if let title = decode(entry) { result[rootId] = title }
        }
        return result
    }

    static func get(userId: String, roomId: String, rootId: String) -> KnownTitle? {
        rawMap(userId: userId, roomId: roomId)[rootId].flatMap(decode)
    }

    static func set(_ title: KnownTitle, userId: String, roomId: String, rootId: String, now: Date = Date()) {
        guard !title.text.isEmpty else { return }
        var map = rawMap(userId: userId, roomId: roomId)
        if let existing = map[rootId].flatMap(decode), existing == title { return }
        if map.count >= maxEntries, map[rootId] == nil {
            if let oldest = map.min(by: { ($0.value["at"] as? Double ?? 0) < ($1.value["at"] as? Double ?? 0) })?.key {
                map.removeValue(forKey: oldest)
            }
        }
        map[rootId] = [
            "t": title.text,
            "s": title.sourceEventId,
            "k": title.kind.rawValue,
            "at": now.timeIntervalSince1970,
        ]
        UserDefaults.standard.set(map, forKey: key(userId: userId, roomId: roomId))
    }

    static func remove(userId: String, roomId: String, rootId: String) {
        var map = rawMap(userId: userId, roomId: roomId)
        guard map.removeValue(forKey: rootId) != nil else { return }
        UserDefaults.standard.set(map, forKey: key(userId: userId, roomId: roomId))
    }
}
