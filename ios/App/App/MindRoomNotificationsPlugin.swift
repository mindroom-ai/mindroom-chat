#if !targetEnvironment(macCatalyst)
import Capacitor
import Foundation
import Intents
import MindRoomNotificationKit

/// Shares with the iOS Notification Service Extension, through the App Group, what a rich
/// notification shows: the accounts whose pushes name their sender and the avatars of their room
/// members (`src/app/native/nativeNotifications.ts`). Nothing of it is secret. The web side
/// downloads the avatars, so no token crosses the bridge and nothing here makes a request.
@objc(MindRoomNotificationsPlugin)
public class MindRoomNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomNotificationsPlugin"
    public let jsName = "MindRoomNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcileAccounts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncAvatars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storeAvatar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAvatarCache", returnType: CAPPluginReturnPromise),
    ]

    private let mutations = NotificationAccountMutations(
        accounts: .shared,
        avatars: .shared,
        interactions: NotificationInteractionDeleter(
            deleteAll: { try await INInteraction.deleteAll() },
            deleteGroup: { groupIdentifier in try await INInteraction.delete(with: groupIdentifier) },
            deleteInteraction: { interactionIdentifier in
                try await INInteraction.delete(with: [interactionIdentifier])
            }
        )
    )
    /// Every call goes through it, in the order the calls come in: a reconcile that is still
    /// deleting interactions is over before a later sync stores its account.
    private let queue = NotificationAccountMutationQueue()

    @objc func syncAccount(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")),
              let userId = Self.trimmedNonEmpty(call.getString("userId")) else {
            return call.reject("Invalid account payload", "INVALID")
        }
        let mutations = self.mutations
        queue.enqueue {
            guard mutations.syncAccount(accountTag: accountTag, userId: userId) else {
                return call.reject("Could not store the account", "STORE_ERROR")
            }
            call.resolve()
        }
    }

    @objc func reconcileAccounts(_ call: CAPPluginCall) {
        // A call without the list is refused: taken for an empty one, it would remove every account.
        guard let rawAccountTags = call.getArray("allowedAccountTags") as? [String] else {
            return call.reject("Invalid allowedAccountTags", "INVALID")
        }
        let allowedAccountTags = Set(rawAccountTags.compactMap { Self.trimmedNonEmpty($0) })
        let mutations = self.mutations
        queue.enqueue {
            guard await mutations.reconcileAccounts(allowedAccountTags: allowedAccountTags) else {
                return call.reject("Could not delete the donated interactions", "INTENTS_ERROR")
            }
            call.resolve()
        }
    }

    @objc func syncAvatars(_ call: CAPPluginCall) {
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")) else {
            return call.reject("Invalid accountTag", "INVALID")
        }
        let rawAvatars = call.getArray("avatars") as? [[String: Any]] ?? []
        let entries = rawAvatars.compactMap { item -> NotificationAccountMutations.AvatarEntry? in
            guard let roomId = Self.trimmedNonEmpty(item["roomId"] as? String),
                  let sender = Self.trimmedNonEmpty(item["sender"] as? String),
                  let mxcUrl = Self.trimmedNonEmpty(item["mxcUrl"] as? String) else { return nil }
            return NotificationAccountMutations.AvatarEntry(roomId: roomId, sender: sender, mxcUrl: mxcUrl)
        }
        let mutations = self.mutations
        queue.enqueue {
            let sync = mutations.syncAvatars(accountTag: accountTag, entries: entries)
            call.resolve([
                "missingMxcUrls": sync.missingMxcUrls,
                "syncGeneration": sync.syncGeneration,
            ])
        }
    }

    @objc func storeAvatar(_ call: CAPPluginCall) {
        let rawEntries = call.getArray("entries") as? [[String: Any]] ?? []
        let entries = rawEntries.compactMap { item -> (roomId: String, sender: String)? in
            guard let roomId = Self.trimmedNonEmpty(item["roomId"] as? String),
                  let sender = Self.trimmedNonEmpty(item["sender"] as? String) else { return nil }
            return (roomId: roomId, sender: sender)
        }
        guard let accountTag = Self.trimmedNonEmpty(call.getString("accountTag")),
              let syncGeneration = call.getInt("syncGeneration"),
              let mxcUrl = Self.trimmedNonEmpty(call.getString("mxcUrl")),
              !entries.isEmpty,
              let data = call.getString("base64Data").flatMap({ Data(base64Encoded: $0) }),
              data.count <= NotificationAvatarStore.maxAvatarBytes else {
            return call.reject("Invalid avatar payload", "INVALID")
        }
        let mutations = self.mutations
        queue.enqueue {
            mutations.storeAvatar(
                accountTag: accountTag,
                syncGeneration: syncGeneration,
                mxcUrl: mxcUrl,
                entries: entries,
                data: data
            )
            call.resolve()
        }
    }

    @objc func clearAvatarCache(_ call: CAPPluginCall) {
        let mutations = self.mutations
        queue.enqueue {
            mutations.clearAvatarCache()
            call.resolve()
        }
    }

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
#endif
