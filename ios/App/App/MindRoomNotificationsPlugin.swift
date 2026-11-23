#if !targetEnvironment(macCatalyst)
import Capacitor
import Foundation
import Intents
import MindRoomNotificationKit

/// One joined member's avatar in one room.
private struct AvatarSyncEntry: Sendable {
    let roomId: String
    let sender: String
    let mxcUrl: String
}

/// Serializes what the app shares with the notification extension for each account: its record,
/// the avatar sync tasks and their generation counters, so that an in-flight download can never
/// bring an account's cache back after `clearAccount` or `clearAllAccounts`, nor write over the
/// result of a later sync.
private final class AvatarSyncCoordinator: @unchecked Sendable {
    private static let maxConcurrentDownloads = 4

    private let lock = NSLock()
    private var syncTasks: [String: Task<Void, Never>] = [:]
    private var accountGenerations: [String: UInt64] = [:]
    private var clearAllGeneration: UInt64 = 0

    deinit {
        lock.lock()
        let tasks = Array(syncTasks.values)
        syncTasks.removeAll()
        lock.unlock()
        tasks.forEach { $0.cancel() }
    }

    /// Stores the account's record for the extension; false when the Keychain did not take it.
    /// Under the lock, so that a record read here cannot be one that a clear removes meanwhile.
    func saveAccount(
        accountTag: String,
        homeserverUrl: String,
        userId: String,
        accessToken: String?,
        installId: String
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let store = KeychainNotificationCredentialStore.shared
        let record = NotificationAccountRecord.synced(
            homeserverUrl: homeserverUrl,
            userId: userId,
            accessToken: accessToken,
            installId: installId,
            continuing: store.load(accountTag: accountTag)
        )
        return store.save(accountTag: accountTag, record: record)
    }

    func scheduleSync(
        accountTag: String,
        entries: [AvatarSyncEntry]
    ) {
        lock.lock()
        // Every sync gets a number of its own: a download of an earlier sync that is still under
        // way then stores nothing, neither over this sync's avatars nor one this sync removed.
        accountGenerations[accountTag, default: 0] &+= 1
        let generation = currentGeneration(of: accountTag)
        let previous = syncTasks[accountTag]
        let task = Task<Void, Never>.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            await self.performAvatarSync(
                accountTag: accountTag,
                generation: generation,
                entries: entries
            )
        }
        syncTasks[accountTag] = task
        lock.unlock()
        previous?.cancel()
    }

    /// Removes what the account shares with the notification extension. False when the Keychain
    /// kept the account's record; everything else is removed either way.
    func clearAccount(accountTag: String) async -> Bool {
        let removed = removeAccount(accountTag)
        // What the notification extension donated for the account's messages.
        try? await INInteraction.delete(with: accountTag)
        return removed
    }

    /// Removes what every account shares with the notification extension, also the accounts
    /// that are not the active one. False when the Keychain kept a record.
    func clearAllAccounts() async -> Bool {
        let removed = removeAllAccounts()
        try? await INInteraction.deleteAll()
        return removed
    }

    private func removeAccount(_ accountTag: String) -> Bool {
        lock.lock()
        accountGenerations[accountTag, default: 0] &+= 1
        let active = syncTasks.removeValue(forKey: accountTag)
        let removed = KeychainNotificationCredentialStore.shared.remove(accountTag: accountTag)
        NotificationAvatarStore.shared.clearAccount(accountTag: accountTag)
        lock.unlock()
        active?.cancel()
        return removed
    }

    private func removeAllAccounts() -> Bool {
        lock.lock()
        clearAllGeneration &+= 1
        let active = Array(syncTasks.values)
        syncTasks.removeAll()
        let removed = KeychainNotificationCredentialStore.shared.removeAll()
        NotificationAvatarStore.shared.clearAll()
        lock.unlock()
        active.forEach { $0.cancel() }
        return removed
    }

    /// A number that changes when the account is synced or cleared, alone or with all the
    /// others; neither count ever goes down, so it never comes back to an earlier value. Call
    /// with the lock held.
    private func currentGeneration(of accountTag: String) -> UInt64 {
        clearAllGeneration &+ (accountGenerations[accountTag] ?? 0)
    }

    private func isCurrentGeneration(accountTag: String, generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return currentGeneration(of: accountTag) == generation
    }

    /// Removes from the cache what the sync's list no longer holds. False when the sync is no
    /// longer the account's latest, or the account is not shared.
    private func reconcileIfCurrent(
        accountTag: String,
        generation: UInt64,
        entries: [AvatarSyncEntry]
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard currentGeneration(of: accountTag) == generation,
              KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) != nil else {
            return false
        }
        NotificationAvatarStore.shared.reconcileAccount(
            accountTag: accountTag,
            desiredEntries: entries.map { entry -> (roomId: String?, sender: String, mxcUrl: String) in
                (roomId: entry.roomId, sender: entry.sender, mxcUrl: entry.mxcUrl)
            }
        )
        return true
    }

    private func storeAvatarIfCurrent(
        accountTag: String,
        generation: UInt64,
        entries: [AvatarSyncEntry],
        mxcUrl: String,
        data: Data
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard currentGeneration(of: accountTag) == generation,
              KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) != nil else {
            return
        }
        for entry in entries {
            NotificationAvatarStore.shared.storeAvatar(
                accountTag: accountTag,
                roomId: entry.roomId,
                sender: entry.sender,
                mxcUrl: mxcUrl,
                data: data
            )
        }
    }

    private func performAvatarSync(
        accountTag: String,
        generation: UInt64,
        entries: [AvatarSyncEntry]
    ) async {
        // The list is all the avatars the account has now. What the cache holds beyond it (a
        // member who left or removed the avatar, an avatar that changed) goes first, so that a
        // download that fails leaves no old avatar behind.
        guard !Task.isCancelled,
              reconcileIfCurrent(accountTag: accountTag, generation: generation, entries: entries) else {
            return
        }

        // A member is listed once for each room, mostly with the same avatar: each avatar is
        // downloaded once, for all the entries that show it.
        var toDownload: [(mxcUrl: String, entries: [AvatarSyncEntry])] = []
        var downloadIndex: [String: Int] = [:]

        for entry in entries {
            if Task.isCancelled || !isCurrentGeneration(accountTag: accountTag, generation: generation) {
                return
            }
            if NotificationAvatarStore.shared.cachedMxcUrl(
                accountTag: accountTag,
                roomId: entry.roomId,
                sender: entry.sender
            ) == entry.mxcUrl {
                continue
            }
            if let index = downloadIndex[entry.mxcUrl] {
                toDownload[index].entries.append(entry)
            } else {
                downloadIndex[entry.mxcUrl] = toDownload.count
                toDownload.append((mxcUrl: entry.mxcUrl, entries: [entry]))
            }
        }

        guard !toDownload.isEmpty,
              !Task.isCancelled,
              isCurrentGeneration(accountTag: accountTag, generation: generation),
              let credentials = KeychainNotificationCredentialStore.shared.load(accountTag: accountTag),
              let accessToken = credentials.accessToken,
              !accessToken.isEmpty else {
            return
        }

        let homeserverUrl = credentials.homeserverUrl
        let maxConcurrency = Self.maxConcurrentDownloads

        await withTaskGroup(of: Void.self) { group in
            var nextIndex = 0

            while nextIndex < min(maxConcurrency, toDownload.count) {
                let item = toDownload[nextIndex]
                nextIndex += 1
                group.addTask {
                    await self.downloadAndStoreAvatar(
                        accountTag: accountTag,
                        generation: generation,
                        homeserverUrl: homeserverUrl,
                        accessToken: accessToken,
                        entries: item.entries,
                        mxcUrl: item.mxcUrl
                    )
                }
            }

            while await group.next() != nil {
                if Task.isCancelled
                    || nextIndex >= toDownload.count
                    || !isCurrentGeneration(accountTag: accountTag, generation: generation)
                {
                    continue
                }
                let item = toDownload[nextIndex]
                nextIndex += 1
                group.addTask {
                    await self.downloadAndStoreAvatar(
                        accountTag: accountTag,
                        generation: generation,
                        homeserverUrl: homeserverUrl,
                        accessToken: accessToken,
                        entries: item.entries,
                        mxcUrl: item.mxcUrl
                    )
                }
            }
        }
    }

    private func downloadAndStoreAvatar(
        accountTag: String,
        generation: UInt64,
        homeserverUrl: String,
        accessToken: String,
        entries: [AvatarSyncEntry],
        mxcUrl: String
    ) async {
        guard !Task.isCancelled,
              isCurrentGeneration(accountTag: accountTag, generation: generation) else {
            return
        }
        guard let data = await NotificationAvatarFetcher.shared.downloadThumbnail(
            homeserverUrl: homeserverUrl,
            accessToken: accessToken,
            mxcUrl: mxcUrl
        ) else {
            return
        }
        guard !Task.isCancelled else { return }
        storeAvatarIfCurrent(
            accountTag: accountTag,
            generation: generation,
            entries: entries,
            mxcUrl: mxcUrl,
            data: data
        )
    }
}

/// Syncs Matrix account credentials and sender avatars to the shared Keychain and App Group cache
/// for the iOS Notification Service Extension (`src/app/native/nativeNotifications.ts`).
@objc(MindRoomNotificationsPlugin)
public class MindRoomNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomNotificationsPlugin"
    public let jsName = "MindRoomNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncAvatars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllAccounts", returnType: CAPPluginReturnPromise),
    ]

    private let coordinator = AvatarSyncCoordinator()

    @objc func syncAccount(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")),
              let homeserverUrl = Self.trimmedNonEmpty(call.getString("homeserverUrl")),
              let userId = Self.trimmedNonEmpty(call.getString("userId")) else {
            return call.reject("Invalid account payload", "INVALID")
        }
        // The record names this installation, so that one the Keychain keeps past the app's
        // removal is not taken for an account of the next installation.
        guard let installId = NotificationInstallMarker.shared.getOrCreateInstallId() else {
            return call.reject("Could not mark this installation", "INSTALL_MARKER_ERROR")
        }
        guard coordinator.saveAccount(
            accountTag: accountTag,
            homeserverUrl: homeserverUrl,
            userId: userId,
            accessToken: Self.trimmedNonEmpty(call.getString("accessToken")),
            installId: installId
        ) else {
            return call.reject("Could not store the account in the Keychain", "KEYCHAIN_ERROR")
        }
        call.resolve()
    }

    @objc func syncAvatars(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")) else {
            return call.reject("Invalid accountTag", "INVALID")
        }

        let rawAvatars = call.getArray("avatars") as? [[String: Any]] ?? []
        var entries: [AvatarSyncEntry] = []
        entries.reserveCapacity(rawAvatars.count)

        for item in rawAvatars {
            guard let roomId = Self.trimmedNonEmpty(item["roomId"] as? String),
                  let sender = Self.trimmedNonEmpty(item["sender"] as? String),
                  let mxcUrl = Self.trimmedNonEmpty(item["mxcUrl"] as? String) else { continue }
            entries.append(AvatarSyncEntry(roomId: roomId, sender: sender, mxcUrl: mxcUrl))
        }

        coordinator.scheduleSync(accountTag: accountTag, entries: entries)
        call.resolve()
    }

    // A clear answers once the donated interactions are deleted too, and fails when the Keychain
    // kept a record, so that the web side knows to try again.

    @objc func clearAccount(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")) else {
            return call.reject("Invalid accountTag", "INVALID")
        }

        let coordinator = self.coordinator
        Task<Void, Never> {
            if await coordinator.clearAccount(accountTag: accountTag) {
                call.resolve()
            } else {
                call.reject("Could not remove the account from the Keychain", "KEYCHAIN_ERROR")
            }
        }
    }

    @objc func clearAllAccounts(_ call: CAPPluginCall) {
        let coordinator = self.coordinator
        Task<Void, Never> {
            if await coordinator.clearAllAccounts() {
                call.resolve()
            } else {
                call.reject("Could not remove the accounts from the Keychain", "KEYCHAIN_ERROR")
            }
        }
    }

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
#endif
