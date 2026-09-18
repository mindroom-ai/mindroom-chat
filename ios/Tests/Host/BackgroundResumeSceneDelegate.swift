import UIKit
import WebKit

/// Test host only: retain the shipping scene/bridge and expose process identities
/// to an external UI-test runner, which stays alive while this app is suspended.
final class BackgroundResumeSceneDelegate: SceneDelegate {
    override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        super.scene(scene, willConnectTo: session, options: connectionOptions)
        guard ProcessInfo.processInfo.environment["MINDROOM_BACKGROUND_PROBE"] == "1",
              let window,
              let controller = window.rootViewController as? MindRoomBridgeViewController,
              let webView = controller.webView else { return }

        window.overrideUserInterfaceStyle = ProcessInfo.processInfo.environment["MINDROOM_APPEARANCE"] == "dark" ? .dark : .light
        let probe = ProcessProbeLabel()
        probe.webView = webView
        probe.text = "Native process probe"
        probe.font = .systemFont(ofSize: 10)
        probe.accessibilityIdentifier = "native-process-probe"
        probe.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(probe)
        NSLayoutConstraint.activate([
            probe.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: 8),
            probe.bottomAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.bottomAnchor, constant: -8)
        ])
        webView.load(URLRequest(url: URL(string: "capacitor://localhost/?resumeProbe=\(UUID().uuidString)")!))
    }
}

private final class ProcessProbeLabel: UILabel {
    weak var webView: WKWebView?

    override var accessibilityValue: String? {
        get {
            let selector = NSSelectorFromString("_webProcessIdentifier")
            let webPID = webView?.responds(to: selector) == true
                ? (webView?.value(forKey: "_webProcessIdentifier") as? NSNumber)?.intValue ?? 0
                : 0
            return "\(ProcessInfo.processInfo.processIdentifier),\(webPID)"
        }
        set { }
    }
}
