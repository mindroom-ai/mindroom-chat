import Foundation
import MindRoomWatchKit
import WatchConnectivity

/// The watch's end of WatchConnectivity: takes credentials and sign-out from the iPhone, reports the new device.
final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    private let session: MatrixSession

    @MainActor
    init(session: MatrixSession) {
        self.session = session
        super.init()
        session.onSignedIn = { [weak self] userId, deviceId in
            self?.send(.signedIn(userId: userId, deviceId: deviceId))
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func send(_ message: WatchLinkMessage) {
        guard WCSession.default.activationState == .activated else { return }
        WCSession.default.transferUserInfo(message.dictionary)
    }

    private func receive(_ dictionary: [String: Any]) {
        guard let message = WatchLinkMessage(dictionary: dictionary) else { return }
        Task { @MainActor in
            switch message {
            case .credentials: await session.connect(message)
            case .signOut: await session.signOut()
            case .signedIn: break
            }
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        // Credentials sent while the app was not running arrive as user info once it activates.
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { receive(userInfo) }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { receive(message) }
}
