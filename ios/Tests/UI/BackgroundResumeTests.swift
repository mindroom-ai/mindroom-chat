import Darwin
import UIKit
import XCTest

/// Runs outside RoutingHost so Home really backgrounds/suspends the app under test.
@MainActor
final class BackgroundResumeTests: XCTestCase {
    private struct State: Decodable {
        let bootId: String
        let checks: Int
        let path: String
        let threadId: String
        let visible: Bool
        let token: String
        let localToken: String?
        let databaseToken: String?
        let plugins: [String]
    }

    private func readyButton(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Probe ready ")).firstMatch
    }

    private func readState(_ app: XCUIApplication, after previous: String? = nil, afterBoot previousBoot: String? = nil) async throws -> State {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            let button = readyButton(app)
            if button.exists, button.label != previous {
                let state = try JSONDecoder().decode(State.self, from: Data(button.label.dropFirst("Probe ready ".count).utf8))
                if state.bootId != previousBoot { return state }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("The real web page must answer after resume. UI: \(app.debugDescription)")
        throw NSError(domain: "BackgroundResumeTests", code: 1)
    }

    private func processes(_ app: XCUIApplication) throws -> [pid_t] {
        let probe = app.staticTexts["native-process-probe"]
        XCTAssertTrue(probe.waitForExistence(timeout: 10))
        let value = try XCTUnwrap(probe.value as? String)
        let pids = value.split(separator: ",").compactMap { pid_t($0) }
        XCTAssertEqual(pids.count, 2)
        XCTAssertTrue(pids.allSatisfy { $0 > 1 && $0 != getpid() })
        return pids
    }

    private func assertSession(_ state: State, token: String) {
        XCTAssertEqual(state.token, token)
        XCTAssertEqual(state.localToken, token)
        XCTAssertEqual(state.databaseToken, token)
        XCTAssertEqual(state.path, "/!space%3Amindroom.chat/!room%3Amindroom.chat")
        XCTAssertEqual(state.threadId, "$thread:mindroom.chat")
        XCTAssertTrue(state.visible)
        XCTAssertEqual(state.plugins, ["INVALID_URL", "INVALID_PAGE"])
    }

    private func hasPaintedBackground(_ image: UIImage) -> Bool {
        guard let cgImage = image.cgImage,
              let center = cgImage.cropping(to: CGRect(x: cgImage.width / 2, y: cgImage.height / 2, width: 1, height: 1)) else { return false }
        var pixel = [UInt8](repeating: 0, count: 4)
        return pixel.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(center, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            let rgba = bytes.bindMemory(to: UInt8.self)
            return abs(Int(rgba[0]) - 21) <= 5 && abs(Int(rgba[1]) - 62) <= 5 && abs(Int(rgba[2]) - 53) <= 5
        }
    }

    private func assertPainted(_ app: XCUIApplication, name: String) async throws {
        let deadline = Date().addingTimeInterval(5)
        var screenshot = app.screenshot()
        while !hasPaintedBackground(screenshot.image) && Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
            screenshot = app.screenshot()
        }
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(hasPaintedBackground(screenshot.image), "\(name): native screen must paint, not only return JavaScript")
    }

    private func exerciseResume(dark: Bool, terminateWebContent: Bool) async throws {
        continueAfterFailure = false
        executionTimeAllowance = 120
        let app = XCUIApplication(bundleIdentifier: "chat.mindroom.RoutingHost")
        app.launchEnvironment["MINDROOM_BACKGROUND_PROBE"] = "1"
        app.launchEnvironment["MINDROOM_APPEARANCE"] = dark ? "dark" : "light"
        app.launch()
        defer { app.terminate() }
        var state = try await readState(app)
        let token = state.token
        let hostPID = try processes(app)[0]
        assertSession(state, token: token)
        try await assertPainted(app, name: "before-background")

        for cycle in 1...3 {
            let bootBefore = state.bootId
            let webPID = try processes(app)[1]
            XCUIDevice.shared.press(.home)
            XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended)
            // Deliberate dwell time: let iOS suspend the host before injecting a
            // real process death from the separate test runner on Simulator.
            try await Task.sleep(nanoseconds: 5_000_000_000)
            if terminateWebContent {
                XCTAssertNotEqual(webPID, hostPID)
                XCTAssertEqual(kill(webPID, SIGKILL), 0, "WebContent kill failed: \(String(cString: strerror(errno)))")
            }
            app.activate()
            XCTAssertEqual(try processes(app)[0], hostPID, "Resume must not silently cold-launch the native app")
            if terminateWebContent {
                state = try await readState(app, afterBoot: bootBefore)
                XCTAssertNotEqual(state.bootId, bootBefore, "WebContent termination must cause a real JS reboot")
            }
            let previousLabel = readyButton(app).label
            app.buttons["Check resume"].tap()
            state = try await readState(app, after: previousLabel)
            if !terminateWebContent {
                XCTAssertEqual(state.bootId, bootBefore, "Ordinary resume should retain the running page")
            }
            assertSession(state, token: token)
            try await assertPainted(app, name: "resume-\(cycle)-\(dark ? "dark" : "light")-\(terminateWebContent ? "terminated" : "normal")")
        }
    }

    func testOrdinaryBackgroundResumeLight() async throws {
        try await exerciseResume(dark: false, terminateWebContent: false)
    }

    func testOrdinaryBackgroundResumeDark() async throws {
        try await exerciseResume(dark: true, terminateWebContent: false)
    }

    func testBackgroundWebContentTerminationLight() async throws {
        try await exerciseResume(dark: false, terminateWebContent: true)
    }

    func testBackgroundWebContentTerminationDark() async throws {
        try await exerciseResume(dark: true, terminateWebContent: true)
    }
}
