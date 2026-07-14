import AuthenticationServices
import Capacitor
import CryptoKit
import Security
import Sodium
import UIKit
import WebKit

private let cloudflareAccessLoginPath = "/cdn-cgi/access/login"
private let cloudflareAccessAuthorizedPath = "/cdn-cgi/access/authorized"
private let cloudflareAccessCookieName = "CF_Authorization"
private let cloudflareAppSessionCookieName = "CF_AppSession"
private let cloudflareTokenSkew: TimeInterval = 60

private struct CloudflareAccessFailure: LocalizedError {
    let code: String
    let message: String

    var errorDescription: String? { message }
}

private struct CloudflareAccessAppInfo: Sendable {
    let authDomain: String
    let audience: String
    let appDomain: String
}

private struct CloudflareAccessToken: Sendable {
    let value: String
    let expiresAt: Date
}

private struct CloudflareAccessTransferContext: Sendable {
    let appInfo: CloudflareAccessAppInfo
    let appURL: URL
    let browserURL: URL
    let pollingURL: URL
    let secretKey: [UInt8]
}

private enum CloudflareAccessPreparation: Sendable {
    case unprotected
    case token(CloudflareAccessToken)
    case interactive(CloudflareAccessTransferContext)
}

private struct CloudflareAccessTransferResponse: Decodable {
    let appToken: String
    let orgToken: String

    private enum CodingKeys: String, CodingKey {
        case appToken = "app_token"
        case orgToken = "org_token"
    }
}

private struct CloudflareJWTPayload {
    let audiences: [String]
    let expiresAt: Date
}

private func cloudflareMatrixScopePath(_ url: URL) -> String? {
    guard url.scheme?.lowercased() == "https",
          url.host != nil,
          let matrixRange = url.path.range(of: "/_matrix/") else {
        return nil
    }
    return String(url.path[..<matrixRange.lowerBound]) + "/_matrix"
}

private func cloudflareMatrixProbeURL(_ url: URL) -> URL? {
    guard let scopePath = cloudflareMatrixScopePath(url) else {
        return nil
    }
    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    components?.path = scopePath + "/client/versions"
    components?.query = nil
    components?.fragment = nil
    return components?.url
}

private func isCloudflareAuthenticationHost(_ host: String) -> Bool {
    let normalized = host.lowercased()
    return normalized.hasSuffix(".cloudflareaccess.com") ||
        normalized == "login.cloudflareaccess.org"
}

private func cloudflareSecureOrigin(_ url: URL) -> String? {
    guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased() else {
        return nil
    }
    return "https://\(host):\(url.port ?? 443)"
}

private func cloudflareAppDomainMatches(_ appDomain: String, appURL: URL) -> Bool {
    guard let expectedScopePath = cloudflareMatrixScopePath(appURL) else { return false }
    let rawDomain = appDomain.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !rawDomain.isEmpty else { return false }
    let domainURLString = rawDomain.contains("://") ? rawDomain : "https://\(rawDomain)"
    guard let components = URLComponents(string: domainURLString),
          components.scheme?.lowercased() == "https",
          components.user == nil,
          components.password == nil,
          components.query == nil,
          components.fragment == nil,
          !components.percentEncodedPath.contains("%"),
          let domainURL = components.url,
          cloudflareSecureOrigin(domainURL) == cloudflareSecureOrigin(appURL) else {
        return false
    }

    guard domainURL.path.hasPrefix(expectedScopePath) else {
        return false
    }
    let suffix = String(domainURL.path.dropFirst(expectedScopePath.count))
    guard ["", "/", "*", "/*"].contains(suffix) else {
        return false
    }
    return true
}

private func isCloudflareAccessPath(_ path: String, endpoint: String) -> Bool {
    path == endpoint || path.hasPrefix("\(endpoint)/")
}

private final class CloudflareAccessKeychain {
    private let service = "\(Bundle.main.bundleIdentifier ?? "app.mindroom.chat").cloudflare-access"

    func read(_ account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw CloudflareAccessFailure(
                code: "ACCESS_KEYCHAIN_FAILED",
                message: "Unable to read organization authentication from Keychain"
            )
        }
        return value
    }

    func write(_ value: String, account: String) throws {
        try delete(account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(value.utf8),
        ]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            throw CloudflareAccessFailure(
                code: "ACCESS_KEYCHAIN_FAILED",
                message: "Unable to save organization authentication in Keychain"
            )
        }
    }

    func delete(_ account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CloudflareAccessFailure(
                code: "ACCESS_KEYCHAIN_FAILED",
                message: "Unable to clear organization authentication from Keychain"
            )
        }
    }
}

private final class CloudflareAccessDiscoveryDelegate: NSObject, URLSessionTaskDelegate {
    private let appOrigin: String
    private(set) var rejectedRedirect = false

    init(appURL: URL) {
        self.appOrigin = cloudflareSecureOrigin(appURL) ?? ""
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        if let path = response.url?.path,
           isCloudflareAccessPath(path, endpoint: cloudflareAccessLoginPath) {
            completionHandler(nil)
            return
        }
        guard let url = request.url,
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              cloudflareSecureOrigin(url) == appOrigin ||
                (url.port == nil && isCloudflareAuthenticationHost(host)) else {
            rejectedRedirect = true
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

private final class CloudflareOrgTokenExchangeDelegate: NSObject, URLSessionTaskDelegate {
    private let orgToken: String
    private let authOrigin: String
    private let appOrigin: String
    private(set) var appToken: String?
    private(set) var rejectedRedirect = false
    private var appSessionCookie: String?

    init(orgToken: String, authDomain: String, appURL: URL) {
        self.orgToken = orgToken
        self.authOrigin = "https://\(authDomain.lowercased()):443"
        self.appOrigin = cloudflareSecureOrigin(appURL) ?? ""
    }

    func captureCookies(from response: HTTPURLResponse) {
        guard let url = response.url,
              url.scheme?.lowercased() == "https",
              let origin = cloudflareSecureOrigin(url) else { return }
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            guard let key = item.key as? String else { return }
            result[key] = String(describing: item.value)
        }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: url) {
            if cookie.name == cloudflareAppSessionCookieName &&
                (origin == authOrigin || origin == appOrigin) {
                appSessionCookie = cookie.value
            } else if cookie.name == cloudflareAccessCookieName &&
                        origin == appOrigin &&
                        isCloudflareAccessPath(
                            url.path,
                            endpoint: cloudflareAccessAuthorizedPath
                        ) {
                appToken = cookie.value
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        captureCookies(from: response)
        if let path = response.url?.path,
           isCloudflareAccessPath(path, endpoint: cloudflareAccessAuthorizedPath) {
            completionHandler(nil)
            return
        }

        guard let url = request.url,
              url.scheme?.lowercased() == "https",
              let origin = cloudflareSecureOrigin(url),
              origin == authOrigin || origin == appOrigin else {
            rejectedRedirect = true
            completionHandler(nil)
            return
        }
        var redirectedRequest = request
        if isCloudflareAccessPath(url.path, endpoint: cloudflareAccessLoginPath) {
            guard origin == authOrigin else {
                rejectedRedirect = true
                completionHandler(nil)
                return
            }
            redirectedRequest.setValue(
                "\(cloudflareAccessCookieName)=\(orgToken)",
                forHTTPHeaderField: "Cookie"
            )
        } else if isCloudflareAccessPath(url.path, endpoint: cloudflareAccessAuthorizedPath),
                  let appSessionCookie {
            guard origin == appOrigin else {
                rejectedRedirect = true
                completionHandler(nil)
                return
            }
            redirectedRequest.setValue(
                "\(cloudflareAppSessionCookieName)=\(appSessionCookie)",
                forHTTPHeaderField: "Cookie"
            )
        }
        completionHandler(redirectedRequest)
    }
}

private final class CloudflareNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    private(set) var rejectedRedirect = false

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        rejectedRedirect = true
        completionHandler(nil)
    }
}

private actor CloudflareAccessManager {
    private let keychain = CloudflareAccessKeychain()
    private let sodium = Sodium()

    func prepare(appURL: URL, forceRefresh: Bool) async throws -> CloudflareAccessPreparation {
        guard let appInfo = try await discoverAppInfo(appURL) else {
            return .unprotected
        }

        let appAccount = appTokenAccount(appURL: appURL, appInfo: appInfo)
        let orgAccount = keychainAccount(kind: "org", value: appInfo.authDomain)

        if forceRefresh {
            try keychain.delete(appAccount)
            await removeAccessCookie(for: appURL)
        } else if let appTokenValue = try keychain.read(appAccount),
                  let appToken = usableToken(appTokenValue, audience: appInfo.audience) {
            do {
                try await validateMatrixToken(appToken, appURL: appURL)
                await installAccessCookie(appToken, for: appURL)
                return .token(appToken)
            } catch let failure as CloudflareAccessFailure
                where failure.code == "ACCESS_TOKEN_VALIDATION_UNAVAILABLE" {
                try Task.checkCancellation()
                throw failure
            } catch {
                try Task.checkCancellation()
                try keychain.delete(appAccount)
                await removeAccessCookie(for: appURL)
            }
        } else {
            try keychain.delete(appAccount)
        }

        if let orgTokenValue = try keychain.read(orgAccount),
           usableToken(orgTokenValue, audience: nil) != nil {
            do {
                let appToken = try await exchangeOrgToken(
                    orgTokenValue,
                    appURL: appURL,
                    authDomain: appInfo.authDomain,
                    audience: appInfo.audience
                )
                try await validateMatrixToken(appToken, appURL: appURL)
                try keychain.write(appToken.value, account: appAccount)
                await installAccessCookie(appToken, for: appURL)
                return .token(appToken)
            } catch let failure as CloudflareAccessFailure
                where failure.code == "ACCESS_TOKEN_VALIDATION_UNAVAILABLE" {
                try Task.checkCancellation()
                try keychain.delete(appAccount)
                await removeAccessCookie(for: appURL)
                throw failure
            } catch {
                try Task.checkCancellation()
                try keychain.delete(orgAccount)
                try keychain.delete(appAccount)
                await removeAccessCookie(for: appURL)
            }
        } else {
            try keychain.delete(orgAccount)
        }

        return .interactive(try makeTransferContext(appURL: appURL, appInfo: appInfo))
    }

    func completeTransfer(_ context: CloudflareAccessTransferContext) async throws -> CloudflareAccessToken {
        let encryptedResponse = try await pollTransfer(context.pollingURL)
        guard let encryptedData = Data(base64Encoded: encryptedResponse.data),
              let servicePublicKey = decodeURLBase64(encryptedResponse.servicePublicKey),
              let clearBytes = sodium.box.open(
                  nonceAndAuthenticatedCipherText: [UInt8](encryptedData),
                  senderPublicKey: [UInt8](servicePublicKey),
                  recipientSecretKey: context.secretKey
              ) else {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_TRANSFER_FAILED",
                message: "Organization authentication response could not be decrypted"
            )
        }

        let response: CloudflareAccessTransferResponse
        do {
            response = try JSONDecoder().decode(
                CloudflareAccessTransferResponse.self,
                from: Data(clearBytes)
            )
        } catch {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_TRANSFER_FAILED",
                message: "Organization authentication returned an invalid response"
            )
        }

        guard let appToken = usableToken(response.appToken, audience: context.appInfo.audience) else {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_TRANSFER_FAILED",
                message: "Organization authentication returned an invalid application token"
            )
        }

        let appAccount = appTokenAccount(appURL: context.appURL, appInfo: context.appInfo)
        try await validateMatrixToken(appToken, appURL: context.appURL)
        try keychain.write(appToken.value, account: appAccount)

        if usableToken(response.orgToken, audience: nil) != nil {
            let orgAccount = keychainAccount(kind: "org", value: context.appInfo.authDomain)
            try keychain.write(response.orgToken, account: orgAccount)
        }

        await installAccessCookie(appToken, for: context.appURL)
        return appToken
    }

    private func discoverAppInfo(_ appURL: URL) async throws -> CloudflareAccessAppInfo? {
        guard appURL.host != nil else {
            throw CloudflareAccessFailure(code: "INVALID_URL", message: "Matrix URL is invalid")
        }
        let delegate = CloudflareAccessDiscoveryDelegate(appURL: appURL)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 15
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        var request = URLRequest(url: appURL)
        request.httpMethod = "HEAD"
        request.setValue("cloudflared/ios", forHTTPHeaderField: "User-Agent")

        let response: HTTPURLResponse
        do {
            let (_, rawResponse) = try await session.data(for: request)
            guard let httpResponse = rawResponse as? HTTPURLResponse else {
                throw CloudflareAccessFailure(
                    code: "ACCESS_DISCOVERY_FAILED",
                    message: "Unable to inspect organization access policy"
                )
            }
            response = httpResponse
        } catch let failure as CloudflareAccessFailure {
            throw failure
        } catch {
            throw CloudflareAccessFailure(
                code: "ACCESS_DISCOVERY_FAILED",
                message: "Unable to inspect organization access policy"
            )
        }

        if delegate.rejectedRedirect {
            throw CloudflareAccessFailure(
                code: "ACCESS_DISCOVERY_FAILED",
                message: "Organization access policy redirected to an untrusted host"
            )
        }

        let responseURL = response.url ?? appURL
        let accessLogin = isCloudflareAccessPath(
            responseURL.path,
            endpoint: cloudflareAccessLoginPath
        )
        guard accessLogin else {
            return nil
        }
        guard responseURL.scheme?.lowercased() == "https",
              responseURL.port == nil || responseURL.port == 443,
              let authDomain = responseURL.host?.lowercased(),
              isCloudflareAuthenticationHost(authDomain),
              let audience = URLComponents(url: responseURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "kid" })?.value,
              !audience.isEmpty else {
            throw CloudflareAccessFailure(
                code: "ACCESS_DISCOVERY_FAILED",
                message: "Organization access policy returned an untrusted login URL"
            )
        }
        guard let appDomain = response.value(forHTTPHeaderField: "CF-Access-Domain"),
              cloudflareAppDomainMatches(appDomain, appURL: appURL) else {
            throw CloudflareAccessFailure(
                code: "ACCESS_DISCOVERY_FAILED",
                message: "Organization access policy is not scoped to this Matrix endpoint"
            )
        }
        return CloudflareAccessAppInfo(
            authDomain: authDomain,
            audience: audience,
            appDomain: appDomain
        )
    }

    private func exchangeOrgToken(
        _ orgToken: String,
        appURL: URL,
        authDomain: String,
        audience: String
    ) async throws -> CloudflareAccessToken {
        guard appURL.host != nil else {
            throw CloudflareAccessFailure(code: "INVALID_URL", message: "Matrix URL is invalid")
        }
        let delegate = CloudflareOrgTokenExchangeDelegate(
            orgToken: orgToken,
            authDomain: authDomain,
            appURL: appURL
        )
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 15
        let session = URLSession(
            configuration: configuration,
            delegate: delegate,
            delegateQueue: delegateQueue
        )
        defer { session.finishTasksAndInvalidate() }

        var request = URLRequest(url: appURL)
        request.httpMethod = "HEAD"
        request.setValue("cloudflared/ios", forHTTPHeaderField: "User-Agent")
        let (_, rawResponse) = try await session.data(for: request)
        if let response = rawResponse as? HTTPURLResponse {
            delegate.captureCookies(from: response)
        }

        guard !delegate.rejectedRedirect,
              let value = delegate.appToken,
              let token = usableToken(value, audience: audience) else {
            throw CloudflareAccessFailure(
                code: "ACCESS_AUTH_REQUIRED",
                message: "Organization sign-in is required"
            )
        }
        return token
    }

    private func validateMatrixToken(
        _ token: CloudflareAccessToken,
        appURL: URL
    ) async throws {
        guard let versionsURL = cloudflareMatrixProbeURL(appURL),
              cloudflareSecureOrigin(versionsURL) == cloudflareSecureOrigin(appURL),
              versionsURL.path == appURL.path,
              appURL.query == nil,
              appURL.fragment == nil else {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_VALIDATION_FAILED",
                message: "Organization authentication could not validate the Matrix server"
            )
        }

        let delegate = CloudflareNoRedirectDelegate()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 15
        configuration.urlCache = nil
        let session = URLSession(
            configuration: configuration,
            delegate: delegate,
            delegateQueue: nil
        )
        defer { session.finishTasksAndInvalidate() }

        var request = URLRequest(url: versionsURL)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue(token.value, forHTTPHeaderField: "Cf-Access-Token")

        let data: Data
        let rawResponse: URLResponse
        do {
            (data, rawResponse) = try await session.data(for: request)
        } catch {
            try Task.checkCancellation()
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_VALIDATION_UNAVAILABLE",
                message: "The Matrix server is temporarily unavailable"
            )
        }

        guard !delegate.rejectedRedirect,
              let response = rawResponse as? HTTPURLResponse,
              let responseURL = response.url,
              cloudflareSecureOrigin(responseURL) == cloudflareSecureOrigin(versionsURL),
              responseURL.path == versionsURL.path,
              responseURL.query == nil,
              responseURL.fragment == nil else {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_VALIDATION_FAILED",
                message: "Organization authentication could not validate the Matrix server"
            )
        }

        if response.statusCode == 408 || response.statusCode == 429 ||
            response.statusCode >= 500 {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_VALIDATION_UNAVAILABLE",
                message: "The Matrix server is temporarily unavailable"
            )
        }

        guard (200..<300).contains(response.statusCode),
              data.count <= 262_144,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let versions = object["versions"] as? [String],
              !versions.isEmpty,
              versions.allSatisfy({
                  !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              }) else {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_VALIDATION_FAILED",
                message: "Organization authentication could not validate the Matrix server"
            )
        }
    }

    private func makeTransferContext(
        appURL: URL,
        appInfo: CloudflareAccessAppInfo
    ) throws -> CloudflareAccessTransferContext {
        guard let keyPair = sodium.box.keyPair() else {
            throw CloudflareAccessFailure(
                code: "ACCESS_TOKEN_TRANSFER_FAILED",
                message: "Unable to create organization authentication keys"
            )
        }
        let publicKey = encodeURLBase64(Data(keyPair.publicKey))

        guard var components = URLComponents(url: appURL, resolvingAgainstBaseURL: false) else {
            throw CloudflareAccessFailure(
                code: "INVALID_URL",
                message: "Organization authentication URL is invalid"
            )
        }
        setQueryItem(name: "token", value: publicKey, in: &components)
        setQueryItem(name: "aud", value: appInfo.audience, in: &components)
        guard let redirectURL = components.url?.absoluteString else {
            throw CloudflareAccessFailure(
                code: "INVALID_URL",
                message: "Organization authentication redirect URL is invalid"
            )
        }
        setQueryItem(name: "redirect_url", value: redirectURL, in: &components)
        setQueryItem(name: "send_org_token", value: "true", in: &components)
        setQueryItem(name: "edge_token_transfer", value: "true", in: &components)
        components.path = "/cdn-cgi/access/cli"

        let pollingHost = appInfo.authDomain.hasSuffix(".fed.cloudflareaccess.com")
            ? "login.fed.cloudflareaccess.org"
            : "login.cloudflareaccess.org"
        guard let browserURL = components.url,
              let pollingURL = URL(string: "https://\(pollingHost)/transfer/\(publicKey)") else {
            throw CloudflareAccessFailure(
                code: "INVALID_URL",
                message: "Organization authentication transfer URL is invalid"
            )
        }
        return CloudflareAccessTransferContext(
            appInfo: appInfo,
            appURL: appURL,
            browserURL: browserURL,
            pollingURL: pollingURL,
            secretKey: keyPair.secretKey
        )
    }

    private func pollTransfer(_ pollingURL: URL) async throws -> (data: Data, servicePublicKey: String) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 65
        configuration.timeoutIntervalForResource = 65
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        for _ in 0..<10 {
            try Task.checkCancellation()
            var request = URLRequest(url: pollingURL)
            request.httpMethod = "GET"
            request.setValue("cloudflared/ios", forHTTPHeaderField: "User-Agent")
            let (data, rawResponse) = try await session.data(for: request)
            guard let response = rawResponse as? HTTPURLResponse else { continue }
            if response.statusCode >= 500 {
                throw CloudflareAccessFailure(
                    code: "ACCESS_TOKEN_TRANSFER_FAILED",
                    message: "Organization authentication service is unavailable"
                )
            }
            if response.statusCode == 200,
               let servicePublicKey = response.value(forHTTPHeaderField: "service-public-key"),
               !servicePublicKey.isEmpty {
                return (data, servicePublicKey)
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        throw CloudflareAccessFailure(
            code: "ACCESS_TOKEN_TRANSFER_FAILED",
            message: "Organization authentication timed out"
        )
    }

    private func usableToken(_ value: String, audience: String?) -> CloudflareAccessToken? {
        guard let payload = jwtPayload(value),
              payload.expiresAt.timeIntervalSinceNow > cloudflareTokenSkew else {
            return nil
        }
        if let audience, !payload.audiences.contains(audience) {
            return nil
        }
        return CloudflareAccessToken(value: value, expiresAt: payload.expiresAt)
    }

    private func jwtPayload(_ token: String) -> CloudflareJWTPayload? {
        let segments = token.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3,
              let payloadData = decodeURLBase64(String(segments[1])),
              let object = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let expires = object["exp"] as? NSNumber else {
            return nil
        }
        let audiences: [String]
        if let value = object["aud"] as? String {
            audiences = [value]
        } else if let values = object["aud"] as? [String] {
            audiences = values
        } else {
            audiences = []
        }
        return CloudflareJWTPayload(
            audiences: audiences,
            expiresAt: Date(timeIntervalSince1970: expires.doubleValue)
        )
    }

    private func keychainAccount(kind: String, value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        let hash = digest.map { String(format: "%02x", $0) }.joined()
        return "\(kind):\(hash)"
    }

    private func appTokenAccount(
        appURL: URL,
        appInfo: CloudflareAccessAppInfo
    ) -> String {
        keychainAccount(
            kind: "app",
            value: "\(cloudflareSecureOrigin(appURL) ?? "")\u{0}\(mediaCookiePath(for: appURL))\u{0}\(appInfo.appDomain)\u{0}\(appInfo.audience)"
        )
    }

    private func setQueryItem(name: String, value: String, in components: inout URLComponents) {
        var items = components.queryItems ?? []
        items.removeAll { $0.name == name }
        items.append(URLQueryItem(name: name, value: value))
        components.queryItems = items
    }

    private func encodeURLBase64(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
    }

    private func decodeURLBase64(_ value: String) -> Data? {
        var normalized = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        if remainder != 0 {
            normalized.append(String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: normalized)
    }

    private func mediaCookiePath(for url: URL) -> String {
        let path = url.path
        if let range = path.range(of: "/_matrix/") {
            return String(path[..<range.lowerBound]) + "/_matrix"
        }
        return "/"
    }

    private func installAccessCookie(_ token: CloudflareAccessToken, for url: URL) async {
        guard let host = url.host,
              let cookie = HTTPCookie(properties: [
                  .domain: host,
                  .path: mediaCookiePath(for: url),
                  .name: cloudflareAccessCookieName,
                  .value: token.value,
                  .secure: "TRUE",
                  .expires: token.expiresAt,
                  HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                  HTTPCookiePropertyKey("SameSite"): "None",
              ]) else { return }

        HTTPCookieStorage.shared.setCookie(cookie)
        await withCheckedContinuation { continuation in
            WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie) {
                continuation.resume()
            }
        }
    }

    private func removeAccessCookie(for url: URL) async {
        guard let host = url.host else { return }
        let path = mediaCookiePath(for: url)
        for cookie in HTTPCookieStorage.shared.cookies ?? []
            where cookie.name == cloudflareAccessCookieName &&
                cookie.domain == host && cookie.path == path {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }

        await withCheckedContinuation { continuation in
            let store = WKWebsiteDataStore.default().httpCookieStore
            store.getAllCookies { cookies in
                let matching = cookies.filter {
                    $0.name == cloudflareAccessCookieName &&
                        $0.domain == host && $0.path == path
                }
                guard !matching.isEmpty else {
                    continuation.resume()
                    return
                }
                let group = DispatchGroup()
                for cookie in matching {
                    group.enter()
                    store.delete(cookie) { group.leave() }
                }
                group.notify(queue: .global()) { continuation.resume() }
            }
        }
    }
}

@objc(MindRoomAuthPlugin)
public class MindRoomAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "MindRoomAuthPlugin"
    public let jsName = "MindRoomAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cloudflareAccessToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise)
    ]

    private let cloudflareAccessManager = CloudflareAccessManager()
    private var authSession: ASWebAuthenticationSession?
    private var appleSignInCall: CAPPluginCall?
    private var appleSignInNonce: String?
    private var cloudflareAccessCall: CAPPluginCall?
    private var cloudflareAccessTask: Task<Void, Never>?
    private var cloudflareSessionFinishing = false

    @objc func authenticate(_ call: CAPPluginCall) {
        guard authSession == nil else {
            call.reject("An authentication session is already in progress", "AUTH_IN_PROGRESS")
            return
        }

        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            call.reject("Must provide an HTTP(S) authentication URL", "INVALID_URL")
            return
        }

        let callbackScheme = call.getString("callbackScheme")

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackUrl, error in
                DispatchQueue.main.async {
                    defer {
                        self?.authSession = nil
                    }

                    if let callbackUrl = callbackUrl {
                        call.resolve(["url": callbackUrl.absoluteString])
                        return
                    }

                    if let authError = error as? ASWebAuthenticationSessionError,
                       authError.code == .canceledLogin {
                        call.reject("Authentication cancelled", "AUTH_CANCELLED", authError)
                        return
                    }

                    call.reject(error?.localizedDescription ?? "Authentication failed", "AUTH_FAILED", error)
                }
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session

            if !session.start() {
                self.authSession = nil
                call.reject("Unable to start authentication session", "AUTH_START_FAILED")
            }
        }
    }

    @objc func cloudflareAccessToken(_ call: CAPPluginCall) {
        guard cloudflareAccessCall == nil, cloudflareAccessTask == nil else {
            call.reject(
                "Organization authentication is already in progress",
                "ACCESS_AUTH_IN_PROGRESS"
            )
            return
        }
        guard authSession == nil else {
            call.reject(
                "Another authentication session is already in progress",
                "AUTH_IN_PROGRESS"
            )
            return
        }
        guard let urlString = call.getString("url"),
              let requestedURL = URL(string: urlString),
              let url = cloudflareMatrixProbeURL(requestedURL) else {
            call.reject("Must provide an HTTPS Matrix client URL", "INVALID_URL")
            return
        }

        let forceRefresh = call.getBool("forceRefresh") ?? false
        let interactive = call.getBool("interactive") ?? false
        cloudflareAccessCall = call
        cloudflareAccessTask = Task { [weak self] in
            guard let self else { return }
            do {
                let preparation = try await cloudflareAccessManager.prepare(
                    appURL: url,
                    forceRefresh: forceRefresh
                )
                switch preparation {
                case .unprotected:
                    await finishCloudflareAccess(call: call, result: ["protected": false])
                case let .token(token):
                    await finishCloudflareAccess(call: call, result: cloudflareResult(token))
                case let .interactive(context):
                    guard interactive else {
                        throw CloudflareAccessFailure(
                            code: "ACCESS_AUTH_REQUIRED",
                            message: "Organization sign-in is required"
                        )
                    }
                    let appIsActive = await MainActor.run {
                        UIApplication.shared.applicationState == .active
                    }
                    guard appIsActive else {
                        throw CloudflareAccessFailure(
                            code: "ACCESS_AUTH_REQUIRED",
                            message: "Return to the app to continue organization sign-in"
                        )
                    }
                    let started = await startCloudflareAccessSession(context.browserURL)
                    guard started else {
                        throw CloudflareAccessFailure(
                            code: "AUTH_START_FAILED",
                            message: "Unable to start organization authentication"
                        )
                    }
                    let token = try await cloudflareAccessManager.completeTransfer(context)
                    await closeCloudflareAccessSession()
                    await finishCloudflareAccess(call: call, result: cloudflareResult(token))
                }
            } catch {
                await closeCloudflareAccessSession()
                if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                    let failure = CloudflareAccessFailure(
                        code: "ACCESS_AUTH_CANCELLED",
                        message: "Organization authentication cancelled"
                    )
                    await finishCloudflareAccess(call: call, failure: failure)
                } else if let failure = error as? CloudflareAccessFailure {
                    await finishCloudflareAccess(call: call, failure: failure)
                } else {
                    let failure = CloudflareAccessFailure(
                        code: "ACCESS_AUTH_FAILED",
                        message: "Organization authentication failed"
                    )
                    await finishCloudflareAccess(call: call, failure: failure)
                }
            }
        }
    }

    private func cloudflareResult(_ token: CloudflareAccessToken) -> [String: Any] {
        [
            "protected": true,
            "token": token.value,
            "expiresAtMs": token.expiresAt.timeIntervalSince1970 * 1000,
        ]
    }

    @MainActor
    private func startCloudflareAccessSession(_ url: URL) -> Bool {
        guard authSession == nil else { return false }
        cloudflareSessionFinishing = false

        var pendingSession: ASWebAuthenticationSession?
        pendingSession = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: nil
        ) { [weak self] _, error in
            DispatchQueue.main.async {
                guard let self,
                      let pendingSession,
                      self.authSession === pendingSession else { return }
                self.authSession = nil
                if let authError = error as? ASWebAuthenticationSessionError,
                   authError.code == .canceledLogin,
                   !self.cloudflareSessionFinishing {
                    self.cloudflareAccessTask?.cancel()
                }
            }
        }

        guard let session = pendingSession else { return false }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() {
            authSession = nil
            return false
        }
        return true
    }

    @MainActor
    private func closeCloudflareAccessSession() {
        cloudflareSessionFinishing = true
        authSession?.cancel()
        authSession = nil
    }

    @MainActor
    private func finishCloudflareAccess(
        call: CAPPluginCall,
        result: [String: Any]? = nil,
        failure: CloudflareAccessFailure? = nil
    ) {
        guard cloudflareAccessCall === call else { return }
        cloudflareAccessCall = nil
        cloudflareAccessTask = nil
        if let result {
            call.resolve(result)
        } else if let failure {
            call.reject(failure.message, failure.code, failure)
        }
    }

    @objc func signInWithApple(_ call: CAPPluginCall) {
        guard appleSignInCall == nil else {
            call.reject("A Sign in with Apple request is already in progress", "APPLE_AUTH_IN_PROGRESS")
            return
        }

        let nonce = randomNonceString()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = sha256(nonce)

        appleSignInCall = call
        appleSignInNonce = nonce

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        presentationAnchor()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        presentationAnchor()
    }

    private func presentationAnchor() -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }

        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }

        return window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleSignInCall else { return }

        defer {
            appleSignInCall = nil
            appleSignInNonce = nil
        }

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            call.reject("Unexpected Sign in with Apple credential", "APPLE_AUTH_INVALID_CREDENTIAL")
            return
        }

        guard let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            call.reject("Sign in with Apple did not return an identity token", "APPLE_AUTH_MISSING_ID_TOKEN")
            return
        }

        var result: [String: Any] = [
            "identityToken": identityToken,
            "user": credential.user
        ]

        if let authorizationCodeData = credential.authorizationCode,
           let authorizationCode = String(data: authorizationCodeData, encoding: .utf8) {
            result["authorizationCode"] = authorizationCode
        }

        if let nonce = appleSignInNonce {
            result["nonce"] = nonce
        }

        if let email = credential.email {
            result["email"] = email
        }

        if let givenName = credential.fullName?.givenName {
            result["givenName"] = givenName
        }

        if let familyName = credential.fullName?.familyName {
            result["familyName"] = familyName
        }

        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = appleSignInCall else { return }

        defer {
            appleSignInCall = nil
            appleSignInNonce = nil
        }

        if let authError = error as? ASAuthorizationError,
           authError.code == .canceled {
            call.reject("Sign in with Apple cancelled", "APPLE_AUTH_CANCELLED", authError)
            return
        }

        call.reject(error.localizedDescription, "APPLE_AUTH_FAILED", error)
    }

    private func randomNonceString(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            var randomBytes = [UInt8](repeating: 0, count: 16)
            let status = randomBytes.withUnsafeMutableBytes { buffer in
                guard let baseAddress = buffer.baseAddress else {
                    return errSecParam
                }

                return SecRandomCopyBytes(kSecRandomDefault, buffer.count, baseAddress)
            }

            if status != errSecSuccess {
                return UUID().uuidString.replacingOccurrences(of: "-", with: "")
            }

            for randomByte in randomBytes where remainingLength > 0 {
                if Int(randomByte) < charset.count {
                    result.append(charset[Int(randomByte)])
                    remainingLength -= 1
                }
            }
        }

        return result
    }

    private func sha256(_ value: String) -> String {
        let inputData = Data(value.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.map { String(format: "%02x", $0) }.joined()
    }
}
