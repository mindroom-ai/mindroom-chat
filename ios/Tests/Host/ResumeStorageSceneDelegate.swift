import UIKit
import WebKit

// Throwaway investigation host. Private process identifiers never enter App.
final class ResumeStorageSceneDelegate: SceneDelegate {
    override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        super.scene(scene, willConnectTo: session, options: connectionOptions)
        guard ProcessInfo.processInfo.environment["MINDROOM_STORAGE_PROBE"] == "1",
              let window,
              let controller = window.rootViewController as? MindRoomBridgeViewController,
              let webView = controller.webView else { return }
        let label = StorageProcessLabel()
        label.webView = webView
        label.text = "Storage process probe"
        label.accessibilityIdentifier = "storage-process-probe"
        label.translatesAutoresizingMaskIntoConstraints = false
        window.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: window.leadingAnchor, constant: 8),
            label.bottomAnchor.constraint(equalTo: window.safeAreaLayoutGuide.bottomAnchor, constant: -8)
        ])
        let route = ProcessInfo.processInfo.environment["MINDROOM_STORAGE_DOTTED"] == "1"
            ? "/home/!example%3Amindroom.chat?storageProbe=1&threadId=%24thread#reply"
            : "/?storageProbe=1"
        webView.load(URLRequest(url: URL(string: "capacitor://localhost\(route)")!))
    }
}

private final class StorageProcessLabel: UILabel {
    weak var webView: WKWebView?

    private func identifier(_ object: NSObject?, key: String) -> Int {
        guard let object, object.responds(to: NSSelectorFromString(key)) else { return 0 }
        return (object.value(forKey: key) as? NSNumber)?.intValue ?? 0
    }

    override var accessibilityValue: String? {
        get {
            let values = [
                Int(ProcessInfo.processInfo.processIdentifier),
                identifier(webView, key: "_webProcessIdentifier"),
                identifier(webView?.configuration.websiteDataStore, key: "_networkProcessIdentifier")
            ]
            return values.map(String.init).joined(separator: ",")
        }
        set { }
    }
}
