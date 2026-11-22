import MindRoomNotificationKit
import XCTest

/// Answers the client's requests in the test process, in the chunks a test chooses.
private final class StubURLProtocol: URLProtocol {
    struct Stub {
        var statusCode = 200
        var headers: [String: String] = [:]
        var chunks: [Data] = []
        /// Never answers, as a server that hangs.
        var hangs = false
    }

    private static let lock = NSLock()
    private static var stubs: [String: Stub] = [:]

    static func set(_ stub: Stub, forPath path: String) {
        lock.lock()
        stubs[path] = stub
        lock.unlock()
    }

    static func reset() {
        lock.lock()
        stubs.removeAll()
        lock.unlock()
    }

    private static func stub(forPath path: String) -> Stub? {
        lock.lock()
        defer { lock.unlock() }
        return stubs[path]
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let url = request.url,
              let stub = Self.stub(forPath: url.path),
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: stub.statusCode,
                  httpVersion: "HTTP/1.1",
                  headerFields: stub.headers
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        if stub.hangs {
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in stub.chunks {
            client?.urlProtocol(self, didLoad: chunk)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class NotificationHTTPClientTests: XCTestCase {
    private var client: NotificationHTTPClient!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
        let configuration = NotificationHTTPClient.defaultConfiguration
        configuration.protocolClasses = [StubURLProtocol.self]
        client = NotificationHTTPClient(configuration: configuration)
    }

    override func tearDown() {
        client = nil
        StubURLProtocol.reset()
        super.tearDown()
    }

    private func request(_ path: String) -> URLRequest {
        URLRequest(url: URL(string: "https://matrix.mindroom.chat\(path)")!)
    }

    func testReturnsABodyThatArrivesInChunksUpToTheCap() async {
        StubURLProtocol.set(
            .init(chunks: [Data("abc".utf8), Data("defg".utf8)]),
            forPath: "/chunked"
        )

        let atTheCap = await client.data(for: request("/chunked"), maxBytes: 7)
        XCTAssertEqual(atTheCap, Data("abcdefg".utf8))

        let underTheCap = await client.data(for: request("/chunked"), maxBytes: 1024)
        XCTAssertEqual(underTheCap, Data("abcdefg".utf8))
    }

    func testRejectsABodyOverTheCapWhetherAnnouncedOrNot() async {
        let chunk = Data(repeating: 0x41, count: 10)
        StubURLProtocol.set(.init(chunks: [chunk, chunk]), forPath: "/streamed")
        StubURLProtocol.set(
            .init(headers: ["Content-Length": "20"], chunks: [chunk, chunk]),
            forPath: "/announced"
        )

        let streamed = await client.data(for: request("/streamed"), maxBytes: 16)
        XCTAssertNil(streamed)

        let announced = await client.data(for: request("/announced"), maxBytes: 16)
        XCTAssertNil(announced)
    }

    func testRejectsAResponseThatIsNot200() async {
        StubURLProtocol.set(.init(statusCode: 404, chunks: [Data("missing".utf8)]), forPath: "/missing")
        StubURLProtocol.set(.init(statusCode: 302, chunks: [Data("moved".utf8)]), forPath: "/moved")

        let missing = await client.data(for: request("/missing"), maxBytes: 1024)
        XCTAssertNil(missing)

        let moved = await client.data(for: request("/moved"), maxBytes: 1024)
        XCTAssertNil(moved)
    }

    func testCancellingTheCallerEndsARequestThatHangs() async {
        StubURLProtocol.set(.init(hangs: true), forPath: "/hang")
        let client: NotificationHTTPClient = self.client
        let hanging = request("/hang")
        let start = Date()

        // Cancelled while the request is out.
        let running = Task { await client.data(for: hanging, maxBytes: 1024) }
        try? await Task.sleep(nanoseconds: 100_000_000)
        running.cancel()
        let cancelledWhileRunning = await running.value
        XCTAssertNil(cancelledWhileRunning)

        // Cancelled before the request starts.
        let early = Task { await client.data(for: hanging, maxBytes: 1024) }
        early.cancel()
        let cancelledEarly = await early.value
        XCTAssertNil(cancelledEarly)

        // Well inside the 6 seconds after which the session itself gives a request up.
        XCTAssertLessThan(Date().timeIntervalSince(start), 3)
    }
}
