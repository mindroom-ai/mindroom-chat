import UIKit

#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
/// The Store app keeps UIKit scenes and delegates native Mac operations to a typed bundle.
/// Apple calls this Catalyst integration unsupported; Store validation and review remain gates.
enum MacWindowing {
    static let widgetSize = CGSize(width: 360, height: 460)

    private static let support: MindRoomMacSupportProtocol? = {
        guard let url = Bundle.main.builtInPlugInsURL?.appendingPathComponent("MindRoomMacSupport.bundle"),
              let bundle = Bundle(url: url), bundle.load(),
              let principal = bundle.principalClass as? NSObject.Type,
              let instance = principal.init() as? MindRoomMacSupportProtocol else {
            NSLog("[QuickCapture] native Mac support could not be loaded")
            return nil
        }
        return instance
    }()

    static var lastFrontProcess: pid_t? {
        guard let pid = support?.lastFrontProcess, pid > 0 else { return nil }
        return pid
    }

    static func hostWindow(of window: UIWindow) -> NSObject? {
        guard let title = window.windowScene?.title else { return nil }
        return support?.window(titled: title)
    }

    static func pointScale(of window: NSObject, showing uiWindow: UIWindow) -> CGFloat {
        support?.pointScale(of: window, uiWidth: uiWindow.bounds.width) ?? 1
    }

    static func styleWidgetWindow(_ window: NSObject) { support?.styleWidgetWindow(window) }
    static func showWidget(_ window: NSObject) { support?.showWidget(window) }
    static func hideWidget(_ window: NSObject) { support?.hideWidget(window) }
    static func widgetIsKey(_ window: NSObject) -> Bool { support?.widgetIsKey(window) ?? false }
    static func showMainWindow(_ window: NSObject) { support?.showMainWindow(window) }
    static func displayID(of window: NSObject) -> UInt32? { support?.displayID(of: window)?.uint32Value }
    static func rememberFrontProcess() { support?.rememberFrontProcess() }
    static func followFrontProcess() { support?.followFrontProcess() }

    static func installHotKey(_ action: @escaping () -> Void) {
        if support?.installHotKey(action) != true {
            NSLog("[QuickCapture] Control+Option+Space could not be registered")
        }
    }

    static func windowOrder() -> [UInt32: Int] {
        var order: [UInt32: Int] = [:]
        for (index, number) in (support?.windowOrder() ?? []).enumerated() {
            let id = number.uint32Value
            if order[id] == nil { order[id] = index }
        }
        return order
    }
}
#endif
