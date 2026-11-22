import Combine
import Foundation

/// What a room's state, as last read, says for the watch: its trusted accounts (`TrustedAccounts`) and its
/// resolved threads (`ThreadTags`), both of the same read. The one value the threads list, an open thread and
/// a notification build with. Empty until a read succeeds.
@MainActor
public final class RoomTrust {
    private static var rooms: [String: RoomTrust] = [:]

    /// The room's trust, the same object for as long as the app runs.
    public static func of(_ roomId: String) -> RoomTrust {
        if let trust = rooms[roomId] { return trust }
        let trust = RoomTrust()
        rooms[roomId] = trust
        return trust
    }

    public private(set) var accounts: Set<String> = []
    /// The roots of the resolved threads: those of the read `accounts` are of, whoever asked for it (the
    /// threads list has them when a notification's read counted and not its own), and those resolved here
    /// since (`resolve`).
    public private(set) var resolved: Set<String> = []
    /// Sends once `accounts` changed: what was built with the old ones is built again.
    public let changed = PassthroughSubject<Void, Never>()
    private var readAt: Date?
    private var reads = 0
    private var applied = 0
    private var reading: Task<Void, Never>?

    public init() {}

    /// A thread was resolved from this watch: it is resolved until a read says otherwise.
    public func resolve(_ rootId: String) { resolved.insert(rootId) }

    /// Reads the room's state with `read` and takes the trusted accounts and the resolved threads from it,
    /// unless a read began less than `age` seconds ago. A read that fails changes nothing, and neither does
    /// one that ends after a read that began later (two callers' reads can overlap).
    public func refresh(ifOlderThan age: TimeInterval = 0, now: Date = Date(),
                        _ read: @escaping @MainActor () async -> [JSON]?) async {
        // A clock set back since the last read holds up no read.
        if let readAt, (0..<age).contains(now.timeIntervalSince(readAt)) { return }
        readAt = now
        reads += 1
        let id = reads
        let task = Task {
            guard let state = await read(), id > applied else { return }
            applied = id
            resolved = ThreadTags.resolvedRoots(state: state)
            let next = TrustedAccounts.inRoom(state: state)
            if next != accounts {
                accounts = next
                changed.send()
            }
        }
        reading = task
        await task.value
        if reading == task { reading = nil }
    }

    /// Waits for the read under way, or reads when there is none: a notification does not ask again for the
    /// state another caller is reading.
    public func refreshOrJoin(_ read: @escaping @MainActor () async -> [JSON]?) async {
        if let reading { await reading.value } else { await refresh(read) }
    }
}
