import Foundation

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

/// Persisted `[rootId: title]` per room, written whenever a thread title or voice transcript is seen.
enum ThreadTitleCache {
    private static let maxEntries = 500
    private static func key(userId: String, roomId: String) -> String { "threadTitles:\(userId):\(roomId)" }

    static func all(userId: String, roomId: String) -> [String: String] {
        UserDefaults.standard.dictionary(forKey: key(userId: userId, roomId: roomId)) as? [String: String] ?? [:]
    }

    static func get(userId: String, roomId: String, rootId: String) -> String? {
        all(userId: userId, roomId: roomId)[rootId]
    }

    static func set(_ title: String, userId: String, roomId: String, rootId: String) {
        guard !title.isEmpty else { return }
        var map = all(userId: userId, roomId: roomId)
        guard map[rootId] != title else { return }
        if map.count >= maxEntries, map[rootId] == nil, let oldest = map.keys.first {
            map.removeValue(forKey: oldest)
        }
        map[rootId] = title
        UserDefaults.standard.set(map, forKey: key(userId: userId, roomId: roomId))
    }
}
