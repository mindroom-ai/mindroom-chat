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
    private var fetchTask: Task<Void, Never>?

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
            fetchTask = task
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
        fetchTask = nil
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
        task = fetchTask
        contentHandler = nil
        bestAttemptContent = nil
        fetchTask = nil
        lock.unlock()

        task?.cancel()
        if let handler, let fallback {
            handler(fallback)
        }
    }
}

class NotificationService: UNNotificationServiceExtension {
    /// How long an avatar that is not cached may hold a notification back: 3 seconds for both of
    /// its requests together, since the notification may be a tool approval that waits for an answer.
    private static let avatarFetchDeadlineNanoseconds: UInt64 = 3_000_000_000

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
        // avatars and homeserver it would be shown with.
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
        // Only the account the push names, while the app shares it, lends its avatars and its
        // homeserver: never another account that happens to be the only one on the device.
        guard let account = KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) else {
            slot.deliver(mutableContent)
            return
        }

        // The sender's avatar in this room, which can differ from the one in another room.
        var avatarData = NotificationAvatarStore.shared.cachedAvatar(
            accountTag: accountTag,
            roomId: payload.roomId,
            sender: sender
        )

        // On cache miss, fetch for this notification in memory only so the main app remains the sole
        // disk cache writer (prevents cross-process cache resurrection after account sign-out).
        // Past the deadline the notification goes out without an avatar.
        if avatarData == nil,
           let accessToken = account.accessToken,
           !accessToken.isEmpty
        {
            if let fetched = await NotificationAvatarFetcher.shared.fetchSenderAvatar(
                homeserverUrl: account.homeserverUrl,
                accessToken: accessToken,
                roomId: payload.roomId,
                sender: sender,
                deadlineNanoseconds: Self.avatarFetchDeadlineNanoseconds
            ) {
                avatarData = fetched.data
            }
        }

        guard !Task.isCancelled else { return }

        // The app may have removed the account while the avatar was fetched (a sign-out, or
        // notifications turned off): nothing of it is donated after that.
        guard KeychainNotificationCredentialStore.shared.load(accountTag: accountTag) != nil else {
            slot.deliver(mutableContent)
            return
        }

        let senderHandle = INPersonHandle(value: sender, type: .unknown)
        let avatarImage = avatarData.map { INImage(imageData: $0) }
        let senderPerson = INPerson(
            personHandle: senderHandle,
            nameComponents: nil,
            displayName: senderDisplayName,
            image: avatarImage,
            contactIdentifier: nil,
            customIdentifier: sender,
            isMe: false,
            suggestionType: .instantMessageAddress
        )

        // The alert shows the body of the notification itself, so the message text stays out of
        // the interactions the system keeps.
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: nil,
            speakableGroupName: nil,
            conversationIdentifier: payload.roomId,
            serviceName: nil,
            sender: senderPerson,
            attachments: nil
        )

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        // The app deletes an account's interactions by this group when the account goes.
        interaction.groupIdentifier = accountTag
        try? await interaction.donate()

        guard !Task.isCancelled else { return }

        let finalContent: UNNotificationContent
        if let updated = try? mutableContent.updating(from: intent) {
            finalContent = updated
        } else {
            finalContent = mutableContent
        }
        slot.deliver(finalContent)
    }
}
