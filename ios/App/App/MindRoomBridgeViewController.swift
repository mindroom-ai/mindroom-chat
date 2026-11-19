import Capacitor
import WebKit

@objc(MindRoomBridgeViewController)
class MindRoomBridgeViewController: CAPBridgeViewController {
#if DEBUG
    private var didStartFileSaveAcceptanceFixture = false
#endif
#if targetEnvironment(macCatalyst)
    private var filePromiseDropNamer: FilePromiseDropNamer?
    private var pageLoadObservation: NSKeyValueObservation?
#endif

    override func router() -> Router {
        MindRoomRouter()
    }

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        var plugins = descriptor.pluginConfigurations as? [String: Any] ?? [:]
        var statusBar = plugins["StatusBar"] as? [String: Any] ?? [:]
        // iOS uses the web safe area for both the app and its modal backdrops.
        // Keep this in native config so viewDidAppear cannot restore a separate strip.
        statusBar["overlaysWebView"] = true
        plugins["StatusBar"] = statusBar
        descriptor.pluginConfigurations = plugins
        return descriptor
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // The Mac build gets a Mac user agent and desktop layout instead of the
        // mobile content mode from capacitor.config.ts. A compile-time check, because
        // isMacCatalystApp is also true for the App Store iPad app on Apple silicon Macs.
#if targetEnvironment(macCatalyst)
        configuration.defaultWebpagePreferences.preferredContentMode = .desktop
#endif
        return configuration
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MindRoomAuthPlugin())
        bridge?.registerPluginInstance(MindRoomFileSavePlugin())
        bridge?.registerPluginInstance(MindRoomDiagnosticsPlugin())
        bridge?.registerPluginInstance(MindRoomQuickCapturePlugin())
#if targetEnvironment(macCatalyst)
        // Mac Catalyst's WebKit has no media capture. Only the main window records voice.
        if !(self is QuickCaptureViewController) {
            bridge?.registerPluginInstance(MindRoomVoiceRecorderPlugin())
        }
#endif
#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE
        // The main window shows the update card; the Quick Capture window does not.
        if !(self is QuickCaptureViewController) { bridge?.registerPluginInstance(MindRoomUpdatePlugin()) }
#endif
#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
        // Only the main bridge consumes Watch Handoff; the widget must not take its pending event.
        if self is QuickCaptureViewController { return }
#endif
        bridge?.registerPluginInstance(MindRoomWatchPlugin())
    }

    override func viewDidAppear(_ animated: Bool) {
        let activeStatusBarStyle = statusBarStyle
        super.viewDidAppear(animated)
        // The plugin queues its configured startup style on every appearance.
        // Restore the web theme's current style after that queued update.
        if activeStatusBarStyle != .default {
            bridge?.statusBarStyle = activeStatusBarStyle
        }
#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
        if let scene = view.window?.windowScene, scene.delegate is SceneDelegate {
            MacWindowing.mainBridgeDidAppear(scene)
        }
#endif
#if targetEnvironment(macCatalyst)
        // The web view has its drop interaction once it is in a window. WebKit adds its own again
        // as it restarts the page's process after a crash, and the page then loads anew.
        if pageLoadObservation == nil {
            pageLoadObservation = webView?.observe(\.isLoading, options: .initial) { [weak self] webView, _ in
                MainActor.assumeIsolated {
                    if let namer = FilePromiseDropNamer.install(in: webView) { self?.filePromiseDropNamer = namer }
                }
            }
        }
#endif

#if DEBUG
        guard ProcessInfo.processInfo.environment["MINDROOM_FILE_SAVE_ACCEPTANCE"] == "1",
              !didStartFileSaveAcceptanceFixture else {
            return
        }
        didStartFileSaveAcceptanceFixture = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            let script = """
            void (async () => {
              const pageId = `ios-export-acceptance-${Date.now()}`;
              const session = await window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'beginSave',
                { pageId, fileName: 'mindroom-export-acceptance.txt' }
              );
              await window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'appendSave',
                { id: session.id, data: 'bWluZHJvb20taW9zLWV4cG9ydC1hY2NlcHRhbmNlLXYxCg==' }
              );
              return window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'presentSave',
                { id: session.id }
              );
            })();
            null;
            """
            self?.webView?.evaluateJavaScript(script) { _, error in
                if let error {
                    NSLog("MindRoom file-save acceptance fixture failed: %@", error.localizedDescription)
                }
            }
        }
#endif
    }
}

/// Mac Catalyst's WebKit hands a page a dropped file only when its item provider has a suggested
/// name (`canBeRepresentedAsFileUpload` in WebKit's WebItemProviderPasteboard.mm). A file promise
/// has none: the floating thumbnail of a screen recording or a screenshot, a picture dragged out of
/// Photos. The page then gets a drop that holds no file. This stands in for the web view's own drop
/// delegate and gives each promise the file name its source proposes, just before WebKit reads the
/// drop. Only the Mac app installs it.
final class FilePromiseDropNamer: NSObject, UIDropInteractionDelegate {
    /// AppKit's drag pasteboard (`NSPasteboard.Name.drag`), which holds the name a promise proposes.
    static let dragPasteboard = UIPasteboard.Name("Apple CFPasteboard drag")
    static let promiseType = "com.apple.pasteboard.promised-file-url"
    static let proposedNameType = "com.apple.pasteboard.promised-suggested-file-name"

    private weak var webKit: UIDropInteractionDelegate?

    init(standingInFor webKit: UIDropInteractionDelegate) {
        self.webKit = webKit
    }

    /// Replaces the drop interaction of the web view's content with one that names promises first.
    /// Returns the namer to keep, or nil when the content has no drop interaction of WebKit's (none
    /// yet, or a namer stands in for it already).
    static func install(in webView: WKWebView) -> FilePromiseDropNamer? {
        for view in webView.scrollView.subviews {
            let drops = view.interactions.compactMap { $0 as? UIDropInteraction }
            guard let delegate = drops.lazy.compactMap({ $0.delegate }).first(where: { !($0 is FilePromiseDropNamer) })
            else { continue }
            // One drop interaction: UIKit gives a drop to one of them, and a namer of before stays
            // on the view when WebKit adds its own again.
            drops.forEach(view.removeInteraction)
            let namer = FilePromiseDropNamer(standingInFor: delegate)
            view.addInteraction(UIDropInteraction(delegate: namer))
            return namer
        }
        return nil
    }

    // Every other call of the delegate goes to WebKit as it is.
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || webKit?.responds(to: selector) == true
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        webKit
    }

    func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
        let board = UIPasteboard(name: Self.dragPasteboard, create: false)
        for (index, item) in session.items.enumerated() {
            let provider = item.itemProvider
            guard (provider.suggestedName ?? "").isEmpty,
                  provider.registeredTypeIdentifiers.contains(Self.promiseType) else { continue }
            let proposed = board?
                .data(forPasteboardType: Self.proposedNameType, inItemSet: IndexSet(integer: index))?
                .first.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            // WebKit adds the file's extension to a name that lacks it.
            provider.suggestedName = proposed.isEmpty ? "File" : proposed
        }
        webKit?.dropInteraction?(interaction, performDrop: session)
    }
}

private struct MindRoomRouter: Router {
    private var bundleRouter = CapacitorRouter()

    var basePath: String {
        get { bundleRouter.basePath }
        set { bundleRouter.basePath = newValue }
    }

    func route(for path: String) -> String {
        let firstComponent = path.split(separator: "/").first ?? ""
        // BrowserRouter parameters include Matrix IDs/aliases and server names.
        // Their dots are part of a route, even when WebKit reloads after a crash.
        // Native CI checks these against routes generated from pages/paths.ts.
        let routeRoots: Set<Substring> = [
            "home", "direct", "explore", "threads", "activity", "quick-capture", "login", "register", "reset-password"
        ]
        if routeRoots.contains(firstComponent) || firstComponent.hasPrefix("!") || firstComponent.hasPrefix("#") {
            return bundleRouter.route(for: "/")
        }
        return bundleRouter.route(for: path)
    }
}
