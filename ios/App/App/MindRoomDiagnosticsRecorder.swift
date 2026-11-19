import Capacitor
import os // TEMP-DIAG(webview-kill):
import UIKit
import WebKit

final class MindRoomDiagnosticsRecorder {
    static let shared = MindRoomDiagnosticsRecorder(store: .shared)

    private let store: MindRoomDiagnosticsStore
    private var notificationTokens: [NSObjectProtocol] = []
    private var didStart = false
    private var lastMemoryWarningUptime: TimeInterval? // TEMP-DIAG(webview-kill):

    init(store: MindRoomDiagnosticsStore) {
        self.store = store
    }

    func start(application: UIApplication) {
        guard Thread.isMainThread else {
            DispatchQueue.main.sync { self.start(application: application) }
            return
        }
        guard !didStart else { return }
        didStart = true

        observe(.capacitorWebViewNavigationStarted, as: .navigationStarted)
        observe(.capacitorWebViewNavigationFinished, as: .navigationFinished)
        observe(.capacitorWebViewNavigationFailed, as: .navigationFailed)
        observe(.capacitorWebViewNavigationProvisionalFailed, as: .navigationProvisionalFailed)
        observe(.capacitorWebViewTerminated, as: .webViewTerminated)
        store.record(
            name: .appLaunch,
            data: MindRoomDiagnosticState(applicationState: application.applicationState.rawValue)
        )
    }

    func recordMemoryWarning(application: UIApplication) {
        onMain { [self] in
            lastMemoryWarningUptime = ProcessInfo.processInfo.systemUptime // TEMP-DIAG(webview-kill):
            store.record(
                name: .memoryWarning,
                data: MindRoomDiagnosticState(applicationState: application.applicationState.rawValue)
            )
        }
    }

    func recordScene(_ name: MindRoomDiagnosticEventName, scene: UIScene) {
        onMain { [self] in
            store.record(name: name, data: webViewState(bridgeWebView(in: scene), scene: scene))
        }
    }

    // TEMP-DIAG(webview-kill): records the reason before Capacitor's handler posts webview.terminated.
    func recordTerminationReason(_ reason: Int, webView: WKWebView) {
        let names = ["memory", "cpu", "client", "crash", "shared_process_crash_limit"] // _WKProcessTerminationReason
        var data = webViewState(webView)
        data.terminationReason = names.indices.contains(reason) ? names[reason] : "unknown(\(reason))"
#if !targetEnvironment(macCatalyst)
        data.availableMemoryBytes = Int(os_proc_available_memory())
#endif
        data.msSinceMemoryWarning = lastMemoryWarningUptime.map {
            Int((ProcessInfo.processInfo.systemUptime - $0) * 1_000)
        }
        store.record(name: .webViewTerminationReason, data: data)
    }

    func read(completion: @escaping (MindRoomDiagnosticsSnapshot) -> Void) {
        store.read(completion: completion)
    }

    private func observe(_ notificationName: Notification.Name, as eventName: MindRoomDiagnosticEventName) {
        notificationTokens.append(
            NotificationCenter.default.addObserver(
                forName: notificationName,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                self?.recordNavigation(eventName, notification: notification)
            }
        )
    }

    private func recordNavigation(_ name: MindRoomDiagnosticEventName, notification: Notification) {
        onMain { [self] in
            let webView = notification.object as? WKWebView
            var data = webViewState(webView)
            if let error = notification.userInfo?["error"] as? Error {
                let safeError = MindRoomDiagnosticState(error: error)
                data.errorDomain = safeError.errorDomain
                data.errorCode = safeError.errorCode
            }
            store.record(name: name, data: data)
        }
    }

    private func bridgeWebView(in scene: UIScene) -> WKWebView? {
        guard let windowScene = scene as? UIWindowScene else { return nil }
        return windowScene.windows
            .compactMap { $0.rootViewController as? MindRoomBridgeViewController }
            .compactMap(\.webView)
            .first
    }

    private func webViewState(_ webView: WKWebView?, scene: UIScene? = nil) -> MindRoomDiagnosticState {
        guard let webView else {
            return MindRoomDiagnosticState(
                applicationState: UIApplication.shared.applicationState.rawValue,
                sceneState: scene?.activationState.rawValue
            )
        }
        let backgroundAlpha = webView.backgroundColor?.cgColor.alpha ?? 0
        return MindRoomDiagnosticState(
            applicationState: UIApplication.shared.applicationState.rawValue,
            sceneState: scene?.activationState.rawValue ?? webView.window?.windowScene?.activationState.rawValue,
            loading: webView.isLoading,
            progress: webView.estimatedProgress,
            attached: webView.window != nil,
            hidden: webView.isHidden,
            opaque: webView.isOpaque,
            transparent: !webView.isOpaque || webView.alpha < 1 || backgroundAlpha < 1,
            emptyBounds: webView.bounds.isEmpty
        )
    }

    private func onMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread {
            action()
        } else {
            DispatchQueue.main.async(execute: action)
        }
    }
}

// TEMP-DIAG(webview-kill): WebKit's private WKNavigationDelegatePrivate callback, added to Capacitor's own
// delegate class as an Objective-C category. A delegate that implements it gets it INSTEAD of
// webViewWebContentProcessDidTerminate: (WebKit NavigationState::processDidTerminate), so forward to
// Capacitor's handler to keep its bridge reset, reload and webview.terminated notification.
extension WebViewDelegationHandler {
    @objc(_webView:webContentProcessDidTerminateWithReason:)
    func mindRoomWebView(_ webView: WKWebView, webContentProcessDidTerminateWithReason reason: Int) {
        MindRoomDiagnosticsRecorder.shared.recordTerminationReason(reason, webView: webView)
        webViewWebContentProcessDidTerminate(webView)
    }
}
