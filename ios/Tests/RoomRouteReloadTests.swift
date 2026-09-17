import Capacitor
import WebKit
import XCTest
@testable import RoutingHost

/// Uses the shipping scene, bridge controller, plugins, and Capacitor asset handler.
/// Only the web bundle is replaced with a tiny page that identifies each JS boot.
@MainActor
final class RoomRouteReloadTests: XCTestCase {
    private func appWebView() throws -> WKWebView {
        let controller = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .compactMap { $0.rootViewController as? MindRoomBridgeViewController }
            .first
        return try XCTUnwrap(controller?.webView)
    }

    private func bootId(_ webView: WKWebView) async -> String? {
        try? await webView.evaluateJavaScript("window.routingBootId") as? String
    }

    private func waitForBoot(_ webView: WKWebView, after previous: String? = nil) async -> Bool {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if let current = await bootId(webView), current != previous {
                return true
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }

    private func openFixture() async throws -> WKWebView {
        let webView = try appWebView()
        let previous = await bootId(webView)
        webView.load(URLRequest(url: URL(string: "capacitor://localhost/")!))
        let loaded = await waitForBoot(webView, after: previous)
        XCTAssertTrue(loaded, "Control: bundled index.html must load before testing reload")
        let background = try await webView.evaluateJavaScript("getComputedStyle(document.body).backgroundColor") as? String
        XCTAssertEqual(background, "rgb(21, 62, 53)", "The fixture stylesheet must load")
        return webView
    }

    private func moveTo(_ route: String, in webView: WKWebView) async throws {
        let json = String(data: try JSONSerialization.data(withJSONObject: [route]), encoding: .utf8)!
        _ = try await webView.evaluateJavaScript("history.pushState({}, '', \(json)[0]); null;")
    }

    private func showsFixtureBackground(_ image: UIImage) -> Bool {
        guard let cgImage = image.cgImage,
              let center = cgImage.cropping(to: CGRect(x: cgImage.width / 2, y: cgImage.height / 2, width: 1, height: 1)) else {
            return false
        }
        var pixel = [UInt8](repeating: 0, count: 4)
        return pixel.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(
                data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
            ) else { return false }
            context.draw(center, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            let rgba = bytes.bindMemory(to: UInt8.self)
            return abs(Int(rgba[0]) - 21) <= 5 && abs(Int(rgba[1]) - 62) <= 5 && abs(Int(rgba[2]) - 53) <= 5
        }
    }

    private func attachScreenshot(_ webView: WKWebView, name: String, expectRendered: Bool = true) async {
        // Draw the actual native view, including the blank view after process death.
        // A new JS context can report ready before WebKit presents its first frame.
        func capture() -> UIImage {
            UIGraphicsImageRenderer(bounds: webView.bounds).image { _ in
                webView.drawHierarchy(in: webView.bounds, afterScreenUpdates: true)
            }
        }
        var image = capture()
        if expectRendered {
            let deadline = Date().addingTimeInterval(5)
            while !showsFixtureBackground(image) && Date() < deadline {
                try? await Task.sleep(nanoseconds: 100_000_000)
                image = capture()
            }
            XCTAssertTrue(showsFixtureBackground(image), "\(name): native view must visibly paint the fixture")
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func checkNativePlugins(_ webView: WKWebView) async throws {
        // Invalid arguments return immediately without showing authentication or
        // file-save UI, while exercising a real JS -> Swift -> JS round trip.
        let errors = try await webView.callAsyncJavaScript("""
            return await Promise.all([
              ['MindRoomAuth', 'authenticate'],
              ['MindRoomFileSave', 'beginSave'],
            ].map(async ([plugin, method]) => {
              try { await window.Capacitor.nativePromise(plugin, method, {}); }
              catch (error) { return error.code; }
              return 'unexpected success';
            }));
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(errors, ["INVALID_URL", "INVALID_PAGE"])
    }

    private func storedSession(_ webView: WKWebView, write: Bool) async throws -> String? {
        try await webView.callAsyncJavaScript("""
            const db = await new Promise((resolve, reject) => {
              const request = indexedDB.open('routing-session', 1);
              request.onupgradeneeded = () => request.result.createObjectStore('session');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              return await new Promise((resolve, reject) => {
                const transaction = db.transaction('session', write ? 'readwrite' : 'readonly');
                const store = transaction.objectStore('session');
                const request = write ? store.put('preserved', 'token') : store.get('token');
                transaction.oncomplete = () => resolve(write ? 'preserved' : request.result);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
              });
            } finally { db.close(); }
            """, arguments: ["write": write], in: nil, contentWorld: .page) as? String
    }

    func testExtensionlessRoomReloadControl() async throws {
        let webView = try await openFixture()
        try await moveTo("/home/!example%3Alocalhost", in: webView)
        let previous = await bootId(webView)
        webView.reload()
        let recovered = await waitForBoot(webView, after: previous)
        XCTAssertTrue(recovered, "Control: an extensionless room URL must reload")
    }

    func testDottedRoomReloadBootsAtSameURL() async throws {
        let webView = try await openFixture()
        try await moveTo("/home/!example%3Amindroom.chat?threadId=%24thread#reply", in: webView)
        let previous = await bootId(webView)
        let originalURL = webView.url
        await attachScreenshot(webView, name: "room-before-reload")
        webView.reload()
        let recovered = await waitForBoot(webView, after: previous)
        await attachScreenshot(webView, name: "room-after-reload", expectRendered: recovered)
        XCTAssertTrue(recovered, "Reload must boot a new JS context at a dot-suffixed Matrix room URL")
        XCTAssertEqual(webView.url, originalURL)
    }

    func testDottedRouteFamiliesReloadAsHTML() async throws {
        let routes = [
            "/direct/!room%3Amatrix.org", "/%23space%3Amindroom.chat",
            "/!space%3Amindroom.chat/!room%3Amatrix.org",
            "/home/!room%3Amindroom.chat/%24event%3Amatrix.org",
            "/explore/mindroom.chat", "/login/mindroom.chat",
            "/home/!room%3Aexample.mp4", "/home/!room%3Acordova.js"
        ]
        let webView = try await openFixture()
        for route in routes {
            try await moveTo(route, in: webView)
            let previous = await bootId(webView)
            let originalURL = webView.url
            webView.reload()
            let recovered = await waitForBoot(webView, after: previous)
            XCTAssertTrue(recovered, route)
            guard recovered else { return }
            XCTAssertEqual(webView.url, originalURL, route)
            let contentType = try await webView.evaluateJavaScript("document.contentType") as? String
            XCTAssertEqual(contentType, "text/html", route)
            let background = try await webView.evaluateJavaScript("getComputedStyle(document.body).backgroundColor") as? String
            XCTAssertEqual(background, "rgb(21, 62, 53)", route)
        }
    }

    func testWebContentTerminationRecoversAtRoomURL() async throws {
        let webView = try await openFixture()
        try await moveTo("/home/!example%3Amindroom.chat?threadId=%24thread", in: webView)
        _ = try await webView.evaluateJavaScript("localStorage.setItem('routing-session', 'preserved'); null;")
        let previous = await bootId(webView)
        let originalURL = webView.url
        try await checkNativePlugins(webView)
        let initialSession = try await storedSession(webView, write: true)
        XCTAssertEqual(initialSession, "preserved")
        await attachScreenshot(webView, name: "room-before-process-termination")

        // WebKit's testing API kills the real WebContent process. This is confined
        // to the test bundle; the shipping Capacitor navigation delegate handles it.
        let terminate = NSSelectorFromString("_killWebContentProcess")
        XCTAssertTrue(webView.responds(to: terminate), "Simulator must support WebContent termination")
        guard webView.responds(to: terminate) else { return }
        webView.perform(terminate)

        let recovered = await waitForBoot(webView, after: previous)
        await attachScreenshot(webView, name: "room-after-process-termination", expectRendered: recovered)
        XCTAssertTrue(recovered, "Capacitor's process-termination reload must restore the room document")
        XCTAssertEqual(webView.url, originalURL)
        if recovered {
            let session = try await webView.evaluateJavaScript("localStorage.getItem('routing-session')") as? String
            XCTAssertEqual(session, "preserved")
            let contentType = try await webView.evaluateJavaScript("document.contentType") as? String
            XCTAssertEqual(contentType, "text/html")
            try await checkNativePlugins(webView)
            let restoredSession = try await storedSession(webView, write: false)
            XCTAssertEqual(restoredSession, "preserved")
        }
    }
}
