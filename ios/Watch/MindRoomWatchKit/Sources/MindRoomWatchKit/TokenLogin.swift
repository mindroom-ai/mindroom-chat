import Foundation

/// The session `/login` gives the watch for a login token.
public struct TokenLoginResult: Equatable, Sendable {
    public let accessToken: String
    public let deviceId: String
    public let userId: String
}

public enum TokenLoginError: Error, Equatable {
    /// The token was used, or ran out before the watch read it: connect again from the iPhone.
    case expired
    case failed(String)
}

/// The watch's own sign-in: `m.login.token` with the token the iPhone minted.
public enum TokenLoginRequest {
    public static let deviceDisplayName = "MindRoom Apple Watch"

    public static func make(homeserverUrl: URL, token: String) -> URLRequest {
        var request = URLRequest(url: homeserverUrl.appendingPathComponent("_matrix/client/v3/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "type": "m.login.token", "token": token, "initial_device_display_name": deviceDisplayName,
        ])
        return request
    }

    public static func parse(data: Data, status: Int) throws -> TokenLoginResult {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? JSON ?? [:]
        if status == 200, let accessToken = json["access_token"] as? String,
           let deviceId = json["device_id"] as? String, let userId = json["user_id"] as? String {
            return TokenLoginResult(accessToken: accessToken, deviceId: deviceId, userId: userId)
        }
        if status == 403 || json["errcode"] as? String == "M_FORBIDDEN" { throw TokenLoginError.expired }
        throw TokenLoginError.failed(json["error"] as? String ?? "HTTP \(status)")
    }

    /// Whether credentials ran out before the watch could use them.
    public static func isExpired(_ message: WatchLinkMessage, now: Date) -> Bool {
        if case let .credentials(_, _, _, expiresAt) = message { return expiresAt <= now }
        return false
    }
}
