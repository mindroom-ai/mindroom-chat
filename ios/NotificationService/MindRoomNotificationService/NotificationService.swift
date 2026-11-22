import Foundation
import Intents
import MindRoomNotificationKit
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var activeTask: Task<Void, Never>?

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

        let strippedBody = NotificationMarkdown.strip(mutableContent.body)
        if !strippedBody.isEmpty {
            mutableContent.body = strippedBody
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

        lock.lock()
        let previousTask = activeTask
        self.contentHandler = contentHandler
        self.bestAttemptContent = mutableContent
        self.activeTask = Task { [weak self] in
            await self?.enrichWithCommunicationNotification(
                mutableContent: mutableContent,
                payload: payload,
                sender: sender,
                senderDisplayName: senderDisplayName
            )
        }
        lock.unlock()
        previousTask?.cancel()
    }

    override func serviceExtensionTimeWillExpire() {
        let handler: ((UNNotificationContent) -> Void)?
        let fallback: UNMutableNotificationContent?
        let task: Task<Void, Never>?

        lock.lock()
        handler = contentHandler
        fallback = bestAttemptContent
        task = activeTask
        contentHandler = nil
        bestAttemptContent = nil
        activeTask = nil
        lock.unlock()

        task?.cancel()
        if let handler, let fallback {
            handler(fallback)
        }
    }

    private func enrichWithCommunicationNotification(
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

        if avatarData == nil,
           let accountTag = resolvedAccount.accountTag,
           let credentials = resolvedAccount.credentials,
           let accessToken = credentials.accessToken,
           !accessToken.isEmpty
        {
            if let fetched = await NotificationAvatarFetcher.shared.fetchSenderAvatar(
                homeserverUrl: credentials.homeserverUrl,
                accessToken: accessToken,
                sender: sender
            ) {
                NotificationAvatarStore.shared.storeAvatar(
                    accountTag: accountTag,
                    sender: sender,
                    mxcUrl: fetched.mxcUrl,
                    data: fetched.data
                )
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

        let mePerson: INPerson? = resolvedAccount.credentials.map { record in
            INPerson(
                personHandle: INPersonHandle(value: record.userId, type: .unknown),
                nameComponents: nil,
                displayName: "",
                image: nil,
                contactIdentifier: nil,
                customIdentifier: record.userId,
                isMe: true,
                suggestionType: .none
            )
        }

        let intent = INSendMessageIntent(
            recipients: mePerson.map { [$0] },
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
        deliverOnce(finalContent)
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

    private func deliverOnce(_ content: UNNotificationContent) {
        let handler: ((UNNotificationContent) -> Void)?
        lock.lock()
        handler = contentHandler
        contentHandler = nil
        bestAttemptContent = nil
        activeTask = nil
        lock.unlock()
        handler?(content)
    }
}
