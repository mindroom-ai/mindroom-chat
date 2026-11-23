#if !targetEnvironment(macCatalyst)
import Capacitor
import Foundation
import Intents
import MindRoomNotificationKit

/// One joined member's avatar in one room; `mxcUrl` is nil for a member without one.
private struct AvatarSyncEntry: Sendable {
    let roomId: String
    let sender: String
    let mxcUrl: String?
}

/// Serializes per-account avatar sync tasks and generation counters so an in-flight download can
/// never resurrect an account's cache directory after `clearAccount` or `clearAllAccounts`.
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

    func scheduleSync(
        accountTag: String,
        entries: [AvatarSyncEntry]
    ) {
        lock.lock()
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

    func clearAccount(accountTag: String) {
        lock.lock()
        accountGenerations[accountTag, default: 0] &+= 1
        let active = syncTasks.removeValue(forKey: accountTag)
        KeychainNotificationCredentialStore.shared.remove(accountTag: accountTag)
        NotificationAvatarStore.shared.clearAccount(accountTag: accountTag)
        lock.unlock()
        active?.cancel()
        // What the notification extension donated for the account's messages.
        INInteraction.delete(with: accountTag, completion: nil)
    }

    /// Removes what every account shares with the notification extension, also the accounts
    /// that are not the active one.
    func clearAllAccounts() {
        lock.lock()
        clearAllGeneration &+= 1
        let active = Array(syncTasks.values)
        syncTasks.removeAll()
        KeychainNotificationCredentialStore.shared.removeAll()
        NotificationAvatarStore.shared.clearAll()
        lock.unlock()
        active.forEach { $0.cancel() }
        INInteraction.deleteAll(completion: nil)
    }

    /// A number that changes when the account is cleared, alone or with all the others; neither
    /// count ever goes down, so it never comes back to an earlier value. Call with the lock held.
    private func currentGeneration(of accountTag: String) -> UInt64 {
        clearAllGeneration &+ (accountGenerations[accountTag] ?? 0)
    }

    private func isCurrentGeneration(accountTag: String, generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return currentGeneration(of: accountTag) == generation
    }

    private func removeAvatarIfCurrent(
        accountTag: String,
        generation: UInt64,
        entry: AvatarSyncEntry
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard currentGeneration(of: accountTag) == generation,
              KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) != nil else {
            return
        }
        NotificationAvatarStore.shared.removeAvatar(
            accountTag: accountTag,
            roomId: entry.roomId,
            sender: entry.sender
        )
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
        // A member is listed once for each room, mostly with the same avatar: each avatar is
        // downloaded once, for all the entries that show it.
        var toDownload: [(mxcUrl: String, entries: [AvatarSyncEntry])] = []
        var downloadIndex: [String: Int] = [:]

        for entry in entries {
            if Task.isCancelled || !isCurrentGeneration(accountTag: accountTag, generation: generation) {
                return
            }
            guard let mxcUrl = entry.mxcUrl else {
                removeAvatarIfCurrent(
                    accountTag: accountTag,
                    generation: generation,
                    entry: entry
                )
                continue
            }
            if NotificationAvatarStore.shared.cachedMxcUrl(
                accountTag: accountTag,
                roomId: entry.roomId,
                sender: entry.sender
            ) == mxcUrl {
                continue
            }
            if let index = downloadIndex[mxcUrl] {
                toDownload[index].entries.append(entry)
            } else {
                downloadIndex[mxcUrl] = toDownload.count
                toDownload.append((mxcUrl: mxcUrl, entries: [entry]))
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

        let accessToken = Self.trimmedNonEmpty(call.getString("accessToken"))
        let record = NotificationAccountRecord(
            homeserverUrl: homeserverUrl,
            userId: userId,
            accessToken: accessToken
        )
        KeychainNotificationCredentialStore.shared.save(accountTag: accountTag, record: record)
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
                  let sender = Self.trimmedNonEmpty(item["sender"] as? String) else { continue }
            let mxcUrl = Self.trimmedNonEmpty(item["mxcUrl"] as? String)
            entries.append(AvatarSyncEntry(roomId: roomId, sender: sender, mxcUrl: mxcUrl))
        }

        coordinator.scheduleSync(accountTag: accountTag, entries: entries)
        call.resolve()
    }

    @objc func clearAccount(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")) else {
            return call.reject("Invalid accountTag", "INVALID")
        }

        coordinator.clearAccount(accountTag: accountTag)
        call.resolve()
    }

    @objc func clearAllAccounts(_ call: CAPPluginCall) {
        coordinator.clearAllAccounts()
        call.resolve()
    }

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
#endif
