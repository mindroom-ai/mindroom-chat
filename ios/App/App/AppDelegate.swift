import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        MindRoomDiagnosticsRecorder.shared.start(application: application)
#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE
        // Before any page exists, so a broken page cannot stop an update (MacUpdater.swift).
        MacUpdater.start()
#endif
#if targetEnvironment(macCatalyst)
        MacScreenshot.clearFolder()
        MacWindowing.installHotKey { QuickCapture.toggle() }
        MacWindowing.followFrontProcess()
        MacWindowing.monitorMouseButtons(QuickCapture.walkHistory)
        // The Dock, or a launch that restores only the widget, brings back a main window, once the
        // scenes UIKit restores have connected.
        NotificationCenter.default.addObserver(
            forName: Notification.Name("NSApplicationDidBecomeActiveNotification"), object: nil, queue: .main
        ) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { QuickCapture.showMainWindowUnlessWidgetIsKey() }
        }
#endif
        return true
    }

    func applicationDidReceiveMemoryWarning(_ application: UIApplication) {
        MindRoomDiagnosticsRecorder.shared.recordMemoryWarning(application: application)
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let widget = options.userActivities.contains { $0.activityType == QuickCapture.activityType }
        return UISceneConfiguration(
            name: widget ? QuickCapture.configurationName : "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
    }

#if targetEnvironment(macCatalyst)
    /// One main window: no "New Window". The Window menu opens Quick Capture, with its shortcut.
    /// Format › Font › Bigger and Smaller go: their ⌘+ and ⌘− would take the page's zoom keys.
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .main else { return }
        builder.remove(menu: .newScene)
        builder.remove(menu: .textSize)
        let quickCapture = UIKeyCommand(
            title: NSLocalizedString("QUICK_CAPTURE", comment: "The Quick Capture window"),
            action: #selector(toggleQuickCapture),
            input: " ",
            modifierFlags: [.control, .alternate]
        )
        builder.insertChild(UIMenu(options: .displayInline, children: [quickCapture]), atStartOfMenu: .window)
#if !MINDROOM_MAC_APP_STORE
        // Rebuilt when an update is staged or withdrawn (MacUpdater.start), so each title has its own action.
        let updates = MacUpdater.readyVersion == nil
            ? UICommand(title: NSLocalizedString("CHECK_FOR_UPDATES", comment: "App menu: look for a new version"),
                        action: #selector(checkForUpdates))
            : UICommand(title: NSLocalizedString("RESTART_TO_UPDATE", comment: "App menu: install the downloaded version"),
                        action: #selector(restartToUpdate))
        builder.insertSibling(UIMenu(options: .displayInline, children: [updates]), afterMenu: .about)
#endif
    }

    @objc func toggleQuickCapture() {
        QuickCapture.toggle()
    }
#endif

#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE
    /// Sparkle's check, with its windows. Never installs.
    @objc func checkForUpdates() {
        MacUpdater.checkForUpdates()
    }

    /// While a downloaded update waits Sparkle runs no check; this installs it, as the page's
    /// Reload does. Does nothing if the update was withdrawn.
    @objc func restartToUpdate() {
        guard MacUpdater.readyVersion != nil else { return }
        _ = MacUpdater.install()
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        switch action {
        case #selector(checkForUpdates): return MacUpdater.canCheckForUpdates
        case #selector(restartToUpdate): return MacUpdater.readyVersion != nil
        default: return super.canPerformAction(action, withSender: sender)
        }
    }
#endif

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
}
