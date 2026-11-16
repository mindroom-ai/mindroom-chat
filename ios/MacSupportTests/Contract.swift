import AppKit
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct Contract {
    static func main() {
        require(CommandLine.arguments.count == 2, "pass the native bundle path")
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let bundle = Bundle(url: url), bundle.load(),
              let principal = bundle.principalClass as? NSObject.Type,
              let support = principal.init() as? MindRoomMacSupportProtocol else {
            require(false, "native support bundle must load through its declared protocol")
            return
        }

        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let scenes = MacStoreSceneState()
        let firstTitle = scenes.prepare("first", title: "MindRoom")
        let secondTitle = scenes.prepare("second", title: "MindRoom")
        require(firstTitle != secondTitle && firstTitle != "MindRoom", "each scene needs a one-time unique title")
        let firstHandle = NSObject()
        require(scenes.resolve("first", lookup: { $0 == firstTitle ? firstHandle : nil }) === firstHandle, "bind the intended scene")
        require(scenes.resolve("first", lookup: { _ in nil }) === firstHandle, "keep identity after restoring the visible title")
        scenes.disconnect("first")
        require(scenes.resolve("first", lookup: { _ in firstHandle }) == nil, "disconnect must discard the old binding")
        require(scenes.prepare("first", title: "MindRoom") != firstTitle, "reopening must not reuse a retained window title")
        var deliveries: [String] = []
        scenes.enqueue { deliveries.append($0) }
        require(deliveries.isEmpty, "cold links must wait for the main bridge")
        scenes.mainReady("old-main")
        require(deliveries == ["old-main"], "deliver queued links once to the ready main bridge")
        scenes.mainReady("old-main")
        require(deliveries.count == 1, "another appearance must not replay old links")
        scenes.disconnect("old-main")
        scenes.enqueue { deliveries.append($0) }
        require(deliveries.count == 1, "a closed main bridge cannot receive new links")
        scenes.mainReady("new-main")
        require(deliveries == ["old-main", "new-main"], "a restored widget must deliver to the reopened main bridge")
        scenes.reportFailure("Quick Capture unavailable")
        scenes.mainReady("new-main")
        require(scenes.failure == "Quick Capture unavailable", "startup errors must survive until a UI can present them")
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 460),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.title = "MindRoom Mac support contract \(UUID().uuidString)"
        defer { window.close() }

        require(support.window(titled: window.title) === window, "find an owned window by its public title")
        let duplicate = NSWindow(contentRect: window.frame, styleMask: [.titled], backing: .buffered, defer: false)
        duplicate.isReleasedWhenClosed = false
        duplicate.title = window.title
        require(support.window(titled: window.title) == nil, "ambiguous titles must never select a window")
        duplicate.title = "Closed scene \(UUID().uuidString)"
        duplicate.close()
        require(support.window(titled: window.title) === window, "closing a duplicate cannot change the selected scene")
        require(support.window(titled: "missing-\(UUID().uuidString)") == nil, "never choose an unrelated window")
        require(support.pointScale(of: window, uiWidth: 180) == 2, "convert UIKit points using actual content width")
        require(support.pointScale(of: window, uiWidth: 0) == 1, "zero UIKit width has a safe scale")
        require(support.pointScale(of: NSObject(), uiWidth: 180) == 1, "reject an invalid window handle")
        require(!support.widgetIsKey(window), "a hidden window must not take the keyboard")

        support.styleWidgetWindow(window)
        require(window.level == .floating, "keep Quick Capture above ordinary windows")
        require(window.isMovableByWindowBackground, "allow dragging Quick Capture by its background")
        require(window.titleVisibility == .hidden, "hide the Quick Capture title")
        require(window.tabbingMode == .disallowed, "keep Quick Capture out of document tabs")
        require(window.standardWindowButton(.closeButton)?.isHidden ?? true, "hide or omit standard window buttons")
        require(window.contentView?.superview?.subviews.filter { $0 is NSVisualEffectView }.count == 1, "add one material background")
        support.styleWidgetWindow(window)
        require(window.contentView?.superview?.subviews.filter { $0 is NSVisualEffectView }.count == 1, "restyling must not duplicate the material")
        support.hideWidget(window)
        require(!window.isVisible, "hiding a widget leaves no visible window")
        print("PASS: native bundle loading, title isolation, point conversion, floating chrome and hidden-window behavior")
    }
}
