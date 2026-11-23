#if canImport(Intents)
import Intents
import MindRoomNotificationKit
import XCTest

final class NotificationCommunicationIntentTests: XCTestCase {
    private let sender = "@mindroom_dev:mindroom.chat"
    private let me = "@bas:mindroom.chat"
    private let roomId = "!room:mindroom.chat"

    private func makeIntent(roomName: String?, avatarData: Data? = TestImageFixtures.samplePNG) -> INSendMessageIntent {
        NotificationCommunicationIntent.makeSendMessageIntent(
            sender: sender,
            senderDisplayName: "DevAgent",
            roomId: roomId,
            roomName: roomName,
            accountUserId: me,
            avatarData: avatarData
        )
    }

    func testADirectChatShowsTheSenderWithItsAvatarAndNoGroup() {
        // A direct chat carries no room name, or the sender's own.
        for roomName in [nil, "", "   ", "DevAgent"] {
            let intent = makeIntent(roomName: roomName)

            XCTAssertNil(intent.speakableGroupName)
            XCTAssertNil(intent.recipients)
            XCTAssertEqual(intent.sender?.personHandle?.value, sender)
            XCTAssertEqual(intent.sender?.displayName, "DevAgent")
            XCTAssertNotNil(intent.sender?.image)
            XCTAssertEqual(intent.conversationIdentifier, roomId)
            XCTAssertNil(intent.content)
        }

        XCTAssertNil(makeIntent(roomName: nil, avatarData: nil).sender?.image)
    }

    func testANamedRoomIsAGroupOfTheSenderAndTheUser() {
        let intent = makeIntent(roomName: "  Lobby ")

        XCTAssertEqual(intent.speakableGroupName?.spokenPhrase, "Lobby")
        XCTAssertEqual(intent.recipients?.map { $0.personHandle?.value }, [sender, me])
        XCTAssertEqual(intent.sender?.personHandle?.value, sender)
        XCTAssertEqual(intent.sender?.displayName, "DevAgent")
        // The avatar stands for the conversation, not for the sender.
        XCTAssertNil(intent.sender?.image)
        XCTAssertEqual(intent.conversationIdentifier, roomId)
        XCTAssertNil(intent.content)
    }
}
#endif
