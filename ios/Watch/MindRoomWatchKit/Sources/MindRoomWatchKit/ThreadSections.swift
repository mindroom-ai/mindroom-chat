import Foundation

/// Workflow buckets on the watch home screen, matching MindRoom Chat's room sections.
public enum ThreadSectionKind: CaseIterable, Equatable, Hashable, Sendable {
    case needsYou
    case working
    case recent
}

/// One collapsible group of thread rows on the home screen.
public struct ThreadSection<Item>: Identifiable {
    public let kind: ThreadSectionKind
    public let items: [Item]

    public var id: ThreadSectionKind { kind }

    public init(kind: ThreadSectionKind, items: [Item]) {
        self.kind = kind
        self.items = items
    }
}

extension ThreadSection: Equatable where Item: Equatable {}
extension ThreadSection: Sendable where Item: Sendable {}

/// Splits thread rows into non-empty workflow sections in `[.needsYou, .working, .recent]` order,
/// preserving input order within each section. Failed sends stay in `.needsYou` because they require
/// user action; queued sends appear under `.working` while in flight.
public func groupThreadRows<Item>(_ items: [Item], state: (Item) -> ThreadRowState) -> [ThreadSection<Item>] {
    var buckets: [ThreadSectionKind: [Item]] = [:]
    for item in items {
        let kind: ThreadSectionKind = switch state(item) {
        case .failed, .needsYou: .needsYou
        case .queued, .running: .working
        case .idle: .recent
        }
        buckets[kind, default: []].append(item)
    }
    return ThreadSectionKind.allCases.compactMap { kind in
        guard let grouped = buckets[kind], !grouped.isEmpty else { return nil }
        return ThreadSection(kind: kind, items: grouped)
    }
}

/// Compact locale-aware duration labels for finished agent work folds (e.g. `14s`, `2m 5s`, `1h 3m`).
public enum DurationLabel {
    public static func format(seconds: Int, locale: Locale = .current) -> String {
        let clamped = max(0, seconds)
        if clamped == 0 {
            return Duration.seconds(0).formatted(.units(allowed: [.seconds], width: .narrow, zeroValueUnits: .show(length: 1)).locale(locale))
        }
        let allowed: Set<Duration.UnitsFormatStyle.Unit> =
            clamped < 60 ? [.seconds] : clamped < 3600 ? [.minutes, .seconds] : [.hours, .minutes]
        let rounded = clamped >= 3600 ? (clamped / 60) * 60 : clamped
        return Duration.seconds(rounded).formatted(.units(allowed: allowed, width: .narrow).locale(locale))
    }
}
