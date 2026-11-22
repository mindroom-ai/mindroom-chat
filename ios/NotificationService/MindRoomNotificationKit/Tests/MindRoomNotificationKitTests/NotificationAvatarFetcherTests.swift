import MindRoomNotificationKit
import XCTest

final class NotificationAvatarFetcherTests: XCTestCase {
    func testParseMxcUriAcceptsValidAndRejectsMalformedOrTraversal() {
        let valid = NotificationAvatarFetcher.parseMxcUri("mxc://mindroom.chat/abc123_XYZ-9")
        XCTAssertEqual(valid?.server, "mindroom.chat")
        XCTAssertEqual(valid?.mediaId, "abc123_XYZ-9")

        let withPort = NotificationAvatarFetcher.parseMxcUri("mxc://matrix.example.com:8448/media1")
        XCTAssertEqual(withPort?.server, "matrix.example.com:8448")
        XCTAssertEqual(withPort?.mediaId, "media1")

        let invalidUris = [
            "",
            "https://mindroom.chat/abc",
            "mxc://",
            "mxc://mindroom.chat",
            "mxc://mindroom.chat/",
            "mxc:///abc",
            "mxc://mindroom.chat/a/b",
            "mxc://../etc/passwd",
            "mxc://mindroom.chat/..",
            "mxc://mindroom.chat/a..b",
            "mxc://mindroom.chat/.",
            "mxc://mindroom.chat/abc?width=1",
            "mxc://mindroom.chat/abc#frag",
            "mxc://mindroom.chat/abc def",
            "mxc://mindroom.chat/abc%2fdef",
            "mxc://evil@mindroom.chat/abc",
        ]
        for uri in invalidUris {
            XCTAssertNil(NotificationAvatarFetcher.parseMxcUri(uri), "Expected invalid mxc URI: \(uri)")
        }
    }

    func testRejectsNonHttpsHomeserverByDefault() async {
        final class Counter: @unchecked Sendable { var calls = 0 }
        let counter = Counter()
        let fetcher = NotificationAvatarFetcher(transport: { request in
            counter.calls += 1
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (TestImageFixtures.samplePNG, response)
        })

        let httpResult = await fetcher.downloadThumbnail(
            homeserverUrl: "http://mindroom.chat",
            accessToken: "token",
            mxcUrl: "mxc://mindroom.chat/media1"
        )
        XCTAssertNil(httpResult)

        let localhostDefault = await fetcher.downloadThumbnail(
            homeserverUrl: "http://127.0.0.1:8008",
            accessToken: "token",
            mxcUrl: "mxc://mindroom.chat/media1"
        )
        XCTAssertNil(localhostDefault)
        XCTAssertEqual(counter.calls, 0)

        let localFetcher = NotificationAvatarFetcher(allowInsecureLocalhost: true, transport: { request in
            counter.calls += 1
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (TestImageFixtures.samplePNG, response)
        })
        let localAllowed = await localFetcher.downloadThumbnail(
            homeserverUrl: "http://127.0.0.1:8008",
            accessToken: "token",
            mxcUrl: "mxc://mindroom.chat/media1"
        )
        XCTAssertEqual(localAllowed, TestImageFixtures.samplePNG)
        XCTAssertEqual(counter.calls, 1)
    }

    func testDownloadsThumbnailAndFetchesSenderAvatarWithBearerAuth() async {
        final class Recorder: @unchecked Sendable { var requests: [URLRequest] = [] }
        let recorder = Recorder()

        let fetcher = NotificationAvatarFetcher(transport: { request in
            recorder.requests.append(request)
            let url = request.url!
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if url.path.contains("/_matrix/client/v3/profile/") {
                let body = Data(#"{"avatar_url":"mxc://mindroom.chat/avatar42"}"#.utf8)
                return (body, response)
            }
            return (TestImageFixtures.samplePNG, response)
        })

        let fetched = await fetcher.fetchSenderAvatar(
            homeserverUrl: "https://matrix.mindroom.chat/",
            accessToken: "secret-token",
            sender: "@mindroom_dev:mindroom.chat"
        )

        XCTAssertEqual(fetched?.mxcUrl, "mxc://mindroom.chat/avatar42")
        XCTAssertEqual(fetched?.data, TestImageFixtures.samplePNG)
        XCTAssertEqual(recorder.requests.count, 2)

        XCTAssertEqual(
            recorder.requests[0].url?.absoluteString,
            "https://matrix.mindroom.chat/_matrix/client/v3/profile/%40mindroom_dev%3Amindroom.chat/avatar_url"
        )
        XCTAssertEqual(recorder.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer secret-token")

        XCTAssertEqual(
            recorder.requests[1].url?.absoluteString,
            "https://matrix.mindroom.chat/_matrix/client/v1/media/thumbnail/mindroom.chat/avatar42?width=128&height=128&method=crop"
        )
        XCTAssertEqual(recorder.requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer secret-token")
    }

    func testRejectsOversizedProfileOversizedImageDecompressionBombAndNon200() async {
        // Profile JSON exceeding 64 KiB is rejected before downloading thumbnail
        let padded = String(repeating: " ", count: NotificationAvatarFetcher.maxProfileBytes + 1)
        let oversizedProfileBody = Data("{\"avatar_url\":\"mxc://mindroom.chat/a\"\(padded)}".utf8)
        let profileFetcher = NotificationAvatarFetcher(transport: { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (oversizedProfileBody, response)
        })
        let oversizedProfileResult = await profileFetcher.fetchSenderAvatar(
            homeserverUrl: "https://matrix.mindroom.chat",
            accessToken: "tok",
            sender: "@alice:mindroom.chat"
        )
        XCTAssertNil(oversizedProfileResult)

        // Thumbnail exceeding 512 KiB is rejected
        var oversizedBuffer = TestImageFixtures.samplePNG
        oversizedBuffer.append(Data(repeating: 0x00, count: NotificationAvatarStore.maxAvatarBytes))
        let oversizedData = oversizedBuffer

        let oversizedFetcher = NotificationAvatarFetcher(transport: { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (oversizedData, response)
        })
        let oversizedResult = await oversizedFetcher.downloadThumbnail(
            homeserverUrl: "https://matrix.mindroom.chat",
            accessToken: "tok",
            mxcUrl: "mxc://mindroom.chat/big"
        )
        XCTAssertNil(oversizedResult)

        // Decompression bomb header (5000x5000) is rejected
        let bombFetcher = NotificationAvatarFetcher(transport: { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (TestImageFixtures.bomb5000x5000PNG, response)
        })
        let bombResult = await bombFetcher.downloadThumbnail(
            homeserverUrl: "https://matrix.mindroom.chat",
            accessToken: "tok",
            mxcUrl: "mxc://mindroom.chat/bomb"
        )
        XCTAssertNil(bombResult)

        let htmlFetcher = NotificationAvatarFetcher(transport: { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data("<html>error</html>".utf8), response)
        })
        let htmlResult = await htmlFetcher.downloadThumbnail(
            homeserverUrl: "https://matrix.mindroom.chat",
            accessToken: "tok",
            mxcUrl: "mxc://mindroom.chat/html"
        )
        XCTAssertNil(htmlResult)

        let redirectFetcher = NotificationAvatarFetcher(transport: { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: nil, headerFields: nil)!
            return (TestImageFixtures.samplePNG, response)
        })
        let redirectResult = await redirectFetcher.downloadThumbnail(
            homeserverUrl: "https://matrix.mindroom.chat",
            accessToken: "tok",
            mxcUrl: "mxc://mindroom.chat/redirect"
        )
        XCTAssertNil(redirectResult)
    }

    func testSameOriginCheckAndRedirectDelegateBlocksCrossOrigin() {
        let base = URL(string: "https://matrix.mindroom.chat/_matrix/client/v1/media/thumbnail/a/b")!
        let sameOrigin = URL(string: "https://matrix.mindroom.chat:443/other")!
        let diffHost = URL(string: "https://evil.example/steal")!
        let diffScheme = URL(string: "http://matrix.mindroom.chat/downgrade")!
        let diffPort = URL(string: "https://matrix.mindroom.chat:8448/other")!

        XCTAssertTrue(NotificationAvatarFetcher.hasSameOrigin(base, sameOrigin))
        XCTAssertFalse(NotificationAvatarFetcher.hasSameOrigin(base, diffHost))
        XCTAssertFalse(NotificationAvatarFetcher.hasSameOrigin(base, diffScheme))
        XCTAssertFalse(NotificationAvatarFetcher.hasSameOrigin(base, diffPort))

        let delegate = SameOriginRedirectDelegate()
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: URLRequest(url: base))
        let redirectResponse = HTTPURLResponse(url: base, statusCode: 302, httpVersion: nil, headerFields: nil)!

        var allowedCrossOrigin: URLRequest? = URLRequest(url: diffHost)
        let crossExp = expectation(description: "cross-origin redirect blocked")
        delegate.urlSession(
            session,
            task: task,
            willPerformHTTPRedirection: redirectResponse,
            newRequest: URLRequest(url: diffHost)
        ) { nextRequest in
            allowedCrossOrigin = nextRequest
            crossExp.fulfill()
        }
        wait(for: [crossExp], timeout: 2)
        XCTAssertNil(allowedCrossOrigin)

        var allowedSameOrigin: URLRequest?
        let sameExp = expectation(description: "same-origin redirect allowed")
        delegate.urlSession(
            session,
            task: task,
            willPerformHTTPRedirection: redirectResponse,
            newRequest: URLRequest(url: sameOrigin)
        ) { nextRequest in
            allowedSameOrigin = nextRequest
            sameExp.fulfill()
        }
        wait(for: [sameExp], timeout: 2)
        XCTAssertEqual(allowedSameOrigin?.url, sameOrigin)
    }
}
