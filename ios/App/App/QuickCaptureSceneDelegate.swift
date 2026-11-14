import Capacitor
import UIKit
import WebKit

/// The Quick Capture widget's scene: on the Mac a small window, floating above other apps, that
/// shows the `/quick-capture/` page and hides and shows behind Control+Option+Space. Other
/// platforms never open it.
class QuickCaptureSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        windowScene.title = NSLocalizedString("QUICK_CAPTURE", comment: "The Quick Capture window")
        // Links and notifications go to the main window's scene, not to the widget's.
        windowScene.activationConditions.canActivateForTargetContentIdentifierPredicate = NSPredicate(value: false)
        windowScene.activationConditions.prefersToActivateForTargetContentIdentifierPredicate = NSPredicate(value: false)
        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = .clear
        window?.isOpaque = false
        window?.rootViewController = QuickCaptureViewController()
#if targetEnvironment(macCatalyst)
        windowScene.sizeRestrictions?.minimumSize = MacWindowing.widgetSize
        windowScene.sizeRestrictions?.maximumSize = MacWindowing.widgetSize
        windowScene.titlebar?.titleVisibility = .hidden
        windowScene.titlebar?.toolbar = nil
        // Opened by the shortcut it shows; restored at launch it waits, hidden, for the shortcut.
        let show = QuickCapture.opening
        QuickCapture.opening = false
        startsHidden = !show
        window?.makeKeyAndVisible()
        QuickCapture.whenHostWindow(of: windowScene) { [weak self] host in
            // Scaled to match iPad, a UIKit point is 0.77 of the Mac's: the window is sized in the
            // Mac's points, and the page scales its rem by as much, so its text is the size of
            // other apps' text.
            if let uiWindow = self?.window {
                let scale = MacWindowing.pointScale(of: host, showing: uiWindow)
                let points = { (length: CGFloat) in (length / scale * 2).rounded(.down) / 2 }
                let size = CGSize(width: points(MacWindowing.widgetSize.width), height: points(MacWindowing.widgetSize.height))
                windowScene.sizeRestrictions?.minimumSize = size
                windowScene.sizeRestrictions?.maximumSize = size
                (uiWindow.rootViewController as? QuickCaptureViewController)?.setPointScale(1 / scale)
            }
            MacWindowing.styleWidgetWindow(host)
            if show { MacWindowing.showWidget(host) }
        }
#endif
    }

    /// A link UIKit gives the widget anyway goes to the app, as the main window's would, and the
    /// main window comes forward with it.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
#if targetEnvironment(macCatalyst)
        QuickCapture.showMainWindow()
#endif
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
#if targetEnvironment(macCatalyst)
        QuickCapture.showMainWindow()
#endif
    }

#if targetEnvironment(macCatalyst)
    /// Whether the window hides as soon as UIKit has shown it: a widget restored at launch, until
    /// the shortcut shows it.
    var startsHidden = false

    /// UIKit sets its title bar again as the window changes size, as it does once it takes the
    /// widget's size: the widget's goes back on after UIKit's.
    func windowScene(
        _ windowScene: UIWindowScene,
        didUpdate previousCoordinateSpace: UICoordinateSpace,
        interfaceOrientation previousInterfaceOrientation: UIInterfaceOrientation,
        traitCollection previousTraitCollection: UITraitCollection
    ) {
        QuickCapture.whenHostWindow(of: windowScene) { host in
            DispatchQueue.main.async { MacWindowing.styleWidgetWindow(host) }
        }
    }

    /// UIKit sets its title bar again as the scene comes forward: the widget's goes back on top.
    func sceneDidBecomeActive(_ scene: UIScene) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let hide = startsHidden
        startsHidden = false
        QuickCapture.whenHostWindow(of: windowScene) { host in
            MacWindowing.styleWidgetWindow(host)
            if hide { MacWindowing.hideWidget(host) }
        }
    }
#endif
}

/// A bridge that starts at `/quick-capture/`, with a page that lets the window's material show.
class QuickCaptureViewController: MindRoomBridgeViewController {
    /// The main window's bridge answers notification taps: a second bridge would take them over.
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.handleApplicationNotifications = false
        return descriptor
    }

    override func viewDidLoad() {
#if targetEnvironment(macCatalyst)
        // Before the bridge's first load, which keeps the web view's opacity as it finds it.
        if let webView {
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear
            if #available(macCatalyst 15.0, *) { webView.underPageBackgroundColor = .clear }
            webView.scrollView.bounces = false
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.minimumZoomScale = 1
            webView.scrollView.maximumZoomScale = 1
            webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        }
#endif
        super.viewDidLoad()
        // The bridge started loading the app's root; the widget's page replaces it before it answers.
        guard let serverURL = bridge?.config.serverURL else { return }
        webView?.load(URLRequest(url: serverURL.appendingPathComponent("quick-capture/")))
    }

    /// Tells the page, now and after every load, how many CSS pixels make one of the Mac's points
    /// (`--mac-point-scale`, which the page's stylesheet scales its rem by).
    func setPointScale(_ scale: CGFloat) {
        let source = "document.documentElement.style.setProperty('--mac-point-scale', '\(scale)');"
        guard let webView else { return }
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        webView.evaluateJavaScript(source)
    }
}

/// Shows, hides and toggles the widget's window and the main window.
enum QuickCapture {
    static let activityType = "chat.mindroom.quick-capture"
    static let configurationName = "Quick Capture"

    static var widgetScene: UIWindowScene? {
        UIApplication.shared.connectedScenes.first { $0.delegate is QuickCaptureSceneDelegate } as? UIWindowScene
    }

    /// The main window's scene; not a second one, which closes as it connects.
    static var mainScene: UIWindowScene? {
        UIApplication.shared.connectedScenes.first { ($0.delegate as? SceneDelegate)?.window != nil } as? UIWindowScene
    }

#if targetEnvironment(macCatalyst)
    /// Calls `body` with the AppKit window of `scene` once UIKit made it, trying for a second.
    static func whenHostWindow(of scene: UIWindowScene, attempt: Int = 0, _ body: @escaping (NSObject) -> Void) {
        if let window = scene.windows.first, let host = MacWindowing.hostWindow(of: window) {
            body(host)
        } else if attempt < 20 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                whenHostWindow(of: scene, attempt: attempt + 1, body)
            }
        } else {
            NSLog("[QuickCapture] no AppKit window for the scene")
        }
    }

    private static var widgetHost: NSObject? {
        guard let window = widgetScene?.windows.first else { return nil }
        return MacWindowing.hostWindow(of: window)
    }

    /// The shortcut: opens the widget, hides it while it has the keyboard, else shows it.
    static func toggle() {
        // The app in front is noted as the widget shows, before it brings MindRoom forward; hiding
        // gives the keyboard back to that app.
        guard let host = widgetHost else {
            if widgetScene == nil {
                MacWindowing.rememberFrontProcess()
                openWidgetScene()
            }
            return
        }
        if MacWindowing.widgetIsKey(host) {
            MacWindowing.hideWidget(host)
        } else {
            MacWindowing.rememberFrontProcess()
            show(host)
        }
    }

    private static func show(_ host: NSObject) {
        (widgetScene?.delegate as? QuickCaptureSceneDelegate)?.startsHidden = false
        MacWindowing.showWidget(host)
        if let controller = widgetScene?.windows.first?.rootViewController as? CAPBridgeViewController {
            controller.webView?.becomeFirstResponder()
        }
    }

    /// Set while the shortcut opens the widget's scene, which then shows; a scene restored at
    /// launch hides.
    static var opening = false

    private static func openWidgetScene() {
        opening = true
        let activity = NSUserActivity(activityType: activityType)
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: activity, options: nil) { error in
            opening = false
            NSLog("[QuickCapture] the widget did not open: %@", error.localizedDescription)
        }
    }

    static func hide() {
        if let host = widgetHost { MacWindowing.hideWidget(host) }
    }

    /// The display the widget is on, for the screen screenshot.
    static var widgetDisplay: UInt32? {
        widgetHost.flatMap(MacWindowing.displayID(of:))
    }

    /// The main window, opened again when there is none, unless the app came forward for the
    /// widget.
    static func showMainWindowUnlessWidgetIsKey() {
        guard mainScene == nil else { return }
        if let host = widgetHost, MacWindowing.widgetIsKey(host) { return }
        showMainWindow()
    }

    /// The main window in front, opened again when it was closed.
    static func showMainWindow() {
        if let main = mainScene {
            whenHostWindow(of: main) { MacWindowing.showMainWindow($0) }
            return
        }
        // A closed main window's session; not a connected one, such as a second main scene that
        // is closing.
        let session = UIApplication.shared.openSessions.first {
            $0.configuration.delegateClass == SceneDelegate.self && $0.scene == nil
        }
        UIApplication.shared.requestSceneSessionActivation(session, userActivity: nil, options: nil) { error in
            NSLog("[QuickCapture] the main window did not open: %@", error.localizedDescription)
        }
    }
#endif
}
