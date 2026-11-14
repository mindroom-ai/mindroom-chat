import Capacitor
import Foundation
// The Mac has no Apple Watch app to talk to.
#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
import WatchConnectivity
#endif

/// The Apple Watch app's iPhone side (`src/app/native/nativeWatch.ts`): WatchConnectivity to hand
/// the watch its login and take back the device it signed in as, and the threads the watch hands
/// off (Handoff activity `chat.mindroom.open-thread`).
@objc(MindRoomWatchPlugin)
public class MindRoomWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomWatchPlugin"
    public let jsName = "MindRoomWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendCredentials", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]

    /// The device the watch last reported, kept until Disconnect.
    static let deviceKey = "mindroom.watch.device"

    private var handoffObserver: NSObjectProtocol?

    override public func load() {
        WatchLink.shared.onSignedIn = { [weak self] device in
            self?.notifyListeners("watchSignedIn", data: device, retainUntilConsumed: true)
        }
        WatchLink.shared.activate()
        handoffObserver = NotificationCenter.default.addObserver(
            forName: WatchHandoff.notification, object: nil, queue: .main
        ) { [weak self] _ in self?.deliverHandoff() }
        deliverHandoff()
    }

    deinit {
        if let handoffObserver { NotificationCenter.default.removeObserver(handoffObserver) }
    }

    private func deliverHandoff() {
        guard let thread = WatchHandoff.takePending() else { return }
        notifyListeners("openThread", data: thread, retainUntilConsumed: true)
    }

    @objc func status(_ call: CAPPluginCall) {
        var result = WatchLink.shared.status()
        if let device = UserDefaults.standard.dictionary(forKey: Self.deviceKey) { result["device"] = device }
        call.resolve(result)
    }

    @objc func sendCredentials(_ call: CAPPluginCall) {
        guard call.getInt("v") == 1, call.getString("kind") == "credentials",
              let homeserverUrl = call.getString("homeserverUrl"), let userId = call.getString("userId"),
              let loginToken = call.getString("loginToken"), let expiresAt = call.getDouble("expiresAt") else {
            return call.reject("Not a credentials message", "INVALID")
        }
        let message: [String: Any] = [
            "v": 1, "kind": "credentials", "homeserverUrl": homeserverUrl, "userId": userId,
            "loginToken": loginToken, "expiresAt": expiresAt,
        ]
        guard WatchLink.shared.send(message) else { return call.reject("No Apple Watch app to send to", "NO_WATCH") }
        call.resolve()
    }

    @objc func signOut(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: Self.deviceKey)
        _ = WatchLink.shared.send(["v": 1, "kind": "signOut"])
        call.resolve()
    }
}

/// Threads the watch hands off; kept until the plugin can pass them to the web app.
enum WatchHandoff {
    static let activityType = "chat.mindroom.open-thread"
    static let notification = Notification.Name("MindRoomWatchHandoff")
    private static var pending: [String: String]?

    /// Takes a Handoff from the watch; false for any other activity.
    static func receive(_ activity: NSUserActivity) -> Bool {
        guard activity.activityType == activityType,
              let roomId = activity.userInfo?["roomId"] as? String,
              let threadId = activity.userInfo?["threadId"] as? String else { return false }
        pending = ["roomId": roomId, "threadId": threadId]
        NotificationCenter.default.post(name: notification, object: nil)
        return true
    }

    static func takePending() -> [String: String]? {
        defer { pending = nil }
        return pending
    }
}

/// The iPhone's end of WatchConnectivity.
final class WatchLink: NSObject {
    static let shared = WatchLink()
    var onSignedIn: (([String: Any]) -> Void)?

    func activate() {
#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
        guard WCSession.isSupported(), WCSession.default.delegate == nil else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
#endif
    }

    func status() -> [String: Any] {
#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
        guard WCSession.isSupported() else { return ["paired": false, "installed": false, "reachable": false] }
        let session = WCSession.default
        return ["paired": session.isPaired, "installed": session.isWatchAppInstalled, "reachable": session.isReachable]
#else
        return ["paired": false, "installed": false, "reachable": false]
#endif
    }

    /// Queues the message for the watch app (and sends it at once when the app runs); false without one.
    func send(_ message: [String: Any]) -> Bool {
#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated, session.isWatchAppInstalled else { return false }
        session.transferUserInfo(message)
        if session.isReachable { session.sendMessage(message, replyHandler: nil, errorHandler: nil) }
        return true
#else
        return false
#endif
    }

    fileprivate func receive(_ message: [String: Any]) {
        guard (message["v"] as? NSNumber)?.intValue == 1, message["kind"] as? String == "signedIn",
              let userId = message["userId"] as? String, let deviceId = message["deviceId"] as? String else { return }
        let device = ["userId": userId, "deviceId": deviceId]
        UserDefaults.standard.set(device, forKey: MindRoomWatchPlugin.deviceKey)
        DispatchQueue.main.async { self.onSignedIn?(device) }
    }
}

#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
extension WatchLink: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { receive(userInfo) }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { receive(message) }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // A new watch was paired: activate for it.
        WCSession.default.activate()
    }
}
#endif
