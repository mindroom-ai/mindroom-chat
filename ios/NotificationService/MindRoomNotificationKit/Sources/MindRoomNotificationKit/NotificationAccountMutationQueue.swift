import Foundation

/// Runs the changes of what the app shares with the notification extension (an account stored,
/// an account removed, all of them removed) one at a time, in the order they were handed in.
///
/// A removal is not done at once: it waits for the system to delete the account's donated
/// interactions. An account that is stored again meanwhile must not be stored before the removal
/// is over, or the rest of the removal would take away what belongs to the new account.
public final class NotificationAccountMutationQueue: @unchecked Sendable {
    private let lock = NSLock()
    private var last: Task<Void, Never>?

    public init() {}

    /// Hands in `mutation`, which runs once every mutation handed in before it is done. Its
    /// place in the order is taken before this returns, so two calls made one after the other
    /// run in that order, however long the first one waits. The returned task ends with it.
    @discardableResult
    public func enqueue(_ mutation: @escaping @Sendable () async -> Void) -> Task<Void, Never> {
        lock.lock()
        defer { lock.unlock() }
        let previous = last
        let task = Task<Void, Never> {
            if let previous {
                await previous.value
            }
            await mutation()
        }
        last = task
        return task
    }
}

/// The removal of what an account, or every account, shares with the notification extension.
public enum NotificationAccountCleanup {
    public enum Outcome: Equatable, Sendable {
        /// The Keychain holds no record and the donated interactions are deleted.
        case removed
        /// The Keychain kept a record.
        case keychainKeptRecord
        /// The system did not delete the donated interactions.
        case interactionsNotDeleted
    }

    /// Removes the record and then deletes the interactions, also after a record that stayed.
    /// The removal is done only when both are: an interaction that Siri keeps still names the
    /// account's rooms and senders, so the caller has to know that it must try again.
    ///
    /// - Parameters:
    ///   - removeSharedState: Removes the record and the cached avatars; false when the Keychain kept the record.
    ///   - deleteInteractions: Deletes the donated interactions; throws when the system does not.
    public static func run(
        removeSharedState: () -> Bool,
        deleteInteractions: () async throws -> Void
    ) async -> Outcome {
        let recordRemoved = removeSharedState()
        do {
            try await deleteInteractions()
        } catch {
            return recordRemoved ? .interactionsNotDeleted : .keychainKeptRecord
        }
        return recordRemoved ? .removed : .keychainKeptRecord
    }
}
