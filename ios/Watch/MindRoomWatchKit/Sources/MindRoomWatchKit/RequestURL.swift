import Foundation

/// The URL of a request the Matrix SDK made, for URLSession.
public enum RequestURL {
    /// What a URL may hold after its host (RFC 3986), "%" for what is escaped already.
    private static let allowed = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#@!$&'()*+,;=%")

    /// The SDK leaves a character in a path that a URL does not allow ("[" in a state key that is JSON).
    /// `URL(string:)` then escapes the whole string again, its "%" included, which names another resource:
    /// only those characters are escaped here, and only after the host, where "[" may stand (IPv6).
    public static func make(_ string: String) -> URL? {
        guard let scheme = string.range(of: "://") else { return nil }
        let path = string[scheme.upperBound...].firstIndex(of: "/") ?? string.endIndex
        guard let escaped = string[path...].addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: string[..<path] + escaped)
    }
}
