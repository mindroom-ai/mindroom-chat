import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // One main window: a second one closes as it connects.
        if UIApplication.shared.connectedScenes.contains(where: { $0 !== scene && $0.delegate is SceneDelegate }) {
            UIApplication.shared.requestSceneSessionDestruction(session, options: nil)
            return
        }

        // Keep the custom bridge that registers authentication and file saving.
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MindRoomBridgeViewController()
        window?.makeKeyAndVisible()
#if targetEnvironment(macCatalyst)
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 400, height: 500)
#endif

        // Capacitor defers cold-start links until the bridge plugins are ready.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
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
        // The widget closes with the main window, so that the Dock opens the main window again.
        if window != nil, let widget = QuickCapture.widgetScene {
            UIApplication.shared.requestSceneSessionDestruction(widget.session, options: nil)
        }
#endif
        MindRoomDiagnosticsRecorder.shared.recordScene(.sceneDisconnected, scene: scene)
    }
}
