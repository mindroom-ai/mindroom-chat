import Foundation
import MatrixRustSDK

/// The joined rooms that are not spaces, most recently active first (the SDK's room list order).
@MainActor
final class RoomList: ObservableObject {
    struct Entry: Identifiable, Equatable {
        let id: String
        let name: String
    }

    @Published private(set) var rooms: [Entry] = []
    private var result: RoomListEntriesWithDynamicAdaptersResult?
    private var feed: RoomFeed?

    func start(_ syncService: SyncService) async {
        guard result == nil else { return }
        do {
            let list = try await syncService.roomListService().allRooms()
            let feed = RoomFeed { [weak self] rooms in
                self?.rooms = rooms.map { Entry(id: $0.id(), name: $0.displayName() ?? $0.id()) }
            }
            let result = list.entriesWithDynamicAdapters(pageSize: 50, listener: feed)
            _ = result.controller().setFilter(kind: .all(filters: [.joined, .nonSpace, .deduplicateVersions]))
            self.feed = feed
            self.result = result
        } catch {
            rooms = []
        }
    }
}

private final class RoomFeed: RoomListEntriesListener, @unchecked Sendable {
    private let lock = NSLock()
    private var rooms: [Room] = []
    private let onChange: @MainActor ([Room]) -> Void

    init(onChange: @escaping @MainActor ([Room]) -> Void) { self.onChange = onChange }

    func onUpdate(roomEntriesUpdate: [RoomListEntriesUpdate]) {
        lock.lock()
        for change in roomEntriesUpdate {
            switch change {
            case let .append(values): rooms += values
            case .clear: rooms = []
            case let .pushFront(value): rooms.insert(value, at: 0)
            case let .pushBack(value): rooms.append(value)
            case .popFront: if !rooms.isEmpty { rooms.removeFirst() }
            case .popBack: if !rooms.isEmpty { rooms.removeLast() }
            case let .insert(index, value): rooms.insert(value, at: min(Int(index), rooms.count))
            case let .set(index, value): if Int(index) < rooms.count { rooms[Int(index)] = value }
            case let .remove(index): if Int(index) < rooms.count { rooms.remove(at: Int(index)) }
            case let .truncate(length): rooms = Array(rooms.prefix(Int(length)))
            case let .reset(values): rooms = values
            }
        }
        let snapshot = rooms
        lock.unlock()
        Task { @MainActor in onChange(snapshot) }
    }
}
