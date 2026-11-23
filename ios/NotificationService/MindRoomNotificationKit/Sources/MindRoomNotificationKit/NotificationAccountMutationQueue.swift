import Foundation

/// Runs the changes of what the app shares with the notification extension (an account stored,
/// the accounts reconciled, avatars listed, stored or cleared) one at a time, in the order they
/// were handed in.
///
/// A reconcile is not done at once: it waits for the system to delete donated interactions. An
/// account that is stored meanwhile must not be stored before the reconcile is over, or the rest
/// of the reconcile would take away what belongs to the new account.
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

/// The deletions of donated interactions (`INInteraction`), which a test stands in for.
public struct NotificationInteractionDeleter: Sendable {
    public var deleteAll: @Sendable () async throws -> Void
    /// Deletes the interactions of an account, which are donated under its tag as the group.
    public var deleteGroup: @Sendable (_ groupIdentifier: String) async throws -> Void
    public var deleteInteraction: @Sendable (_ interactionIdentifier: String) async throws -> Void

    public init(
        deleteAll: @escaping @Sendable () async throws -> Void,
        deleteGroup: @escaping @Sendable (_ groupIdentifier: String) async throws -> Void,
        deleteInteraction: @escaping @Sendable (_ interactionIdentifier: String) async throws -> Void
    ) {
        self.deleteAll = deleteAll
        self.deleteGroup = deleteGroup
        self.deleteInteraction = deleteInteraction
    }
}

/// The changes of what the app shares with the notification extension: the accounts
/// (`NotificationAccountStore`), their avatars (`NotificationAvatarStore`), and what the
/// extension donated for their messages.
///
/// Its calls are made from a `NotificationAccountMutationQueue` only, one at a time.
public final class NotificationAccountMutations: @unchecked Sendable {
    public struct AvatarEntry: Equatable, Sendable {
        public let roomId: String
        public let sender: String
        public let mxcUrl: String

        public init(roomId: String, sender: String, mxcUrl: String) {
            self.roomId = roomId
            self.sender = sender
            self.mxcUrl = mxcUrl
        }
    }

    public struct AvatarSync: Equatable, Sendable {
        /// The avatars the cache lacks, for the caller to download and hand to `storeAvatar`.
        public let missingMxcUrls: [String]
        /// What `storeAvatar` must be given; 0 for an account that is not shared.
        public let syncGeneration: Int
    }

    private let accounts: NotificationAccountStore
    private let avatars: NotificationAvatarStore
    private let interactions: NotificationInteractionDeleter
    private var accountGenerations: [String: Int] = [:]
    private var clearAllGeneration = 0

    public init(
        accounts: NotificationAccountStore,
        avatars: NotificationAvatarStore,
        interactions: NotificationInteractionDeleter
    ) {
        self.accounts = accounts
        self.avatars = avatars
        self.interactions = interactions
    }

    /// Stores the account for the extension; false when it could not be written.
    public func syncAccount(accountTag: String, userId: String) -> Bool {
        guard accounts.saveAccount(accountTag: accountTag, userId: userId) else {
            return false
        }
        // The account shares again: a delete of its interactions that is still owed from an
        // earlier removal would take away what is donated from now on. A delete owed for one
        // interaction stays, as that interaction is of the earlier sharing.
        accounts.removePendingGroupDelete(accountTag)
        return true
    }

    /// Makes the shared accounts none but `allowedAccountTags`: every other account goes, with
    /// its avatars and what was donated for it. False when the system refused a delete of
    /// donated interactions; what it refused stays noted down, and the next call tries it again.
    public func reconcileAccounts(allowedAccountTags: Set<String>) async -> Bool {
        for accountTag in accounts.allAccountTags().subtracting(allowedAccountTags) {
            // Noted down first: a removal that is cut off still owes the delete.
            accounts.recordPendingGroupDelete(accountTag)
            accounts.removeAccount(accountTag: accountTag)
            accountGenerations[accountTag, default: 0] += 1
        }
        avatars.pruneAccounts(keeping: allowedAccountTags)

        if allowedAccountTags.isEmpty {
            accounts.removeAllAccounts()
            avatars.clearAll()
            clearAllGeneration += 1
            do {
                try await interactions.deleteAll()
            } catch {
                return false
            }
            accounts.clearAllPendingDeletes()
            return true
        }

        var deletedAll = true
        let pending = accounts.pendingDeletes()
        for interactionIdentifier in pending.interactionIdentifiers {
            do {
                try await interactions.deleteInteraction(interactionIdentifier)
                accounts.removePendingInteractionDelete(interactionIdentifier)
            } catch {
                deletedAll = false
            }
        }
        for groupIdentifier in pending.groupIdentifiers where !allowedAccountTags.contains(groupIdentifier) {
            do {
                try await interactions.deleteGroup(groupIdentifier)
                accounts.removePendingGroupDelete(groupIdentifier)
            } catch {
                deletedAll = false
            }
        }
        return deletedAll
    }

    /// Makes the account's cached avatars none but `entries` and says which of them the cache
    /// lacks. Every call gets a generation of its own: an avatar that is handed in for an
    /// earlier one is not stored, neither over this list's avatars nor one this list removed.
    public func syncAvatars(accountTag: String, entries: [AvatarEntry]) -> AvatarSync {
        guard accounts.loadAccount(accountTag: accountTag) != nil else {
            return AvatarSync(missingMxcUrls: [], syncGeneration: 0)
        }
        accountGenerations[accountTag, default: 0] += 1
        let missingMxcUrls = avatars.reconcileAccount(
            accountTag: accountTag,
            desiredEntries: entries.map { entry -> (roomId: String?, sender: String, mxcUrl: String) in
                (roomId: entry.roomId, sender: entry.sender, mxcUrl: entry.mxcUrl)
            }
        )
        return AvatarSync(
            missingMxcUrls: missingMxcUrls,
            syncGeneration: currentGeneration(of: accountTag)
        )
    }

    /// Stores an avatar that `syncAvatars` found missing, for every room and sender that show it.
    /// Nothing is stored for an account that is no longer shared, nor for another generation
    /// than the account's latest.
    public func storeAvatar(
        accountTag: String,
        syncGeneration: Int,
        mxcUrl: String,
        entries: [(roomId: String, sender: String)],
        data: Data
    ) {
        guard accounts.loadAccount(accountTag: accountTag) != nil,
              currentGeneration(of: accountTag) == syncGeneration else {
            return
        }
        for entry in entries {
            avatars.storeAvatar(
                accountTag: accountTag,
                roomId: entry.roomId,
                sender: entry.sender,
                mxcUrl: mxcUrl,
                data: data
            )
        }
    }

    /// Removes every cached avatar. The accounts and what was donated for them stay.
    public func clearAvatarCache() {
        clearAllGeneration += 1
        avatars.clearAll()
    }

    /// A number that changes when the account's avatars are listed, the account is removed, or
    /// every avatar is cleared; neither count ever goes down, so it never comes back to an
    /// earlier value.
    private func currentGeneration(of accountTag: String) -> Int {
        clearAllGeneration + (accountGenerations[accountTag] ?? 0)
    }
}
