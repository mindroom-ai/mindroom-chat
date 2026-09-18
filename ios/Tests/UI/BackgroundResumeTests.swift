import Darwin
import UIKit
import XCTest

/// Runs outside RoutingHost and uses real Home/activate without relaunching it.
@MainActor
final class BackgroundResumeTests: XCTestCase {
    private enum ProbeError: Error { case failed(String) }

    private func require(_ condition: Bool, _ message: String, file: StaticString = #filePath, line: UInt = #line) throws {
        guard condition else {
            XCTFail(message, file: file, line: line)
            throw ProbeError.failed(message)
        }
    }

    private struct State: Decodable {
        let bootId: String
        let checks: Int
        let path: String
        let threadId: String
        let visible: Bool
        let dark: Bool
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
        try require(probe.waitForExistence(timeout: 10), "Native process probe must exist")
        let value = try XCTUnwrap(probe.value as? String)
        let pids = value.split(separator: ",").compactMap { pid_t($0) }
        try require(pids.count == 2 && pids.allSatisfy { $0 > 1 && $0 != getpid() }, "Only valid host/WebContent process identities may be signalled")
        return pids
    }

    private func terminateWebContent(_ webPID: pid_t, pausing hostPID: pid_t?) async throws {
        var stopped: Int32 = 0
        var terminated: Int32 = -1
        var continued: Int32 = 0
        var signalErrors = ""
        if let hostPID {
            stopped = kill(hostPID, SIGSTOP)
            let stopError = stopped == 0 ? 0 : errno
            signalErrors += "stop=\(stopped), errno=\(stopError); "
            if stopped == 0 {
                // No XCTest assertion or UI query is allowed inside this pause.
                // Always unpause, including if the short dwell is cancelled.
                defer { _ = kill(hostPID, SIGCONT) }
                try await Task.sleep(nanoseconds: 100_000_000)
                terminated = kill(webPID, SIGKILL)
                let killError = terminated == 0 ? 0 : errno
                signalErrors += "kill=\(terminated), errno=\(killError); "
                try await Task.sleep(nanoseconds: 100_000_000)
                continued = kill(hostPID, SIGCONT)
                let continueError = continued == 0 ? 0 : errno
                signalErrors += "continue=\(continued), errno=\(continueError)"
            }
        } else {
            terminated = kill(webPID, SIGKILL)
            let killError = terminated == 0 ? 0 : errno
            signalErrors = "kill=\(terminated), errno=\(killError)"
        }
        let injection = "Injected host pause: \(hostPID != nil). \(signalErrors)"
        print(injection)
        let attachment = XCTAttachment(string: injection)
        attachment.name = "process-injection"
        attachment.lifetime = .keepAlways
        add(attachment)
        try require(stopped == 0 && terminated == 0 && continued == 0, "Process injection failed: \(signalErrors)")
    }

    private func assertSession(_ state: State, token: String, dark: Bool) {
        XCTAssertEqual(state.token, token)
        XCTAssertEqual(state.localToken, token)
        XCTAssertEqual(state.databaseToken, token)
        XCTAssertEqual(state.path, "/!space%3Amindroom.chat/!room%3Amindroom.chat")
        XCTAssertEqual(state.threadId, "$thread:mindroom.chat")
        XCTAssertTrue(state.visible)
        XCTAssertEqual(state.dark, dark, "The requested native appearance must reach WebKit")
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
        executionTimeAllowance = 120
        let app = XCUIApplication(bundleIdentifier: "chat.mindroom.RoutingHost")
        app.launchEnvironment["MINDROOM_BACKGROUND_PROBE"] = "1"
        app.launchEnvironment["MINDROOM_APPEARANCE"] = dark ? "dark" : "light"
        app.launch()
        defer { app.terminate() }
        var state = try await readState(app)
        let token = state.token
        let hostPID = try processes(app)[0]
        assertSession(state, token: token, dark: dark)
        try await assertPainted(app, name: "before-background")

        for cycle in 1...3 {
            let bootBefore = state.bootId
            let currentProcesses = try processes(app)
            try require(currentProcesses[0] == hostPID, "Native host must not restart between cycles")
            let webPID = currentProcesses[1]
            try require(webPID != hostPID, "WebContent must be separate from the host")
            XCUIDevice.shared.press(.home)
            try require(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended, "Home must background the host")
            let beforeDwell = app.state
            // Simulator/XCUITest may keep a backgrounded app running. Record
            // the observed state instead of claiming natural iOS suspension.
            try await Task.sleep(nanoseconds: 5_000_000_000)
            let afterDwell = app.state
            let observation = "Before dwell: \(beforeDwell). After dwell: \(afterDwell). Injected scheduler pause: \(terminateWebContent && cycle == 2)."
            print(observation)
            let lifecycle = XCTAttachment(string: observation)
            lifecycle.name = "background-state-\(cycle)"
            lifecycle.lifetime = .keepAlways
            add(lifecycle)
            try require(afterDwell == .runningBackground || afterDwell == .runningBackgroundSuspended, "Host must remain backgrounded during the probe; observed \(afterDwell)")
            if terminateWebContent {
                // One cycle explicitly pauses every host thread while WebContent
                // dies. This is fault injection, not natural iOS suspension.
                try await self.terminateWebContent(webPID, pausing: cycle == 2 ? hostPID : nil)
            }
            app.activate()
            try require(try processes(app)[0] == hostPID, "Resume must not silently cold-launch the native app")
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
            assertSession(state, token: token, dark: dark)
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
