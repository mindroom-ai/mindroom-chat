import AuthenticationServices
import Capacitor
import UIKit

@objc(MindRoomAuthPlugin)
public class MindRoomAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "MindRoomAuthPlugin"
    public let jsName = "MindRoomAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    private var authSession: ASWebAuthenticationSession?

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

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }

        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }

        return window ?? ASPresentationAnchor()
    }
}
