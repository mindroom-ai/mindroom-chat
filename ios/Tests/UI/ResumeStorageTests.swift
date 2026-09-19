import Darwin
import UIKit
import XCTest

/// Causal probe only. A forced process death is not a reproduction of its cause.
@MainActor
final class ResumeStorageTests: XCTestCase {
    private enum Failure: Error { case prerequisite(String) }
    private struct Event: Decodable { let name: String; let sequence: Int }
    private struct StorageError: Decodable { let name: String; let message: String }
    private struct State: Decodable {
        let bootId: String
        let url: String
        let reads: Int
        let ticks: Int
        let writes: Int
        let closed: Bool
        let error: StorageError?
        let nativeSession: String
        let nativeEvents: [Event]
    }
    private func require(_ value: Bool, _ message: String) throws {
        guard value else { XCTFail(message); throw Failure.prerequisite(message) }
    }
    private func processes(_ app: XCUIApplication) throws -> [pid_t] {
        let label = app.staticTexts["storage-process-probe"]
        try require(label.waitForExistence(timeout: 10), "Native process identities unavailable")
        let pids = (label.value as? String ?? "").split(separator: ",").compactMap { pid_t($0) }
        try require(pids.count == 3 && Set(pids).count == 3 && pids.allSatisfy { $0 > 1 && $0 != getpid() },
                    "Only distinct, valid host/WebContent/Networking identities may be signalled: \(pids)")
        return pids
    }
    private func read(_ app: XCUIApplication, after previous: State? = nil) async throws -> State {
        let button = app.buttons["Read storage probe"]
        try require(button.waitForExistence(timeout: 15), "JavaScript probe did not load")
        button.tap()
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let output = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Storage probe ")).firstMatch
            if output.exists,
               let state = try? JSONDecoder().decode(State.self, from: Data(output.label.dropFirst("Storage probe ".count).utf8)),
               previous == nil || state.bootId != previous?.bootId || state.reads > previous!.reads {
                print("STORAGE_PROBE \(output.label)")
                let attachment = XCTAttachment(string: output.label)
                attachment.name = "storage-probe-state"
                attachment.lifetime = .keepAlways
                add(attachment)
                return state
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw Failure.prerequisite("Fresh native and JavaScript state did not arrive")
    }
    private func inject(_ pids: [pid_t], target: Int) async throws {
        try require(kill(pids[0], SIGSTOP) == 0, "Could not pause the background host")
        // No XCTest UI query or assertion while the host is paused.
        var result: Int32 = -1
        var continued: Int32 = -1
        do {
            defer { continued = kill(pids[0], SIGCONT) }
            try await Task.sleep(nanoseconds: 200_000_000)
            result = kill(pids[target], SIGKILL)
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        try require(result == 0 && continued == 0, "Targeted process termination or host continuation failed")
        print("STORAGE_PROBE injected SIGKILL target=\(target) pids=\(pids)")
    }
    private func showsFixture(_ image: UIImage) -> Bool {
        guard let cgImage = image.cgImage,
              let pixelImage = cgImage.cropping(to: CGRect(x: CGFloat(cgImage.width) / 2, y: CGFloat(cgImage.height) / 2, width: 1, height: 1)) else { return false }
        var pixel = [UInt8](repeating: 0, count: 4)
        return pixel.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(pixelImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            let rgba = bytes.bindMemory(to: UInt8.self)
            return abs(Int(rgba[0]) - 21) <= 5 && abs(Int(rgba[1]) - 62) <= 5 && abs(Int(rgba[2]) - 53) <= 5
        }
    }
    private func exercise(target: Int?, dottedRoute: Bool = false) async throws {
        executionTimeAllowance = 120
        let app = XCUIApplication(bundleIdentifier: "chat.mindroom.RoutingHost")
        app.launchEnvironment["MINDROOM_STORAGE_PROBE"] = "1"
        if dottedRoute { app.launchEnvironment["MINDROOM_STORAGE_DOTTED"] = "1" }
        app.launch()
        defer { app.terminate() }
        let initial = try await read(app)
        try require(initial.writes > 0 && initial.error == nil, "Control database writes must succeed")
        if dottedRoute {
            XCTAssertEqual(initial.url, "capacitor://localhost/home/!example%3Amindroom.chat?storageProbe=1&threadId=%24thread#reply")
        }
        let pids = try processes(app)
        XCUIDevice.shared.press(.home)
        try require(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended,
                    "Host must enter background before injection")
        print("STORAGE_PROBE backgroundState=\(app.state.rawValue) target=\(String(describing: target))")
        if let target { try await inject(pids, target: target) }
        try await Task.sleep(nanoseconds: 1_000_000_000)
        app.activate()
        let resumed = try await read(app, after: initial)
        try require(try processes(app)[0] == pids[0], "Native host unexpectedly relaunched")
        XCTAssertEqual(resumed.nativeSession, initial.nativeSession)
        // The device terminated WebContent six seconds after resume. Observe longer.
        try await Task.sleep(nanoseconds: 10_000_000_000)
        let settled = try await read(app, after: resumed)
        let screen = app.screenshot()
        let screenshot = XCTAttachment(screenshot: screen)
        screenshot.name = "storage-probe-after-resume"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertTrue(showsFixture(screen.image), "The native screenshot must paint the fixture after resume")
        XCTAssertEqual(settled.nativeSession, initial.nativeSession)
        XCTAssertEqual(settled.url, initial.url, "Recovery must preserve the full room URL")
        let terminationsBefore = initial.nativeEvents.filter { $0.name == "webview.terminated" }.count
        let terminations = settled.nativeEvents.filter { $0.name == "webview.terminated" }.count - terminationsBefore
        if target == nil {
            XCTAssertEqual(settled.bootId, initial.bootId)
            XCTAssertNil(settled.error)
            XCTAssertGreaterThan(settled.writes, initial.writes)
            XCTAssertEqual(terminations, 0)
        } else if target == 1 {
            XCTAssertNotEqual(settled.bootId, initial.bootId)
            XCTAssertEqual(terminations, 1)
            XCTAssertNil(settled.error)
            XCTAssertGreaterThan(settled.writes, 0)
        }
        // Networking outcome is deliberately measured, not assumed to kill WebContent.
        print("STORAGE_PROBE outcome target=\(String(describing: target)) newBoot=\(settled.bootId != initial.bootId) terminations=\(terminations) storageError=\(String(describing: settled.error?.name)) os=\(ProcessInfo.processInfo.operatingSystemVersionString)")
    }
    func testOrdinaryBackgroundResume() async throws { try await exercise(target: nil) }
    func testNetworkingLossDuringBackground() async throws { try await exercise(target: 2) }
    func testWebContentLossDuringBackground() async throws { try await exercise(target: 1) }
    func testWebContentLossAtDottedRouteDuringBackground() async throws {
        try await exercise(target: 1, dottedRoute: true)
    }
}
