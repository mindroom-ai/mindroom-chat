#if canImport(Intents)
import Foundation
import Intents

/// Builds the `INSendMessageIntent` that turns a notification into a Communication Notification.
public enum NotificationCommunicationIntent {
    /// The intent of a message from `sender` in the room. It never carries the message text: the
    /// alert shows the body of the notification itself, and the text stays out of the
    /// interactions the system keeps.
    ///
    /// A room whose name is not the sender's is a group: the notification shows the room's name
    /// under the sender's, and the avatar stands for the conversation. Any other room is a direct
    /// chat, where the avatar is the sender's.
    public static func makeSendMessageIntent(
        sender: String,
        senderDisplayName: String,
        roomId: String?,
        roomName: String?,
        accountUserId: String,
        avatarData: Data?
    ) -> INSendMessageIntent {
        let avatarImage = avatarData.map { INImage(imageData: $0) }
        let trimmedRoomName = roomName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard !trimmedRoomName.isEmpty, trimmedRoomName != senderDisplayName else {
            let senderPerson = person(userId: sender, displayName: senderDisplayName, image: avatarImage, isMe: false)
            return INSendMessageIntent(
                recipients: nil,
                outgoingMessageType: .outgoingMessageText,
                content: nil,
                speakableGroupName: nil,
                conversationIdentifier: roomId,
                serviceName: nil,
                sender: senderPerson,
                attachments: nil
            )
        }

        // iOS shows the group's name and picture only for an intent that also lists recipients,
        // the user among them (as Element X iOS does); with `recipients: nil` it shows neither.
        let senderPerson = person(userId: sender, displayName: senderDisplayName, image: nil, isMe: false)
        let mePerson = person(userId: accountUserId, displayName: nil, image: nil, isMe: true)
        let intent = INSendMessageIntent(
            recipients: [senderPerson, mePerson],
            outgoingMessageType: .outgoingMessageText,
            content: nil,
            speakableGroupName: INSpeakableString(spokenPhrase: trimmedRoomName),
            conversationIdentifier: roomId,
            serviceName: nil,
            sender: senderPerson,
            attachments: nil
        )
        // The package is built for macOS only to run its tests; the picture is set where the
        // notification extension runs.
        #if !os(macOS)
        if let avatarImage {
            intent.setImage(avatarImage, forParameterNamed: \.speakableGroupName)
        }
        #endif
        return intent
    }

    private static func person(userId: String, displayName: String?, image: INImage?, isMe: Bool) -> INPerson {
        INPerson(
            personHandle: INPersonHandle(value: userId, type: .unknown),
            nameComponents: nil,
            displayName: displayName,
            image: image,
            contactIdentifier: nil,
            customIdentifier: userId,
            isMe: isMe,
            suggestionType: .instantMessageAddress
        )
    }
}
#endif
