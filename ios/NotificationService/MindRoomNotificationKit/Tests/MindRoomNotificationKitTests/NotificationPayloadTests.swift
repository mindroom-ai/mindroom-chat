import MindRoomNotificationKit
import XCTest

final class NotificationPayloadTests: XCTestCase {
    func testParsesFullPayload() {
        let userInfo: [AnyHashable: Any] = [
            "room_id": "!room:mindroom.chat",
            "event_id": "$event123",
            "mindroom_account": "tag-abc",
            "sender": "@mindroom_dev:mindroom.chat",
            "sender_display_name": "DevAgent",
            "room_name": "Engineering",
        ]
        let payload = NotificationPayload(userInfo: userInfo)
        XCTAssertEqual(payload.roomId, "!room:mindroom.chat")
        XCTAssertEqual(payload.eventId, "$event123")
        XCTAssertEqual(payload.accountTag, "tag-abc")
        XCTAssertEqual(payload.sender, "@mindroom_dev:mindroom.chat")
        XCTAssertEqual(payload.senderDisplayName, "DevAgent")
        XCTAssertEqual(payload.roomName, "Engineering")
        XCTAssertFalse(payload.isRing)
    }

    func testDetectsRingPayload() {
        let ringPayload = NotificationPayload(userInfo: ["mindroom_ring": ["call_id": "c1"]])
        XCTAssertTrue(ringPayload.isRing)

        let nullRingPayload = NotificationPayload(userInfo: ["mindroom_ring": NSNull()])
        XCTAssertFalse(nullRingPayload.isRing)
    }

    func testEffectiveDisplayNameAndRoomNameFallbacks() {
        let withNames = NotificationPayload(
            sender: "@alice:mindroom.chat",
            senderDisplayName: "Alice",
            roomName: "General"
        )
        XCTAssertEqual(withNames.effectiveSenderDisplayName(fallbackTitle: "Fallback"), "Alice")
        XCTAssertEqual(withNames.effectiveRoomName(fallbackSubtitle: "Sub"), "General")

        let missingNames = NotificationPayload(sender: "@alice:mindroom.chat")
        XCTAssertEqual(missingNames.effectiveSenderDisplayName(fallbackTitle: "Fallback Title"), "Fallback Title")
        XCTAssertEqual(missingNames.effectiveSenderDisplayName(fallbackTitle: "   "), "@alice:mindroom.chat")
        XCTAssertEqual(missingNames.effectiveRoomName(fallbackSubtitle: "Room Subtitle"), "Room Subtitle")
        XCTAssertNil(missingNames.effectiveRoomName(fallbackSubtitle: "  "))
    }
}
