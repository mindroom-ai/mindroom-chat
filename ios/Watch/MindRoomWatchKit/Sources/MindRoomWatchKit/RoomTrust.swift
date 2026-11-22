import Combine
import Foundation

/// What a room's state says for the watch: its trusted accounts (`TrustedAccounts`) and its resolved threads
/// (`ResolvedRoots`, which also says when the state is read). One object per room, which the threads list, an
/// open thread and a notification all read, so they build with the same trust. The accounts are empty until a
/// read succeeds.
@MainActor
public final class RoomTrust {
    private static var rooms: [String: RoomTrust] = [:]

    /// The room's trust, the same object for as long as the app runs. `cached`: the resolved threads it starts
    /// with, asked for only when it is made.
    public static func of(_ roomId: String, cached: @autoclosure () -> Set<String>) -> RoomTrust {
        if let trust = rooms[roomId] { return trust }
        let trust = RoomTrust(resolved: cached())
        rooms[roomId] = trust
        return trust
    }

    public private(set) var accounts: Set<String> = []
    public private(set) var resolved: ResolvedRoots
    /// Sends once a read changed `accounts` or the resolved threads: what was built with the old ones is built
    /// again.
    public let changed = PassthroughSubject<Void, Never>()
    private var reading: Task<Void, Never>?

    public init(resolved: Set<String> = []) { self.resolved = ResolvedRoots(resolved) }

    /// A thread was resolved from this watch: a read that began before does not open it again (`ResolvedRoots`).
    public func resolve(_ rootId: String) { resolved.resolve(rootId) }

    /// The room came to the front: the next `refresh` reads its state.
    public func expire() { resolved.expire() }

    /// Reads the room's state with `read` when that is due (`ResolvedRoots.isDue`), and waits for the read under
    /// way, this caller's or another's: there is one at a time, so none overtakes another. A read that fails
    /// changes nothing.
    public func refresh(now: Date = Date(), _ read: @escaping @MainActor () async -> [JSON]?) async {
        if resolved.isDue(now: now) {
            resolved.beginRead(now: now)
            reading = Task {
                let state = await read()
                let before = (accounts, resolved.roots)
                resolved.endRead(state.map(ThreadTags.resolvedRoots(state:)))
                if let state { accounts = TrustedAccounts.inRoom(state: state) }
                if (accounts, resolved.roots) != before { changed.send() }
            }
        }
        await reading?.value
    }
}
