import Foundation

/// The room voice messages go to, per account, on this watch.
enum DefaultRoom {
    private static func key(_ userId: String) -> String { "defaultRoom:\(userId)" }

    static func get(userId: String) -> String? { UserDefaults.standard.string(forKey: key(userId)) }

    static func set(_ roomId: String?, userId: String) {
        UserDefaults.standard.set(roomId, forKey: key(userId))
    }
}

/// The room's resolved threads as its state last said, per account: the thread list shows without them before
/// the state is read again. Written only by the model the app shows (`RoomModel.persistsResolved`).
enum ResolvedCache {
    private static func key(userId: String, roomId: String) -> String { "resolvedRoots:\(userId):\(roomId)" }

    static func get(userId: String, roomId: String) -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key(userId: userId, roomId: roomId)) ?? [])
    }

    static func set(_ roots: Set<String>, userId: String, roomId: String) {
        UserDefaults.standard.set(Array(roots), forKey: key(userId: userId, roomId: roomId))
    }
}
