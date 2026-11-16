import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // One main window: a second one closes as it connects, and the link it came with goes to
        // the app, which the main window shows.
        if UIApplication.shared.connectedScenes.contains(where: { $0 !== scene && $0.delegate is SceneDelegate }) {
#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
            MacWindowing.forwardLinks(connectionOptions.urlContexts, activities: connectionOptions.userActivities)
#else
            SceneDelegateProxy.shared.scene(scene, openURLContexts: connectionOptions.urlContexts)
            connectionOptions.userActivities.forEach { SceneDelegateProxy.shared.scene(scene, continue: $0) }
#endif
            UIApplication.shared.requestSceneSessionDestruction(session, options: nil)
#if targetEnvironment(macCatalyst)
            QuickCapture.showMainWindow()
#endif
            return
        }
#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
        MacWindowing.prepare(windowScene, title: "MindRoom")
#endif
        // The main window takes the links and notifications.
        windowScene.activationConditions.prefersToActivateForTargetContentIdentifierPredicate = NSPredicate(value: true)

        // Keep the custom bridge that registers authentication and file saving.
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MindRoomBridgeViewController()
        window?.makeKeyAndVisible()
#if targetEnvironment(macCatalyst)
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 400, height: 500)
#endif
#if targetEnvironment(macCatalyst) && MINDROOM_MAC_APP_STORE
        QuickCapture.whenHostWindow(of: windowScene) { _ in }
#endif

        // A Handoff from the watch waits in WatchHandoff until the plugin passes it to the web app.
        connectionOptions.userActivities.forEach { _ = WatchHandoff.receive($0) }
        // Capacitor defers cold-start links until the bridge plugins are ready.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // "Open on iPhone" from the Apple Watch app.
        if WatchHandoff.receive(userActivity) { return }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        MindRoomDiagnosticsRecorder.shared.recordScene(.sceneForeground, scene: scene)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        MindRoomDiagnosticsRecorder.shared.recordScene(.sceneActive, scene: scene)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        MindRoomDiagnosticsRecorder.shared.recordScene(.sceneInactive, scene: scene)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        MindRoomDiagnosticsRecorder.shared.recordScene(.sceneBackground, scene: scene)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
#if targetEnvironment(macCatalyst)
#if MINDROOM_MAC_APP_STORE
        MacWindowing.disconnect(scene)
#endif
        if let window {
            // The widget closes with the main window, so that the Dock opens the main window again.
            if let widget = QuickCapture.widgetScene {
                UIApplication.shared.requestSceneSessionDestruction(widget.session, options: nil)
            }
            // A closed window's page would live on unseen: its client syncing beside the next
            // window's, and serving the widget a room nobody sees. It stops, which tells the widget.
            QuickCapture.stopPage(of: window)
            self.window = nil
        }
#endif
        MindRoomDiagnosticsRecorder.shared.recordScene(.sceneDisconnected, scene: scene)
    }
}
