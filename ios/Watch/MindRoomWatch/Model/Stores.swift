import Foundation

/// The room voice messages go to, per account, on this watch.
enum DefaultRoom {
    private static func key(_ userId: String) -> String { "defaultRoom:\(userId)" }

    static func get(userId: String) -> String? { UserDefaults.standard.string(forKey: key(userId)) }

    static func set(_ roomId: String?, userId: String) {
        UserDefaults.standard.set(roomId, forKey: key(userId))
    }
}

/// The newest event seen of each thread on this watch, for the unread dot.
enum SeenStore {
    private static let key = "seenThreads"

    static func lastSeen(_ threadId: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: key) as? [String: String])?[threadId]
    }

    static func markSeen(_ threadId: String, eventId: String) {
        var seen = UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
        seen[threadId] = eventId
        // Keep it small: the newest 200 threads are plenty for a room's first page.
        if seen.count > 200 { seen = Dictionary(uniqueKeysWithValues: seen.suffix(200).map { ($0.key, $0.value) }) }
        UserDefaults.standard.set(seen, forKey: key)
    }
}
