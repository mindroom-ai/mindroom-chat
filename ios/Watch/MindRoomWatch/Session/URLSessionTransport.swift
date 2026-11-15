import Foundation
import MatrixRustSDK
import MindRoomWatchKit

/// Sends the Matrix SDK's requests with URLSession. A watch gives an app no sockets, which the SDK's own HTTP
/// client needs, so its requests would never leave the watch (Apple TN3135, "Low-level networking on watchOS").
/// The simulator allows them: only a real watch shows the difference.
final class URLSessionTransport: HttpTransport, @unchecked Sendable {
    static let shared = URLSessionTransport()

    private let session: URLSession

    private init() {
        let configuration = URLSessionConfiguration.ephemeral
        // The SDK keeps what it needs in its own store and sets every header itself.
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        // Two syncs wait on the server at once, and over HTTP/1.1 each holds a connection of its own.
        configuration.httpMaximumConnectionsPerHost = 8
        configuration.httpAdditionalHeaders = ["User-Agent": "MindRoom Apple Watch"]
        session = URLSession(configuration: configuration)
    }

    func send(request: HttpTransportRequest) async -> HttpTransportResult {
        guard let url = RequestURL.make(request.url) else { return .failure(message: "not a URL") }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        if !request.body.isEmpty { urlRequest.httpBody = request.body }
        // The SDK gives up on a request that takes too long, which cancels it here; this is for one it forgot.
        urlRequest.timeoutInterval = 300
        do {
            let (body, response) = try await session.data(for: urlRequest)
            guard let response = response as? HTTPURLResponse else { return .failure(message: "not an HTTP response") }
            var headers: [String: String] = [:]
            for (name, value) in response.allHeaderFields {
                if let name = name as? String, let value = value as? String { headers[name] = value }
            }
            return .response(status: UInt16(response.statusCode), headers: headers, body: body)
        } catch {
            return .failure(message: error.localizedDescription)
        }
    }
}
