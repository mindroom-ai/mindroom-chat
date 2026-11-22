import Combine
import Foundation

/// A room's trusted accounts (`TrustedAccounts`) as its state last read gave them: the one value the threads
/// list, an open thread and a notification build with. Empty until a read succeeds.
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
    /// Sends once `accounts` changed: what was built with the old ones is built again.
    public let changed = PassthroughSubject<Void, Never>()
    private var readAt: Date?
    private var reads = 0
    private var applied = 0

    public init() {}

    /// Reads the room's state with `read` and takes the trusted accounts from it, unless a read began less
    /// than `age` seconds ago. A read that fails keeps the accounts, and so does one that ends after a read
    /// that began later (two callers' reads can overlap). Returns the state it took, else nil.
    @discardableResult
    public func refresh(ifOlderThan age: TimeInterval = 0, now: Date = Date(),
                        _ read: @MainActor () async -> [JSON]?) async -> [JSON]? {
        // A clock set back since the last read holds up no read.
        if let readAt, (0..<age).contains(now.timeIntervalSince(readAt)) { return nil }
        readAt = now
        reads += 1
        let id = reads
        guard let state = await read(), id > applied else { return nil }
        applied = id
        let next = TrustedAccounts.inRoom(state: state)
        if next != accounts {
            accounts = next
            changed.send()
        }
        return state
    }
}
