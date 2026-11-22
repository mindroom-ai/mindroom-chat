import Foundation

public typealias NotificationHTTPTransport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

/// URLSession delegate that blocks redirects to any different origin so Bearer tokens never leak.
public final class SameOriginRedirectDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    public override init() {
        super.init()
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let originalURL = task.originalRequest?.url,
              let newURL = request.url,
              NotificationAvatarFetcher.hasSameOrigin(originalURL, newURL) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

/// Fetches sender avatars from a Matrix homeserver for iOS Communication Notifications.
public struct NotificationAvatarFetcher: Sendable {
    public static let defaultThumbnailSize = 128

    private static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 10
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        return URLSession(
            configuration: config,
            delegate: SameOriginRedirectDelegate(),
            delegateQueue: nil
        )
    }()

    public static let shared = NotificationAvatarFetcher()

    private static let pathSegmentAllowed = CharacterSet.alphanumerics
        .union(CharacterSet(charactersIn: "-._~"))
    private static let serverSegmentAllowed = CharacterSet.alphanumerics
        .union(CharacterSet(charactersIn: "-._~:"))

    private let allowInsecureLocalhost: Bool
    private let transport: NotificationHTTPTransport

    public init(
        allowInsecureLocalhost: Bool = false,
        transport: NotificationHTTPTransport? = nil
    ) {
        self.allowInsecureLocalhost = allowInsecureLocalhost
        self.transport = transport ?? { request in
            try await NotificationAvatarFetcher.defaultSession.data(for: request)
        }
    }

    public static func parseMxcUri(_ mxcUrl: String) -> (server: String, mediaId: String)? {
        guard mxcUrl.hasPrefix("mxc://") else { return nil }
        let remainder = mxcUrl.dropFirst("mxc://".count)
        let parts = remainder.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }

        let server = String(parts[0])
        let mediaId = String(parts[1])
        guard isValidMxcSegment(server, allowAtSign: false),
              isValidMxcSegment(mediaId, allowAtSign: false) else {
            return nil
        }
        return (server: server, mediaId: mediaId)
    }

    public static func hasSameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        guard let lhsScheme = lhs.scheme?.lowercased(),
              let rhsScheme = rhs.scheme?.lowercased(),
              lhsScheme == rhsScheme,
              let lhsHost = lhs.host?.lowercased(),
              let rhsHost = rhs.host?.lowercased(),
              lhsHost == rhsHost else {
            return false
        }
        let lhsPort = lhs.port ?? defaultPort(for: lhsScheme)
        let rhsPort = rhs.port ?? defaultPort(for: rhsScheme)
        return lhsPort == rhsPort
    }

    public func downloadThumbnail(
        homeserverUrl: String,
        accessToken: String,
        mxcUrl: String,
        size: Int = NotificationAvatarFetcher.defaultThumbnailSize
    ) async -> Data? {
        guard !accessToken.isEmpty,
              size > 0,
              let baseURL = validateHomeserverBaseURL(homeserverUrl),
              let parsed = Self.parseMxcUri(mxcUrl),
              let encodedServer = parsed.server.addingPercentEncoding(withAllowedCharacters: Self.serverSegmentAllowed),
              let encodedMediaId = parsed.mediaId.addingPercentEncoding(withAllowedCharacters: Self.pathSegmentAllowed),
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        let basePath = trimmedBasePath(components.percentEncodedPath)
        components.percentEncodedPath = "\(basePath)/_matrix/client/v1/media/thumbnail/\(encodedServer)/\(encodedMediaId)"
        components.queryItems = [
            URLQueryItem(name: "width", value: "\(size)"),
            URLQueryItem(name: "height", value: "\(size)"),
            URLQueryItem(name: "method", value: "crop"),
        ]

        guard let requestURL = components.url, Self.hasSameOrigin(baseURL, requestURL) else {
            return nil
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        guard let (data, response) = try? await transport(request),
              let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200,
              NotificationAvatarStore.isValidImageData(data) else {
            return nil
        }

        return data
    }

    public func fetchSenderAvatar(
        homeserverUrl: String,
        accessToken: String,
        sender: String
    ) async -> (mxcUrl: String, data: Data)? {
        guard !accessToken.isEmpty,
              !sender.isEmpty,
              let baseURL = validateHomeserverBaseURL(homeserverUrl),
              let encodedSender = sender.addingPercentEncoding(withAllowedCharacters: Self.pathSegmentAllowed),
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        let basePath = trimmedBasePath(components.percentEncodedPath)
        components.percentEncodedPath = "\(basePath)/_matrix/client/v3/profile/\(encodedSender)/avatar_url"
        components.query = nil

        guard let requestURL = components.url, Self.hasSameOrigin(baseURL, requestURL) else {
            return nil
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard let (data, response) = try? await transport(request),
              let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200,
              let decoded = try? JSONDecoder().decode(ProfileAvatarResponse.self, from: data),
              let mxcUrl = decoded.avatarUrl,
              !mxcUrl.isEmpty else {
            return nil
        }

        guard let thumbnail = await downloadThumbnail(
            homeserverUrl: homeserverUrl,
            accessToken: accessToken,
            mxcUrl: mxcUrl
        ) else {
            return nil
        }

        return (mxcUrl: mxcUrl, data: thumbnail)
    }

    private struct ProfileAvatarResponse: Decodable {
        let avatarUrl: String?

        private enum CodingKeys: String, CodingKey {
            case avatarUrl = "avatar_url"
        }
    }

    private func validateHomeserverBaseURL(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(),
              !host.isEmpty,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil else {
            return nil
        }

        if scheme == "https" {
            return url
        }
        if scheme == "http" && allowInsecureLocalhost && (host == "localhost" || host == "127.0.0.1") {
            return url
        }
        return nil
    }

    private func trimmedBasePath(_ path: String) -> String {
        var result = path
        while result.hasSuffix("/") {
            result.removeLast()
        }
        return result
    }

    private static func isValidMxcSegment(_ segment: String, allowAtSign: Bool) -> Bool {
        guard !segment.isEmpty,
              segment != ".",
              !segment.contains("/"),
              !segment.contains("\\"),
              !segment.contains(".."),
              !segment.contains("?"),
              !segment.contains("#"),
              !segment.contains("%") else {
            return false
        }
        if !allowAtSign && segment.contains("@") {
            return false
        }
        return !segment.unicodeScalars.contains { scalar in
            CharacterSet.whitespacesAndNewlines.contains(scalar)
                || CharacterSet.controlCharacters.contains(scalar)
        }
    }

    private static func defaultPort(for scheme: String) -> Int? {
        switch scheme {
        case "https": return 443
        case "http": return 80
        default: return nil
        }
    }
}
