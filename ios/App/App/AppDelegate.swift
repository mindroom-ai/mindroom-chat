import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        MindRoomDiagnosticsRecorder.shared.start(application: application)
#if targetEnvironment(macCatalyst)
        MacScreenshot.clearFolder()
        MacWindowing.installHotKey { QuickCapture.toggle() }
        MacWindowing.followFrontProcess()
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
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .main else { return }
        builder.remove(menu: .newScene)
        let quickCapture = UIKeyCommand(
            title: NSLocalizedString("QUICK_CAPTURE", comment: "The Quick Capture window"),
            action: #selector(toggleQuickCapture),
            input: " ",
            modifierFlags: [.control, .alternate]
        )
        builder.insertChild(UIMenu(options: .displayInline, children: [quickCapture]), atStartOfMenu: .window)
    }

    @objc func toggleQuickCapture() {
        QuickCapture.toggle()
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
