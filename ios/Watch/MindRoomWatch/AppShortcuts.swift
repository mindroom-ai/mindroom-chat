import AppIntents

/// "Record in MindRoom": opens the app recording a voice message for the default room.
struct RecordIntent: AppIntent {
    static let title: LocalizedStringResource = "Record a voice message"
    static let description = IntentDescription("Opens MindRoom recording a voice message for your room.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        RecordRequest.shared.pending = true
        return .result()
    }
}

struct MindRoomShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: RecordIntent(), phrases: ["Record in \(.applicationName)", "Talk to \(.applicationName)"],
                    shortTitle: "Record", systemImageName: "mic.fill")
    }
}
