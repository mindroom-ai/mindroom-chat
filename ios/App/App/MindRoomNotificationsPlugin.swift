#if !targetEnvironment(macCatalyst)
import Capacitor
import Foundation
import MindRoomNotificationKit

/// Serializes per-account avatar sync tasks and generation counters so an in-flight download can
/// never resurrect an account's cache directory after `clearAccount`.
private final class AvatarSyncCoordinator: @unchecked Sendable {
    private static let maxConcurrentDownloads = 4

    private let lock = NSLock()
    private var syncTasks: [String: Task<Void, Never>] = [:]
    private var accountGenerations: [String: UInt64] = [:]

    deinit {
        lock.lock()
        let tasks = Array(syncTasks.values)
        syncTasks.removeAll()
        lock.unlock()
        tasks.forEach { $0.cancel() }
    }

    func scheduleSync(
        accountTag: String,
        entries: [(sender: String, mxcUrl: String?)]
    ) {
        lock.lock()
        let generation = accountGenerations[accountTag] ?? 0
        let previous = syncTasks[accountTag]
        let task = Task.detached(priority: .utility) { [weak self] in
            await self?.performAvatarSync(
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
    }

    private func isCurrentGeneration(accountTag: String, generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return (accountGenerations[accountTag] ?? 0) == generation
    }

    private func removeAvatarIfCurrent(
        accountTag: String,
        generation: UInt64,
        sender: String
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard (accountGenerations[accountTag] ?? 0) == generation,
              KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) != nil else {
            return
        }
        NotificationAvatarStore.shared.removeAvatar(accountTag: accountTag, sender: sender)
    }

    private func storeAvatarIfCurrent(
        accountTag: String,
        generation: UInt64,
        sender: String,
        mxcUrl: String,
        data: Data
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard (accountGenerations[accountTag] ?? 0) == generation,
              KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) != nil else {
            return
        }
        NotificationAvatarStore.shared.storeAvatar(
            accountTag: accountTag,
            sender: sender,
            mxcUrl: mxcUrl,
            data: data
        )
    }

    private func performAvatarSync(
        accountTag: String,
        generation: UInt64,
        entries: [(sender: String, mxcUrl: String?)]
    ) async {
        var toDownload: [(sender: String, mxcUrl: String)] = []

        for entry in entries {
            if Task.isCancelled || !isCurrentGeneration(accountTag: accountTag, generation: generation) {
                return
            }
            guard let mxcUrl = entry.mxcUrl else {
                removeAvatarIfCurrent(
                    accountTag: accountTag,
                    generation: generation,
                    sender: entry.sender
                )
                continue
            }
            if NotificationAvatarStore.shared.cachedMxcUrl(
                accountTag: accountTag,
                sender: entry.sender
            ) != mxcUrl {
                toDownload.append((sender: entry.sender, mxcUrl: mxcUrl))
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
                        sender: item.sender,
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
                        sender: item.sender,
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
        sender: String,
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
            sender: sender,
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
        var entries: [(sender: String, mxcUrl: String?)] = []
        entries.reserveCapacity(rawAvatars.count)

        for item in rawAvatars {
            guard let sender = Self.trimmedNonEmpty(item["sender"] as? String) else { continue }
            let mxcUrl = Self.trimmedNonEmpty(item["mxcUrl"] as? String)
            entries.append((sender: sender, mxcUrl: mxcUrl))
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

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
#endif
