import XCTest

@MainActor
final class NativeDiagnosticsTests: XCTestCase {
    private struct Event: Decodable {
        let name: String
        let sessionId: String
        let sequence: Int
    }
    private struct Snapshot: Decodable {
        let status: String
        let currentSessionId: String?
        let events: [Event]
    }

    private func resultButton(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Native diagnostics ")).firstMatch
    }

    private func snapshot(_ app: XCUIApplication, after previous: String? = nil) async throws -> Snapshot {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            let button = resultButton(app)
            if button.exists, button.label != previous {
                return try JSONDecoder().decode(Snapshot.self, from: Data(button.label.dropFirst("Native diagnostics ".count).utf8))
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("The native export must answer with a fresh snapshot")
        throw NSError(domain: "NativeDiagnosticsTests", code: 1)
    }

    func testEvidenceSurvivesBackgroundAndNativeRelaunch() async throws {
        executionTimeAllowance = 120
        let app = XCUIApplication(bundleIdentifier: "chat.mindroom.RoutingHost")
        app.launch()
        defer { app.terminate() }
        let initial = try await snapshot(app)
        XCTAssertEqual(initial.status, "available", "Native evidence must be exportable before testing retention")
        guard initial.status == "available" else { return }
        let firstSession = try XCTUnwrap(initial.currentSessionId)
        XCTAssertTrue(initial.events.contains { $0.name == "app.launch" && $0.sessionId == firstSession })
        let sequenceBefore = initial.events.filter { $0.sessionId == firstSession }.map(\.sequence).max() ?? 0
        let previousLabel = resultButton(app).label

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended)
        app.activate()
        app.buttons["Read native diagnostics"].tap()
        let resumed = try await snapshot(app, after: previousLabel)
        XCTAssertEqual(resumed.currentSessionId, firstSession)
        let background = try XCTUnwrap(resumed.events.first {
            $0.name == "scene.background" && $0.sessionId == firstSession && $0.sequence > sequenceBefore
        })
        XCTAssertTrue(resumed.events.contains {
            $0.name == "scene.active" && $0.sessionId == firstSession && $0.sequence > background.sequence
        })

        // The completed plugin read is a persistence barrier for these events.
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))
        app.launch()
        let reopened = try await snapshot(app)
        XCTAssertEqual(reopened.status, "available")
        XCTAssertNotEqual(reopened.currentSessionId, firstSession)
        XCTAssertTrue(reopened.events.contains { $0.name == "scene.background" && $0.sessionId == firstSession },
                      "Force-close must not erase the previous session's native evidence")
        XCTAssertTrue(reopened.events.contains { $0.name == "app.launch" && $0.sessionId == reopened.currentSessionId })
    }
}
