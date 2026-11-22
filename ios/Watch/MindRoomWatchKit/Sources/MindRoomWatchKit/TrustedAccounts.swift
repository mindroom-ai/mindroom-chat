import Foundation

/// Room accounts trusted to fold voice-transcript echoes, mirroring the web client's `routerBinding.ts`:
/// the account named by a self-written, privileged `io.mindroom.router` binding plus the joined accounts
/// listed in that account's own `io.mindroom.accounts` roster.
public enum TrustedAccounts {
    public static let routerEventType = "io.mindroom.router"
    public static let accountsEventType = "io.mindroom.accounts"

    public static func inRoom(state: [JSON]) -> Set<String> {
        var createEvent: JSON?
        var powerLevelsEvent: JSON?
        var bindingEvent: JSON?
        var rosters: [String: JSON] = [:]
        var joined = Set<String>()
        for event in state {
            guard let type = event["type"] as? String, let key = event["state_key"] as? String else { continue }
            switch type {
            case "m.room.create" where key.isEmpty: createEvent = event
            case "m.room.power_levels" where key.isEmpty: powerLevelsEvent = event
            case routerEventType where key.isEmpty: bindingEvent = event
            case accountsEventType where !key.isEmpty: rosters[key] = event
            case "m.room.member" where !key.isEmpty:
                if event.content["membership"] as? String == "join" { joined.insert(key) } else { joined.remove(key) }
            default: break
            }
        }
        guard let boundUserId = trustedBoundUserId(binding: bindingEvent, powerLevels: powerLevelsEvent, create: createEvent) else {
            return []
        }
        var trusted: Set<String> = [boundUserId]
        if let roster = rosters[boundUserId],
           roster["sender"] as? String == boundUserId,
           let accounts = roster.content["accounts"] as? [Any] {
            for case let id as String in accounts where joined.contains(id) {
                trusted.insert(id)
            }
        }
        return trusted
    }

    private static func trustedBoundUserId(binding: JSON?, powerLevels: JSON?, create: JSON?) -> String? {
        guard let binding,
              let userId = binding.content["user_id"] as? String, !userId.isEmpty,
              binding["sender"] as? String == userId,
              let rawLevels = powerLevels?.content else { return nil }
        let eventsMap = rawLevels["events"] as? JSON
        let usersMap = rawLevels["users"] as? JSON
        guard let stateDefault = jsonNumber(rawLevels["state_default"]),
              let usersDefault = jsonNumber(rawLevels["users_default"]),
              let eventLevel = jsonNumber(eventsMap?[routerEventType]),
              let userLevel = jsonNumber(usersMap?[userId]) else { return nil }
        let defaultUser = usersDefault ?? 0
        let writeLevel = eventLevel ?? stateDefault ?? 50
        guard writeLevel > defaultUser else { return nil }
        if creators(from: create).contains(userId) { return userId }
        return (userLevel ?? defaultUser) >= writeLevel ? userId : nil
    }

    private static func creators(from createEvent: JSON?) -> Set<String> {
        guard let createEvent else { return [] }
        let roomVersion = createEvent.content["room_version"] as? String ?? "1"
        guard hasPrivilegedCreators(roomVersion) else { return [] }
        var result = Set<String>()
        if let sender = createEvent["sender"] as? String, !sender.isEmpty { result.insert(sender) }
        if let additional = createEvent.content["additional_creators"] as? [Any] {
            for case let id as String in additional { result.insert(id) }
        }
        return result
    }

    private static func hasPrivilegedCreators(_ roomVersion: String) -> Bool {
        if roomVersion == "org.matrix.hydra.11" { return true }
        guard !roomVersion.isEmpty, roomVersion.unicodeScalars.allSatisfy({ ("0"..."9").contains($0) }) else { return false }
        return Int(roomVersion).map { $0 >= 12 } ?? true
    }
}
