import Foundation

/// The messages between the iPhone app and the watch over WatchConnectivity (version 1).
public enum WatchLinkMessage: Equatable, Sendable {
    /// A one-time login token for the watch's own device.
    case credentials(homeserverUrl: URL, userId: String, loginToken: String, expiresAt: Date)
    /// The watch signed in as this device.
    case signedIn(userId: String, deviceId: String)
    /// Sign the watch out.
    case signOut

    public init?(dictionary: [String: Any]) {
        guard (dictionary["v"] as? NSNumber)?.intValue == 1 else { return nil }
        switch dictionary["kind"] as? String {
        case "credentials":
            guard let urlText = dictionary["homeserverUrl"] as? String,
                  let url = URL(string: urlText), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil,
                  let userId = dictionary["userId"] as? String, Self.isUserId(userId),
                  let token = dictionary["loginToken"] as? String, !token.isEmpty,
                  let expiresMs = (dictionary["expiresAt"] as? NSNumber)?.doubleValue else { return nil }
            self = .credentials(homeserverUrl: url, userId: userId, loginToken: token,
                                expiresAt: Date(timeIntervalSince1970: expiresMs / 1000))
        case "signedIn":
            guard let userId = dictionary["userId"] as? String, Self.isUserId(userId),
                  let deviceId = dictionary["deviceId"] as? String, !deviceId.isEmpty else { return nil }
            self = .signedIn(userId: userId, deviceId: deviceId)
        case "signOut":
            self = .signOut
        default:
            return nil
        }
    }

    public var dictionary: [String: Any] {
        switch self {
        case let .credentials(url, userId, token, expiresAt):
            return ["v": 1, "kind": "credentials", "homeserverUrl": url.absoluteString, "userId": userId,
                    "loginToken": token, "expiresAt": expiresAt.timeIntervalSince1970 * 1000]
        case let .signedIn(userId, deviceId):
            return ["v": 1, "kind": "signedIn", "userId": userId, "deviceId": deviceId]
        case .signOut:
            return ["v": 1, "kind": "signOut"]
        }
    }

    private static func isUserId(_ value: String) -> Bool {
        value.hasPrefix("@") && value.dropFirst().contains(":") && !value.contains(" ")
    }
}
