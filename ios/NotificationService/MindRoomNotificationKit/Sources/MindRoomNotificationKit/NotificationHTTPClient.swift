import Foundation

/// Loads response bodies for `NotificationAvatarFetcher` over one ephemeral session: no cookies, no
/// cache, a size cap enforced while the body streams in, and redirects followed on the same origin only.
public final class NotificationHTTPClient: Sendable {
    public static let shared = NotificationHTTPClient()

    /// A new configuration with the client's defaults, for a caller that adds to it.
    public static var defaultConfiguration: URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 6
        configuration.timeoutIntervalForResource = 10
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        return configuration
    }

    private let session: URLSession
    private let delegate: NotificationHTTPSessionDelegate

    public init(configuration: URLSessionConfiguration = NotificationHTTPClient.defaultConfiguration) {
        let delegate = NotificationHTTPSessionDelegate()
        self.delegate = delegate
        self.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    deinit {
        // A session keeps its delegate until it is invalidated.
        session.invalidateAndCancel()
    }

    /// The body of a 200 response of at most `maxBytes`, or nil. Cancelling the calling task ends
    /// the request and returns nil at once.
    public func data(for request: URLRequest, maxBytes: Int) async -> Data? {
        await delegate.load(session.dataTask(with: request), maxBytes: maxBytes)
    }
}

/// The session delegate of `NotificationHTTPClient`. It collects each task's body in the chunks the
/// session delivers, stops a task whose body would pass its cap, and decides every redirect.
public final class NotificationHTTPSessionDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private final class Load {
        let maxBytes: Int
        var body = Data()
        var failed = false
        var finished = false
        var continuation: CheckedContinuation<Data?, Never>?

        init(maxBytes: Int) {
            self.maxBytes = maxBytes
        }
    }

    private let lock = NSLock()
    private var loads: [Int: Load] = [:]

    public override init() {
        super.init()
    }

    /// Runs a task that is not resumed yet, of a session that has this object as its delegate.
    func load(_ task: URLSessionDataTask, maxBytes: Int) async -> Data? {
        let id = task.taskIdentifier
        // Registered before the task can end, so a cancellation that comes first still finds it.
        register(id, maxBytes: maxBytes)
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Data?, Never>) in
                if self.attach(continuation, to: id) {
                    task.resume()
                }
            }
        } onCancel: {
            task.cancel()
            // The caller gets its answer now, whenever the session reports the cancelled task.
            self.finish(id, failed: true)
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let original = task.originalRequest,
              let originalURL = original.url,
              let newURL = request.url,
              NotificationAvatarFetcher.hasSameOrigin(originalURL, newURL) else {
            // Not followed: the redirect response itself ends the task, and it is not a 200.
            completionHandler(nil)
            return
        }
        // URLSession leaves Authorization out of a request it redirects. A homeserver or a reverse
        // proxy that moves a path needs it again; another origin never gets it.
        var redirected = request
        if let authorization = original.value(forHTTPHeaderField: "Authorization") {
            redirected.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        completionHandler(redirected)
    }

    public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        completionHandler(accept(response, for: dataTask.taskIdentifier) ? .allow : .cancel)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if !append(data, to: dataTask.taskIdentifier) {
            dataTask.cancel()
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task.taskIdentifier, failed: error != nil)
    }

    private func register(_ id: Int, maxBytes: Int) {
        lock.lock()
        loads[id] = Load(maxBytes: maxBytes)
        lock.unlock()
    }

    /// Hands the load its waiting caller. False when the load already ended (it was cancelled
    /// first), in which case the caller is answered here.
    private func attach(_ continuation: CheckedContinuation<Data?, Never>, to id: Int) -> Bool {
        lock.lock()
        if let load = loads[id], !load.finished {
            load.continuation = continuation
            lock.unlock()
            return true
        }
        loads.removeValue(forKey: id)
        lock.unlock()
        continuation.resume(returning: nil)
        return false
    }

    /// Whether the response is a 200 that does not announce a body over the cap.
    private func accept(_ response: URLResponse, for id: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let load = loads[id] else { return false }
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              http.expectedContentLength <= Int64(load.maxBytes) else {
            load.failed = true
            return false
        }
        return true
    }

    /// Whether the chunk still fits under the cap.
    private func append(_ data: Data, to id: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let load = loads[id], !load.failed else { return false }
        guard load.body.count + data.count <= load.maxBytes else {
            load.failed = true
            load.body = Data()
            return false
        }
        load.body.append(data)
        return true
    }

    /// Ends the load once, with whichever of the session's report and the caller's cancellation
    /// comes first; the other finds nothing left to do.
    private func finish(_ id: Int, failed: Bool) {
        lock.lock()
        guard let load = loads[id], !load.finished else {
            lock.unlock()
            return
        }
        if failed {
            load.failed = true
        }
        guard let continuation = load.continuation else {
            // The caller is not waiting yet; `attach` answers it.
            load.finished = true
            lock.unlock()
            return
        }
        loads.removeValue(forKey: id)
        let body = load.failed ? nil : load.body
        lock.unlock()
        continuation.resume(returning: body)
    }
}
