import UIKit

#if targetEnvironment(macCatalyst)
import ScreenCaptureKit

/// Screenshots for Quick Capture, as PNG files in the app's temporary folder: the front window of
/// the app that was in front before the widget, or the screen the widget is on without this app's
/// windows.
enum MacScreenshot {
    enum Target: String {
        case window
        case screen
    }

    enum Failure: String, Error {
        case permissionDenied = "PERMISSION_DENIED"
        case noWindow = "NO_WINDOW"
        case unsupported = "UNSUPPORTED"
        case captureFailed = "CAPTURE_FAILED"
    }

    static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("quick-capture", isDirectory: true)
    }

    /// Deletes earlier captures, which the page fetched as it attached them.
    static func clearFolder() {
        try? FileManager.default.removeItem(at: folder)
    }

    /// Captures `target` and resolves the PNG's path and file name.
    static func capture(
        _ target: Target,
        frontProcess: pid_t?,
        display: UInt32?
    ) async throws -> (path: String, name: String) {
        guard #available(macCatalyst 18.2, *) else { throw Failure.unsupported }
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        } catch {
            throw isDeclined(error) ? Failure.permissionDenied : Failure.captureFailed
        }
        let filter: SCContentFilter
        let label: String
        switch target {
        case .window:
            guard let pid = frontProcess, let window = frontWindow(of: pid, in: content.windows) else {
                throw Failure.noWindow
            }
            filter = SCContentFilter(desktopIndependentWindow: window)
            label = window.owningApplication?.applicationName ?? "Window"
        case .screen:
            guard let screen = content.displays.first(where: { $0.displayID == display }) ?? content.displays.first else {
                throw Failure.captureFailed
            }
            let own = content.applications.filter { $0.processID == getpid() }
            filter = SCContentFilter(display: screen, excludingApplications: own, exceptingWindows: [])
            label = "Screen"
        }
        let configuration = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        configuration.width = Int((filter.contentRect.width * scale).rounded())
        configuration.height = Int((filter.contentRect.height * scale).rounded())
        configuration.showsCursor = false
        let image: CGImage
        do {
            image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } catch {
            throw isDeclined(error) ? Failure.permissionDenied : Failure.captureFailed
        }
        return try write(image, label: label)
    }

    /// The frontmost on-screen window of `pid` at the normal window level.
    @available(macCatalyst 18.2, *)
    private static func frontWindow(of pid: pid_t, in windows: [SCWindow]) -> SCWindow? {
        let own = windows.filter {
            $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.isOnScreen
                && $0.frame.width > 1 && $0.frame.height > 1
        }
        // Front to back, as the window server orders them.
        let order = windowOrder()
        return own.min { (order[$0.windowID] ?? .max) < (order[$1.windowID] ?? .max) }
    }

    /// Window numbers of the on-screen windows, front to back.
    private static func windowOrder() -> [CGWindowID: Int] {
        typealias CopyWindowInfo = @convention(c) (UInt32, CGWindowID) -> Unmanaged<CFArray>?
        guard let graphics = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_LAZY),
              let symbol = dlsym(graphics, "CGWindowListCopyWindowInfo") else { return [:] }
        let onScreenOnly: UInt32 = 1 << 0
        let list = unsafeBitCast(symbol, to: CopyWindowInfo.self)(onScreenOnly, 0)?.takeRetainedValue()
        let windows = list as? [[String: Any]] ?? []
        var order: [CGWindowID: Int] = [:]
        for (index, info) in windows.enumerated() {
            if let number = (info["kCGWindowNumber"] as? NSNumber)?.uint32Value, order[number] == nil {
                order[number] = index
            }
        }
        return order
    }

    @available(macCatalyst 18.2, *)
    private static func isDeclined(_ error: Error) -> Bool {
        let error = error as NSError
        return error.domain == SCStreamErrorDomain && error.code == SCStreamError.Code.userDeclined.rawValue
    }

    private static func write(_ image: CGImage, label: String) throws -> (path: String, name: String) {
        guard let data = UIImage(cgImage: image).pngData() else { throw Failure.captureFailed }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let safeLabel = label.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let name = "Screenshot \(safeLabel) \(formatter.string(from: Date())).png"
        clearFolder()
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent(name, isDirectory: false)
            try data.write(to: file, options: .atomic)
            return (file.path, name)
        } catch {
            throw Failure.captureFailed
        }
    }
}
#endif
