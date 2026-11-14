import SwiftUI
import WidgetKit

@main
struct MindRoomWatchWidgets: WidgetBundle {
    var body: some Widget {
        RecordComplication()
    }
}

struct RecordComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "record", provider: Provider()) { _ in
            Image(systemName: "mic.fill")
        }
        .configurationDisplayName("Record")
        .supportedFamilies([.accessoryCircular])
    }
}

struct Entry: TimelineEntry {
    let date: Date
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}
