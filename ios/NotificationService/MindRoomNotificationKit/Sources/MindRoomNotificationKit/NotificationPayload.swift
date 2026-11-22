import Foundation

/// Parsed MindRoom fields from an APNs notification `userInfo` dictionary.
public struct NotificationPayload: Equatable, Sendable {
    public let roomId: String?
    public let eventId: String?
    public let accountTag: String?
    public let sender: String?
    public let senderDisplayName: String?
    public let roomName: String?
    public let isRing: Bool
    public let isGatewayFormatted: Bool

    public init(
        roomId: String? = nil,
        eventId: String? = nil,
        accountTag: String? = nil,
        sender: String? = nil,
        senderDisplayName: String? = nil,
        roomName: String? = nil,
        isRing: Bool = false,
        isGatewayFormatted: Bool = false
    ) {
        self.roomId = Self.trimmedNonEmpty(roomId)
        self.eventId = Self.trimmedNonEmpty(eventId)
        self.accountTag = Self.trimmedNonEmpty(accountTag)
        self.sender = Self.trimmedNonEmpty(sender)
        self.senderDisplayName = Self.trimmedNonEmpty(senderDisplayName)
        self.roomName = Self.trimmedNonEmpty(roomName)
        self.isRing = isRing
        self.isGatewayFormatted = isGatewayFormatted
    }

    public init(userInfo: [AnyHashable: Any]) {
        self.roomId = Self.stringValue(userInfo["room_id"])
        self.eventId = Self.stringValue(userInfo["event_id"])
        self.accountTag = Self.stringValue(userInfo["mindroom_account"])
        self.sender = Self.stringValue(userInfo["sender"])
        self.senderDisplayName = Self.stringValue(userInfo["sender_display_name"])
        self.roomName = Self.stringValue(userInfo["room_name"])
        if let ringValue = userInfo["mindroom_ring"] {
            self.isRing = !(ringValue is NSNull)
        } else {
            self.isRing = false
        }
        self.isGatewayFormatted = Self.boolFlag(userInfo["mindroom_plain"])
    }

    public func effectiveSenderDisplayName(fallbackTitle: String) -> String {
        if let senderDisplayName {
            return senderDisplayName
        }
        if let title = Self.trimmedNonEmpty(fallbackTitle) {
            return title
        }
        if let sender {
            return sender
        }
        return ""
    }

    public func effectiveRoomName(fallbackSubtitle: String) -> String? {
        if let roomName {
            return roomName
        }
        return Self.trimmedNonEmpty(fallbackSubtitle)
    }

    private static func boolFlag(_ raw: Any?) -> Bool {
        if let number = raw as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue
            }
            return number.intValue == 1 && number.doubleValue == 1.0
        }
        if let boolValue = raw as? Bool {
            return boolValue
        }
        if let intValue = raw as? Int {
            return intValue == 1
        }
        return false
    }

    private static func stringValue(_ raw: Any?) -> String? {
        guard let str = raw as? String else { return nil }
        return trimmedNonEmpty(str)
    }

    private static func trimmedNonEmpty(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
