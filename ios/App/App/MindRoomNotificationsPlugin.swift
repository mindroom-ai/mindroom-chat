#if !targetEnvironment(macCatalyst)
import Capacitor
import Foundation
import MindRoomNotificationKit

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

    private static let maxConcurrentDownloads = 4

    private let taskLock = NSLock()
    private var syncTasks: [String: Task<Void, Never>] = [:]

    deinit {
        taskLock.lock()
        let tasks = Array(syncTasks.values)
        syncTasks.removeAll()
        taskLock.unlock()
        tasks.forEach { $0.cancel() }
    }

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

        let task = Task.detached(priority: .utility) {
            await Self.performAvatarSync(accountTag: accountTag, entries: entries)
        }

        taskLock.lock()
        let previous = syncTasks[accountTag]
        syncTasks[accountTag] = task
        taskLock.unlock()
        previous?.cancel()

        call.resolve()
    }

    @objc func clearAccount(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")) else {
            return call.reject("Invalid accountTag", "INVALID")
        }

        taskLock.lock()
        let active = syncTasks.removeValue(forKey: accountTag)
        taskLock.unlock()
        active?.cancel()

        KeychainNotificationCredentialStore.shared.remove(accountTag: accountTag)
        NotificationAvatarStore.shared.clearAccount(accountTag: accountTag)
        call.resolve()
    }

    private static func performAvatarSync(
        accountTag: String,
        entries: [(sender: String, mxcUrl: String?)]
    ) async {
        var toDownload: [(sender: String, mxcUrl: String)] = []

        for entry in entries {
            if Task.isCancelled { return }
            guard let mxcUrl = entry.mxcUrl else {
                NotificationAvatarStore.shared.removeAvatar(
                    accountTag: accountTag,
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
                    await Self.downloadAndStoreAvatar(
                        accountTag: accountTag,
                        homeserverUrl: homeserverUrl,
                        accessToken: accessToken,
                        sender: item.sender,
                        mxcUrl: item.mxcUrl
                    )
                }
            }

            while await group.next() != nil {
                if Task.isCancelled || nextIndex >= toDownload.count {
                    continue
                }
                let item = toDownload[nextIndex]
                nextIndex += 1
                group.addTask {
                    await Self.downloadAndStoreAvatar(
                        accountTag: accountTag,
                        homeserverUrl: homeserverUrl,
                        accessToken: accessToken,
                        sender: item.sender,
                        mxcUrl: item.mxcUrl
                    )
                }
            }
        }
    }

    private static func downloadAndStoreAvatar(
        accountTag: String,
        homeserverUrl: String,
        accessToken: String,
        sender: String,
        mxcUrl: String
    ) async {
        guard !Task.isCancelled else { return }
        guard let data = await NotificationAvatarFetcher.shared.downloadThumbnail(
            homeserverUrl: homeserverUrl,
            accessToken: accessToken,
            mxcUrl: mxcUrl
        ) else {
            return
        }
        guard !Task.isCancelled else { return }
        NotificationAvatarStore.shared.storeAvatar(
            accountTag: accountTag,
            sender: sender,
            mxcUrl: mxcUrl,
            data: data
        )
    }

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
#endif
