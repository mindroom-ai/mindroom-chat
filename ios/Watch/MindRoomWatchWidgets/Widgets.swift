import MindRoomWatchKit
import SwiftUI
import WidgetKit

@main
struct MindRoomWatchWidgets: WidgetBundle {
    var body: some Widget {
        RecordComplication()
        RoomStatusWidget()
    }
}

private enum WidgetPalette {
    static let teal = Color(red: 0x45 / 255.0, green: 0xB5 / 255.0, blue: 0xC9 / 255.0)
    static let tealBright = Color(red: 0x70 / 255.0, green: 0xD2 / 255.0, blue: 0xE3 / 255.0)
    static let amber = Color(red: 0xF5 / 255.0, green: 0xB9 / 255.0, blue: 0x52 / 255.0)
    static let amberWarm = Color(red: 0xFF / 255.0, green: 0xCF / 255.0, blue: 0x75 / 255.0)
}

/// A round complication: one tap opens the app recording.
struct RecordComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "record", provider: SnapshotProvider()) { _ in
            ZStack {
                AccessoryWidgetBackground()
                Circle()
                    .fill(WidgetPalette.teal.opacity(0.16))
                Circle()
                    .strokeBorder(
                        LinearGradient(
                            colors: [WidgetPalette.tealBright, WidgetPalette.teal],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 2
                    )
                    .widgetAccentable()
                Image(systemName: "mic.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(WidgetPalette.tealBright)
                    .widgetAccentable()
            }
            .widgetURL(URL(string: "mindroom-watch://record"))
            .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Record")
        .description("Record a voice message for MindRoom.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner])
    }
}

/// The default room and what in it needs the person: on the face and in the Smart Stack.
struct RoomStatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "status", provider: SnapshotProvider()) { entry in
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Image(systemName: "bubble.left.and.text.bubble.right.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(WidgetPalette.tealBright)
                        .widgetAccentable()
                    Text(entry.snapshot?.roomName ?? "MindRoom")
                        .font(.headline)
                        .lineLimit(1)
                        .widgetAccentable()
                }
                if let snapshot = entry.snapshot {
                    if snapshot.needsYou > 0 {
                        HStack(spacing: 5) {
                            Text(snapshot.needsYou == 1
                                 ? String(localized: "1 needs you")
                                 : String(localized: "\(snapshot.needsYou) need you"))
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(WidgetPalette.amberWarm)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(WidgetPalette.amber.opacity(0.24)))
                                .lineLimit(1)
                            if snapshot.running > 0 {
                                HStack(spacing: 3) {
                                    Circle()
                                        .fill(WidgetPalette.tealBright)
                                        .frame(width: 5, height: 5)
                                        .accessibilityHidden(true)
                                    Text("\(snapshot.running) running")
                                        .font(.caption2.weight(.semibold).monospacedDigit())
                                        .foregroundStyle(WidgetPalette.tealBright)
                                        .lineLimit(1)
                                }
                            }
                        }
                    } else if snapshot.running > 0 {
                        HStack(spacing: 5) {
                            Circle()
                                .fill(WidgetPalette.tealBright)
                                .frame(width: 6, height: 6)
                                .widgetAccentable()
                                .accessibilityHidden(true)
                            Text("\(snapshot.running) running")
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(WidgetPalette.tealBright)
                                .lineLimit(1)
                        }
                    } else {
                        Text("All quiet")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                } else {
                    Text("Open MindRoom to choose a room")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel(for: entry.snapshot))
            .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("MindRoom")
        .description("What needs you in your MindRoom room.")
        .supportedFamilies([.accessoryRectangular])
    }

    private func accessibilityLabel(for snapshot: WidgetSnapshot?) -> String {
        guard let snapshot else {
            return String(localized: "MindRoom") + ", " + String(localized: "Open MindRoom to choose a room")
        }
        return "\(snapshot.roomName), \(snapshot.summary)"
    }
}

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: .now, snapshot: WidgetSnapshot(roomName: "Notes", needsYou: 2, running: 1, updatedAt: .now))
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : SnapshotEntry(date: .now, snapshot: WidgetSnapshot.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // The app reloads the timelines when the room changes.
        completion(Timeline(entries: [SnapshotEntry(date: .now, snapshot: WidgetSnapshot.read())], policy: .never))
    }
}
