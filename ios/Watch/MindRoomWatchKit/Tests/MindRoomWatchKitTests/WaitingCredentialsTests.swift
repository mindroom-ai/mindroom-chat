import XCTest
@testable import MindRoomWatchKit

final class WaitingCredentialsTests: XCTestCase {
    private func credentials(_ token: String) -> WatchLinkMessage {
        .credentials(homeserverUrl: URL(string: "https://matrix.example")!, userId: "@bas:matrix.example",
                     loginToken: token, expiresAt: Date(timeIntervalSince1970: 2_000_000_000))
    }

    func testWaitUntilTheAppIsInFront() {
        var waiting = WaitingCredentials()
        waiting.received(credentials("a"))
        XCTAssertNil(waiting.take(inFront: false))
        XCTAssertEqual(waiting.take(inFront: true), credentials("a"))
        XCTAssertNil(waiting.take(inFront: true))
    }

    func testTheNewestReplaceWhatWaited() {
        var waiting = WaitingCredentials()
        waiting.received(credentials("a"))
        waiting.received(credentials("b"))
        XCTAssertEqual(waiting.take(inFront: true), credentials("b"))
        XCTAssertNil(waiting.take(inFront: true))
    }

    func testASignInTheNetworkFailedWaitsAgain() {
        var waiting = WaitingCredentials()
        waiting.received(credentials("a"))
        XCTAssertEqual(waiting.take(inFront: true), credentials("a"))
        waiting.notSent(credentials("a"))
        XCTAssertEqual(waiting.take(inFront: true), credentials("a"))
    }

    func testAFailedSignInDoesNotReplaceNewerCredentials() {
        var waiting = WaitingCredentials()
        waiting.received(credentials("a"))
        XCTAssertEqual(waiting.take(inFront: true), credentials("a"))
        waiting.received(credentials("b"))
        waiting.notSent(credentials("a"))
        XCTAssertEqual(waiting.take(inFront: true), credentials("b"))
    }

    func testForgetsThem() {
        var waiting = WaitingCredentials()
        waiting.received(credentials("a"))
        waiting.clear()
        XCTAssertNil(waiting.take(inFront: true))
    }
}
