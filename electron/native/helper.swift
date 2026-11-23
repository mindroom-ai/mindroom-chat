import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

func fail(_ code: String) -> Never {
    if let data = "\(code)\n".data(using: .utf8) {
        try? FileHandle.standardError.write(contentsOf: data)
    }
    exit(2)
}

func onScreenWindows() -> [[String: Any]] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    return CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] ?? []
}

func frontWindowId(of pid: pid_t) -> CGWindowID? {
    for info in onScreenWindows() {
        guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let dict = info[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: dict as CFDictionary),
              rect.width > 1, rect.height > 1,
              let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value
        else { continue }
        return id
    }
    return nil
}

func runFront() {
    let rawPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let pid: pid_t? = (rawPid ?? 0) > 0 ? rawPid : nil
    let windowId = pid.flatMap { frontWindowId(of: $0) }
    let json = "{\"pid\":\(pid.map(String.init) ?? "null"),\"windowId\":\(windowId.map(String.init) ?? "null")}\n"
    if let data = json.data(using: .utf8) { try? FileHandle.standardOutput.write(contentsOf: data) }
}

@available(macOS 14.0, *)
func isDeclined(_ error: Error) -> Bool {
    let ns = error as NSError
    return ns.domain == SCStreamErrorDomain && ns.code == SCStreamError.Code.userDeclined.rawValue
}

@available(macOS 14.0, *)
func shareableContent() async -> SCShareableContent {
    do { return try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) }
    catch { fail(isDeclined(error) ? "PERMISSION_DENIED" : "CAPTURE_FAILED") }
}

@available(macOS 14.0, *)
func capturePNG(filter: SCContentFilter) async -> Data {
    let scale = CGFloat(filter.pointPixelScale)
    let width = Int((filter.contentRect.width * scale).rounded())
    let height = Int((filter.contentRect.height * scale).rounded())
    guard width > 0, height > 0 else { fail("CAPTURE_FAILED") }
    let config = SCStreamConfiguration()
    config.width = width
    config.height = height
    config.showsCursor = false

    let image: CGImage
    do { image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) }
    catch { fail(isDeclined(error) ? "PERMISSION_DENIED" : "CAPTURE_FAILED") }

    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
        fail("CAPTURE_FAILED")
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fail("CAPTURE_FAILED") }
    return data as Data
}

@available(macOS 14.0, *)
func captureWindow(pid: pid_t, windowId: CGWindowID) async -> Data {
    let content = await shareableContent()
    guard let window = content.windows.first(where: {
        $0.windowID == windowId && $0.owningApplication?.processID == pid
            && $0.isOnScreen && $0.frame.width > 1 && $0.frame.height > 1
    }) else { fail("NO_WINDOW") }
    return await capturePNG(filter: SCContentFilter(desktopIndependentWindow: window))
}

@available(macOS 14.0, *)
func captureScreen(displayId: CGDirectDisplayID, ownPid: pid_t) async -> Data {
    let content = await shareableContent()
    guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
        fail("CAPTURE_FAILED")
    }
    let excluded = content.applications.filter { $0.processID == ownPid }
    return await capturePNG(filter: SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []))
}

func parseFlags(_ args: ArraySlice<String>) -> [String: String] {
    var flags: [String: String] = [:]
    var i = args.startIndex
    while i < args.endIndex {
        let key = args[i], next = args.index(after: i)
        guard key.hasPrefix("--"), next < args.endIndex, flags[key] == nil else { fail("CAPTURE_FAILED") }
        flags[key] = args[next]
        i = args.index(after: next)
    }
    return flags
}

@available(macOS 14.0, *)
func runCapture(_ work: @escaping @Sendable () async -> Data) {
    _ = CGMainDisplayID()
    let sem = DispatchSemaphore(value: 0)
    Task {
        let png = await work()
        do { try FileHandle.standardOutput.write(contentsOf: png) }
        catch { fail("CAPTURE_FAILED") }
        sem.signal()
    }
    sem.wait()
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("CAPTURE_FAILED") }
switch args[1] {
case "front":
    guard args.count == 2 else { fail("CAPTURE_FAILED") }
    runFront()
case "window":
    let flags = parseFlags(args.dropFirst(2))
    guard Set(flags.keys) == ["--pid", "--window"],
          let pid = flags["--pid"].flatMap({ Int32($0) }), pid > 0,
          let windowId = flags["--window"].flatMap({ UInt32($0) }) else { fail("CAPTURE_FAILED") }
    guard #available(macOS 14.0, *) else { fail("UNSUPPORTED") }
    runCapture { await captureWindow(pid: pid, windowId: windowId) }
case "screen":
    let flags = parseFlags(args.dropFirst(2))
    guard Set(flags.keys) == ["--display", "--own-pid"],
          let displayId = flags["--display"].flatMap({ UInt32($0) }),
          let ownPid = flags["--own-pid"].flatMap({ Int32($0) }), ownPid > 0 else { fail("CAPTURE_FAILED") }
    guard #available(macOS 14.0, *) else { fail("UNSUPPORTED") }
    runCapture { await captureScreen(displayId: displayId, ownPid: ownPid) }
default:
    fail("CAPTURE_FAILED")
}
