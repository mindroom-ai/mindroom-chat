import Foundation
import Intents
import MindRoomNotificationKit
import UserNotifications

/// Per-request delivery coordination so overlapping notifications on a reused extension instance
/// can never cross-deliver or double-invoke `contentHandler`.
private final class DeliverySlot: @unchecked Sendable {
    private let lock = NSLock()
    private var delivered = false
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var enrichTask: Task<Void, Never>?

    init(
        contentHandler: @escaping (UNNotificationContent) -> Void,
        bestAttemptContent: UNMutableNotificationContent
    ) {
        self.contentHandler = contentHandler
        self.bestAttemptContent = bestAttemptContent
    }

    func setTask(_ task: Task<Void, Never>) {
        let shouldCancel: Bool
        lock.lock()
        if delivered {
            shouldCancel = true
        } else {
            enrichTask = task
            shouldCancel = false
        }
        lock.unlock()
        if shouldCancel {
            task.cancel()
        }
    }

    func deliver(_ content: UNNotificationContent) {
        let handler: ((UNNotificationContent) -> Void)?
        lock.lock()
        guard !delivered else {
            lock.unlock()
            return
        }
        delivered = true
        handler = contentHandler
        contentHandler = nil
        bestAttemptContent = nil
        enrichTask = nil
        lock.unlock()
        handler?(content)
    }

    func expire() {
        let handler: ((UNNotificationContent) -> Void)?
        let fallback: UNMutableNotificationContent?
        let task: Task<Void, Never>?

        lock.lock()
        guard !delivered else {
            lock.unlock()
            return
        }
        delivered = true
        handler = contentHandler
        fallback = bestAttemptContent
        task = enrichTask
        contentHandler = nil
        bestAttemptContent = nil
        enrichTask = nil
        lock.unlock()

        task?.cancel()
        if let handler, let fallback {
            handler(fallback)
        }
    }
}

/// Turns a push into a Communication Notification with what the app left in the App Group: the
/// account and the sender's avatar. It makes no request and holds no token, so a notification is
/// never held back by the network.
class NotificationService: UNNotificationServiceExtension {
    private let slotLock = NSLock()
    private var activeSlot: DeliverySlot?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let mutableContent = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }

        let payload = NotificationPayload(userInfo: mutableContent.userInfo)
        if payload.isRing {
            contentHandler(mutableContent)
            return
        }

        if !payload.isGatewayFormatted {
            let strippedBody = NotificationMarkdown.strip(mutableContent.body)
            if !strippedBody.isEmpty {
                mutableContent.body = strippedBody
            }
        }

        if mutableContent.threadIdentifier.isEmpty, let roomId = payload.roomId, !roomId.isEmpty {
            mutableContent.threadIdentifier = roomId
        }

        let senderDisplayName = payload.effectiveSenderDisplayName(fallbackTitle: mutableContent.title)
        if mutableContent.subtitle.isEmpty,
           let roomName = payload.effectiveRoomName(fallbackSubtitle: mutableContent.subtitle),
           roomName != senderDisplayName
        {
            mutableContent.subtitle = roomName
        }

        // A push that names no account keeps what the gateway sent: there is no telling whose
        // avatars it would be shown with.
        guard let sender = payload.sender, !sender.isEmpty,
              let accountTag = payload.accountTag, !accountTag.isEmpty else {
            contentHandler(mutableContent)
            return
        }

        let slot = DeliverySlot(
            contentHandler: contentHandler,
            bestAttemptContent: mutableContent
        )
        slotLock.lock()
        activeSlot = slot
        slotLock.unlock()

        let task = Task<Void, Never> { [weak self] in
            guard let self else {
                slot.deliver(mutableContent)
                return
            }
            await self.enrichWithCommunicationNotification(
                slot: slot,
                mutableContent: mutableContent,
                payload: payload,
                accountTag: accountTag,
                sender: sender,
                senderDisplayName: senderDisplayName
            )
        }
        slot.setTask(task)
    }

    override func serviceExtensionTimeWillExpire() {
        slotLock.lock()
        let slot = activeSlot
        activeSlot = nil
        slotLock.unlock()
        slot?.expire()
    }

    private func enrichWithCommunicationNotification(
        slot: DeliverySlot,
        mutableContent: UNMutableNotificationContent,
        payload: NotificationPayload,
        accountTag: String,
        sender: String,
        senderDisplayName: String
    ) async {
        // Only the account the push names, while the app shares it, lends its avatars: never
        // another account that happens to be the only one on the device.
        guard let account = NotificationAccountStore.shared.loadAccount(accountTag: accountTag) else {
            slot.deliver(mutableContent)
            return
        }

        // The sender's avatar in this room, which can differ from the one in another room. Only
        // what the app cached: a sender whose avatar it has not is shown without one.
        let avatarData = NotificationAvatarStore.shared.cachedAvatar(
            accountTag: accountTag,
            roomId: payload.roomId,
            sender: sender
        )

        let intent = NotificationCommunicationIntent.makeSendMessageIntent(
            sender: sender,
            senderDisplayName: senderDisplayName,
            roomId: payload.roomId,
            roomName: payload.effectiveRoomName(fallbackSubtitle: mutableContent.subtitle),
            accountUserId: account.userId,
            avatarData: avatarData
        )

        // The app may remove the account at any moment (a sign-out, or notifications turned
        // off), also while the interaction is donated. Only a donation whose account is still
        // the one this notification started with is kept and shown.
        let donated = await NotificationInteractionCoordinator.donateIfValid(
            isAccountStillValid: {
                NotificationAccountStore.shared.loadAccount(accountTag: accountTag)?.syncId == account.syncId
            },
            donate: { interactionId in
                let interaction = INInteraction(intent: intent, response: nil)
                interaction.identifier = interactionId
                interaction.direction = .incoming
                // The app deletes an account's interactions by this group when the account goes.
                interaction.groupIdentifier = accountTag
                try await interaction.donate()
            },
            deleteInteraction: { interactionId in
                try await INInteraction.delete(with: [interactionId])
            },
            // The app deletes it the next time it reconciles its accounts.
            recordPendingDelete: { interactionId in
                NotificationAccountStore.shared.recordPendingInteractionDelete(interactionId)
            }
        )

        // Only now, so that a donation to take back is taken back when the time ran out too.
        guard !Task.isCancelled else { return }

        guard donated, let updated = try? mutableContent.updating(from: intent) else {
            slot.deliver(mutableContent)
            return
        }
        slot.deliver(updated)
    }
}
