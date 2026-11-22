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

        guard let sender = payload.sender, !sender.isEmpty else {
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
        sender: String,
        senderDisplayName: String
    ) async {
        let resolvedAccount = resolveAccount(accountTag: payload.accountTag)
        var avatarData: Data?

        if let accountTag = resolvedAccount.accountTag {
            avatarData = NotificationAvatarStore.shared.cachedAvatar(
                accountTag: accountTag,
                sender: sender
            )
        }

        // On cache miss, fetch for this notification in memory only so the main app remains the sole
        // disk cache writer (prevents cross-process cache resurrection after account sign-out).
        if avatarData == nil,
           let credentials = resolvedAccount.credentials,
           let accessToken = credentials.accessToken,
           !accessToken.isEmpty
        {
            if let fetched = await NotificationAvatarFetcher.shared.fetchSenderAvatar(
                homeserverUrl: credentials.homeserverUrl,
                accessToken: accessToken,
                sender: sender
            ) {
                avatarData = fetched.data
            }
        }

        guard !Task.isCancelled else { return }

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

        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: mutableContent.body,
            speakableGroupName: nil,
            conversationIdentifier: payload.roomId,
            serviceName: nil,
            sender: senderPerson,
            attachments: nil
        )

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
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

    private func resolveAccount(
        accountTag: String?
    ) -> (accountTag: String?, credentials: NotificationAccountRecord?) {
        if let accountTag, !accountTag.isEmpty {
            let credentials = KeychainNotificationCredentialStore.shared.load(accountTag: accountTag)
            return (accountTag: accountTag, credentials: credentials)
        }
        if let single = KeychainNotificationCredentialStore.shared.loadSingleAccount() {
            return (accountTag: single.accountTag, credentials: single.record)
        }
        return (accountTag: nil, credentials: nil)
    }
}
