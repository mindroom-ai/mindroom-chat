import Foundation

/// What the complications and the Smart Stack widget show, written by the app into the app group.
public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public static let appGroup = "group.chat.mindroom.app"
    private static let key = "widgetSnapshot"

    public let roomName: String
    public let needsYou: Int
    public let running: Int
    public let updatedAt: Date

    public init(roomName: String, needsYou: Int, running: Int, updatedAt: Date) {
        self.roomName = roomName
        self.needsYou = needsYou
        self.running = running
        self.updatedAt = updatedAt
    }

    public init(roomName: String, states: [ThreadRowState], at date: Date) {
        self.init(roomName: roomName, needsYou: states.filter { $0 == .needsYou }.count,
                  running: states.filter { $0 == .running }.count, updatedAt: date)
    }

    public var summary: String {
        var parts: [String] = []
        if needsYou > 0 {
            parts.append(needsYou == 1 ? String(localized: "1 needs you") : String(localized: "\(needsYou) need you"))
        }
        if running > 0 { parts.append(String(localized: "\(running) running")) }
        return parts.isEmpty ? String(localized: "All quiet") : parts.joined(separator: " · ")
    }

    public static func read(from defaults: UserDefaults? = UserDefaults(suiteName: appGroup)) -> WidgetSnapshot? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    public func write(to defaults: UserDefaults? = UserDefaults(suiteName: appGroup)) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults?.set(data, forKey: Self.key)
    }
}
