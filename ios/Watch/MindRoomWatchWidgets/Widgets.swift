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

/// A round complication: one tap opens the app recording.
struct RecordComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "record", provider: SnapshotProvider()) { _ in
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill").font(.title3)
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
            VStack(alignment: .leading, spacing: 2) {
                Label(entry.snapshot?.roomName ?? "MindRoom", systemImage: "bubble.left.and.text.bubble.right")
                    .font(.headline)
                    .widgetAccentable()
                Text(entry.snapshot?.summary ?? String(localized: "Open MindRoom to choose a room"))
                    .font(.footnote)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("MindRoom")
        .description("What needs you in your MindRoom room.")
        .supportedFamilies([.accessoryRectangular])
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
