import XCTest
@testable import MindRoomWatchKit

final class RequestURLTests: XCTestCase {
    func testEscapesOnlyWhatAURLDoesNotAllow() {
        // A thread tag's state key is JSON: the SDK escapes its quotes and leaves its brackets.
        let url = RequestURL.make("http://127.0.0.1:28162/_matrix/client/v3/rooms/!r:matrix.localhost/state/com.mindroom.thread.tags/[%22$abc%22,%22resolved%22]")
        XCTAssertEqual(url?.absoluteString,
                       "http://127.0.0.1:28162/_matrix/client/v3/rooms/!r:matrix.localhost/state/com.mindroom.thread.tags/%5B%22$abc%22,%22resolved%22%5D")
    }

    func testLeavesAValidURLAsItIs() {
        let string = "https://matrix.example/_matrix/client/v3/rooms/!r:matrix.example/messages?dir=b&filter=%7B%22types%22%3A%5B%5D%7D"
        XCTAssertEqual(RequestURL.make(string)?.absoluteString, string)
    }

    func testKeepsAnIPv6Host() {
        let string = "http://[::1]:8008/_matrix/client/versions"
        XCTAssertEqual(RequestURL.make(string)?.absoluteString, string)
        XCTAssertEqual(RequestURL.make(string)?.port, 8008)
    }

    func testRefusesWhatIsNotAURL() {
        XCTAssertNil(RequestURL.make("not a URL"))
    }
}
