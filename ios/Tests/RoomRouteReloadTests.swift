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
        return webView
    }

    private func moveTo(_ route: String, in webView: WKWebView) async throws {
        let json = String(data: try JSONSerialization.data(withJSONObject: [route]), encoding: .utf8)!
        _ = try await webView.evaluateJavaScript("history.pushState({}, '', \(json)[0]); null;")
    }

    private func attachScreenshot(_ webView: WKWebView, name: String) {
        // Draw the actual native view, including the blank view after process death.
        let renderer = UIGraphicsImageRenderer(bounds: webView.bounds)
        let image = renderer.image { _ in
            webView.drawHierarchy(in: webView.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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
        attachScreenshot(webView, name: "room-before-reload")
        webView.reload()
        let recovered = await waitForBoot(webView, after: previous)
        attachScreenshot(webView, name: "room-after-reload")
        XCTAssertTrue(recovered, "Reload must boot a new JS context at a dot-suffixed Matrix room URL")
        XCTAssertEqual(webView.url, originalURL)
    }

    func testWebContentTerminationRecoversAtRoomURL() async throws {
        let webView = try await openFixture()
        try await moveTo("/home/!example%3Amindroom.chat?threadId=%24thread", in: webView)
        _ = try await webView.evaluateJavaScript("localStorage.setItem('routing-session', 'preserved'); null;")
        let previous = await bootId(webView)
        let originalURL = webView.url
        attachScreenshot(webView, name: "room-before-process-termination")

        // WebKit's testing API kills the real WebContent process. This is confined
        // to the test bundle; the shipping Capacitor navigation delegate handles it.
        let terminate = NSSelectorFromString("_killWebContentProcess")
        XCTAssertTrue(webView.responds(to: terminate), "Simulator must support WebContent termination")
        guard webView.responds(to: terminate) else { return }
        webView.perform(terminate)

        let recovered = await waitForBoot(webView, after: previous)
        attachScreenshot(webView, name: "room-after-process-termination")
        XCTAssertTrue(recovered, "Capacitor's process-termination reload must restore the room document")
        XCTAssertEqual(webView.url, originalURL)
        if recovered {
            let session = try await webView.evaluateJavaScript("localStorage.getItem('routing-session')") as? String
            XCTAssertEqual(session, "preserved")
            let contentType = try await webView.evaluateJavaScript("document.contentType") as? String
            XCTAssertEqual(contentType, "text/html")
        }
    }
}
