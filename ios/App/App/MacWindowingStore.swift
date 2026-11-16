import Foundation

/// Store scene identities and deferred deliveries, independent of UIKit/AppKit lifecycles.
final class MacStoreSceneState {
    private var titles: [String: String] = [:]
    private let windows = NSMapTable<NSString, NSObject>(keyOptions: .strongMemory, valueOptions: .weakMemory)
    private var readyMain: String?
    private var pending: [(String) -> Void] = []
    private(set) var failure: String?

    func prepare(_ scene: String, title: String) -> String {
        disconnect(scene)
        let unique = "\(title) \(UUID().uuidString)"
        titles[scene] = unique
        return unique
    }

    func resolve(_ scene: String, lookup: (String) -> NSObject?) -> NSObject? {
        if let window = windows.object(forKey: scene as NSString) { return window }
        guard let title = titles[scene], let window = lookup(title) else { return nil }
        windows.setObject(window, forKey: scene as NSString)
        return window
    }

    func contains(_ scene: String) -> Bool { titles[scene] != nil }

    func disconnect(_ scene: String) {
        windows.removeObject(forKey: scene as NSString)
        titles.removeValue(forKey: scene)
        if readyMain == scene { readyMain = nil }
    }

    func enqueue(_ delivery: @escaping (String) -> Void) {
        if let readyMain { delivery(readyMain) } else { pending.append(delivery) }
    }

    func mainReady(_ scene: String) {
        readyMain = scene
        let deliveries = pending
        pending.removeAll()
        deliveries.forEach { $0(scene) }
    }

    func reportFailure(_ message: String) { failure = message }
}

#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
import UIKit
import Capacitor
/// The Store app keeps UIKit scenes and delegates native Mac operations to a typed bundle.
/// Apple calls this Catalyst integration unsupported; Store validation and review remain gates.
enum MacWindowing {
    static let widgetSize = CGSize(width: 360, height: 460)
    private static let scenes = MacStoreSceneState()
    private static var restoreTitles: [String: () -> Void] = [:]
    private static var presentedFailure: String?

    private static let support: MindRoomMacSupportProtocol? = {
        guard let url = Bundle.main.builtInPlugInsURL?.appendingPathComponent("MindRoomMacSupport.bundle"),
              let bundle = Bundle(url: url), bundle.load(),
              let principal = bundle.principalClass as? NSObject.Type,
              let instance = principal.init() as? MindRoomMacSupportProtocol else {
            reportFailure("Quick Capture is unavailable. Restart MindRoom, and send diagnostics if the problem continues.")
            return nil
        }
        return instance
    }()

    static var lastFrontProcess: pid_t? {
        guard let pid = support?.lastFrontProcess, pid > 0 else { return nil }
        return pid
    }

    static func hostWindow(of window: UIWindow) -> NSObject? {
        guard let scene = window.windowScene else { return nil }
        let id = scene.session.persistentIdentifier
        guard let host = scenes.resolve(id, lookup: { support?.window(titled: $0) }) else { return nil }
        restoreTitles.removeValue(forKey: id)?()
        return host
    }

    static func prepare(_ scene: UIWindowScene, title: String) {
        let id = scene.session.persistentIdentifier
        let visibility = scene.titlebar?.titleVisibility
        scene.titlebar?.titleVisibility = .hidden
        scene.title = scenes.prepare(id, title: title)
        restoreTitles[id] = { [weak scene] in
            scene?.title = title
            if let visibility { scene?.titlebar?.titleVisibility = visibility }
        }
    }

    static func disconnect(_ scene: UIScene) {
        let id = scene.session.persistentIdentifier
        scenes.disconnect(id)
        restoreTitles.removeValue(forKey: id)
    }

    static func isPrepared(_ scene: UIScene) -> Bool {
        scenes.contains(scene.session.persistentIdentifier)
    }

    @discardableResult
    static func requireSupport() -> Bool {
        if support != nil { return true }
        presentFailure()
        return false
    }

    static func reportFailure(_ message: String) {
        scenes.reportFailure(message)
        NSLog("[QuickCapture] %@", message)
        DispatchQueue.main.async { presentFailure() }
    }

    static func presentFailure() {
        guard let message = scenes.failure, message != presentedFailure,
              let controller = QuickCapture.mainScene?.windows.first?.rootViewController,
              controller.viewIfLoaded?.window != nil, controller.presentedViewController == nil else { return }
        let alert = UIAlertController(title: "Quick Capture unavailable", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presentedFailure = message
        controller.present(alert, animated: true)
    }

    static func forwardLinks(_ urls: Set<UIOpenURLContext>, activities: Set<NSUserActivity>) {
        let external = activities.filter { $0.activityType != QuickCapture.activityType }
        guard !urls.isEmpty || !external.isEmpty else { return }
        scenes.enqueue { id in
            guard let main = QuickCapture.mainScene, main.session.persistentIdentifier == id,
                  let delegate = main.delegate as? SceneDelegate else { return }
            delegate.scene(main, openURLContexts: urls)
            external.forEach { delegate.scene(main, continue: $0) }
        }
        QuickCapture.showMainWindow()
    }

    static func mainBridgeDidAppear(_ scene: UIWindowScene) {
        scenes.mainReady(scene.session.persistentIdentifier)
        presentFailure()
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
            if support != nil {
                reportFailure("Control+Option+Space could not be registered. Another app may be using it. You can still open Quick Capture from the Window menu.")
            }
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
