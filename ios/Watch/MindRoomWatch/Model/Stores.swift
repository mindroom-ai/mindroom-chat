import Foundation

/// The room voice messages go to, per account, on this watch.
enum DefaultRoom {
    private static func key(_ userId: String) -> String { "defaultRoom:\(userId)" }

    static func get(userId: String) -> String? { UserDefaults.standard.string(forKey: key(userId)) }

    static func set(_ roomId: String?, userId: String) {
        UserDefaults.standard.set(roomId, forKey: key(userId))
    }
}
