import Foundation
import MindRoomWatchKit
import WatchKit
import WidgetKit

/// Every 30 minutes in the background: sync once and update the complications.
enum BackgroundRefresh {
    static let identifier = "refresh"

    static func schedule() {
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: Date(timeIntervalSinceNow: 30 * 60), userInfo: identifier as NSString) { _ in }
    }

    @MainActor
    static func run(_ session: MatrixSession) async {
        defer { schedule() }
        await session.restore()
        guard let client = session.client, let userId = try? client.userId(),
              let roomId = DefaultRoom.get(userId: userId), let room = try? client.getRoom(roomId: roomId) else { return }
        await session.setActive(true)
        // Room state and threads arrive with the first sync; give it a few seconds.
        try? await Task.sleep(nanoseconds: 8_000_000_000)
        let model = RoomModel(room: room, userId: userId, session: try? client.session())
        await model.refreshNow()
        // The person may have opened the app meanwhile: its sync stays on.
        if WKApplication.shared().applicationState != .active { await session.setActive(false) }
    }
}

extension RoomModel {
    /// Writes what the complications show when it changed, and asks them to redraw.
    func publishWidgetSnapshot() {
        // The complications show the default room; a room a notification opened has a model too.
        guard DefaultRoom.get(userId: userId) == room.id() else { return }
        let snapshot = WidgetSnapshot(roomName: roomName, states: rows.map(\.state), at: Date())
        let old = WidgetSnapshot.read()
        guard old?.roomName != snapshot.roomName || old?.needsYou != snapshot.needsYou || old?.running != snapshot.running else { return }
        snapshot.write()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
