import XCTest
@testable import MindRoomWatchKit

final class WatchLinkMessageTests: XCTestCase {
    private let credentials: [String: Any] = [
        "v": 1, "kind": "credentials", "homeserverUrl": "https://mindroom.chat", "userId": "@bas:mindroom.chat",
        "loginToken": "tok", "expiresAt": 1_794_675_935_927.0,
    ]

    func testCredentialsRoundTrip() throws {
        let message = try XCTUnwrap(WatchLinkMessage(dictionary: credentials))
        guard case let .credentials(url, user, token, expires) = message else { return XCTFail("\(message)") }
        XCTAssertEqual(url.absoluteString, "https://mindroom.chat")
        XCTAssertEqual(user, "@bas:mindroom.chat")
        XCTAssertEqual(token, "tok")
        XCTAssertEqual(expires.timeIntervalSince1970, 1_794_675_935.927, accuracy: 0.001)
        XCTAssertEqual(WatchLinkMessage(dictionary: message.dictionary), message)
    }

    func testSignedInAndSignOut() {
        let signedIn = WatchLinkMessage.signedIn(userId: "@bas:x", deviceId: "WATCH", deviceKey: "ed25519key")
        XCTAssertEqual(WatchLinkMessage(dictionary: signedIn.dictionary), signedIn)
        // The iPhone verifies only a device whose key the watch named.
        XCTAssertNil(WatchLinkMessage(dictionary: ["v": 1, "kind": "signedIn", "userId": "@bas:x", "deviceId": "WATCH"]))
        XCTAssertEqual(WatchLinkMessage(dictionary: ["v": 1, "kind": "signOut"]), .signOut)
    }

    func testSecretsBundle() {
        let message = WatchLinkMessage.secrets(userId: "@bas:x", bundle: #"{"cross_signing":{}}"#)
        XCTAssertEqual(WatchLinkMessage(dictionary: message.dictionary), message)
        XCTAssertNil(WatchLinkMessage(dictionary: ["v": 1, "kind": "secrets", "userId": "@bas:x"]))
        XCTAssertNil(WatchLinkMessage(dictionary: ["v": 1, "kind": "secrets", "userId": "bas", "bundle": "{}"]))
    }

    func testRejectsMalformedMessages() {
        var wrongVersion = credentials; wrongVersion["v"] = 2
        var noToken = credentials; noToken.removeValue(forKey: "loginToken")
        var badUser = credentials; badUser["userId"] = "bas"
        var badUrl = credentials; badUrl["homeserverUrl"] = "not a url"
        XCTAssertNil(WatchLinkMessage(dictionary: wrongVersion))
        XCTAssertNil(WatchLinkMessage(dictionary: noToken))
        XCTAssertNil(WatchLinkMessage(dictionary: badUser))
        XCTAssertNil(WatchLinkMessage(dictionary: badUrl))
        XCTAssertNil(WatchLinkMessage(dictionary: ["v": 1, "kind": "other"]))
    }

    func testPastExpiryStillParses() {
        var old = credentials; old["expiresAt"] = 0.0
        XCTAssertNotNil(WatchLinkMessage(dictionary: old))
    }
}
