import XCTest
@testable import MindRoomWatchKit

final class TokenLoginRequestTests: XCTestCase {
    func testRequestBody() throws {
        let request = TokenLoginRequest.make(homeserverUrl: URL(string: "https://mindroom.chat/")!, token: "tok")
        XCTAssertEqual(request.url?.absoluteString, "https://mindroom.chat/_matrix/client/v3/login")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: String])
        XCTAssertEqual(body, ["type": "m.login.token", "token": "tok", "initial_device_display_name": "MindRoom Apple Watch"])
    }

    func testParsesASession() throws {
        let data = Data(#"{"access_token":"at","device_id":"WATCH","user_id":"@bas:x"}"#.utf8)
        let result = try TokenLoginRequest.parse(data: data, status: 200, userId: "@bas:x")
        XCTAssertEqual(result, TokenLoginResult(accessToken: "at", deviceId: "WATCH", userId: "@bas:x"))
    }

    func testASessionOfAnotherAccountIsRefused() {
        let data = Data(#"{"access_token":"at","device_id":"WATCH","user_id":"@bob:x"}"#.utf8)
        XCTAssertThrowsError(try TokenLoginRequest.parse(data: data, status: 200, userId: "@bas:x")) { error in
            XCTAssertEqual(error as? TokenLoginError, .wrongAccount)
        }
    }

    func testForbiddenMeansTheTokenExpired() {
        let data = Data(#"{"errcode":"M_FORBIDDEN","error":"Invalid login token"}"#.utf8)
        XCTAssertThrowsError(try TokenLoginRequest.parse(data: data, status: 403, userId: "@bas:x")) { error in
            XCTAssertEqual(error as? TokenLoginError, .expired)
        }
    }

    func testOtherErrorsCarryTheServerText() {
        let data = Data(#"{"errcode":"M_UNKNOWN","error":"boom"}"#.utf8)
        XCTAssertThrowsError(try TokenLoginRequest.parse(data: data, status: 500, userId: "@bas:x")) { error in
            XCTAssertEqual(error as? TokenLoginError, .failed("boom"))
        }
    }

    func testCredentialsPastTheirExpiryNeedNoRequest() {
        let now = Date(timeIntervalSince1970: 1_000)
        let expired = WatchLinkMessage.credentials(homeserverUrl: URL(string: "https://x")!, userId: "@a:x", loginToken: "t", expiresAt: Date(timeIntervalSince1970: 999))
        let fresh = WatchLinkMessage.credentials(homeserverUrl: URL(string: "https://x")!, userId: "@a:x", loginToken: "t", expiresAt: Date(timeIntervalSince1970: 1_060))
        XCTAssertTrue(TokenLoginRequest.isExpired(expired, now: now))
        XCTAssertFalse(TokenLoginRequest.isExpired(fresh, now: now))
        XCTAssertFalse(TokenLoginRequest.isExpired(.signOut, now: now))
    }
}
