import Capacitor
import UIKit

/// The Quick Capture widget's native side (`src/app/native/nativeQuickCapture.ts`): its window,
/// the main window and screenshots. Only the Mac has the widget; elsewhere every method rejects
/// `UNSUPPORTED`.
@objc(MindRoomQuickCapturePlugin)
public class MindRoomQuickCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomQuickCapturePlugin"
    public let jsName = "MindRoomQuickCapture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showMainWindow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openScreenRecordingSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureScreenshot", returnType: CAPPluginReturnPromise)
    ]

#if targetEnvironment(macCatalyst)
    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
#if MINDROOM_MAC_APP_STORE
            guard MacWindowing.requireSupport(), let scene = QuickCapture.widgetScene else {
                return call.reject("Quick Capture is unavailable", "CAPTURE_FAILED")
            }
            QuickCapture.whenHostWindow(of: scene, onFailure: { call.reject($0, "CAPTURE_FAILED") }) { host in
                MacWindowing.hideWidget(host)
                call.resolve()
            }
#else
            QuickCapture.hide()
            call.resolve()
#endif
        }
    }

    @objc func showMainWindow(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
#if MINDROOM_MAC_APP_STORE
            QuickCapture.showMainWindow { error in
                if let error { call.reject(error, "CAPTURE_FAILED") } else { call.resolve() }
            }
#else
            QuickCapture.showMainWindow()
            call.resolve()
#endif
        }
    }

    @objc func openScreenRecordingSettings(_ call: CAPPluginCall) {
        let pane = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        DispatchQueue.main.async {
            guard let url = URL(string: pane) else { return call.resolve() }
            UIApplication.shared.open(url) { _ in call.resolve() }
        }
    }

    @objc func captureScreenshot(_ call: CAPPluginCall) {
        guard let target = MacScreenshot.Target(rawValue: call.getString("target") ?? "") else {
            return call.reject("Unknown screenshot target", MacScreenshot.Failure.captureFailed.rawValue)
        }
        Task { @MainActor in
            let display = QuickCapture.widgetDisplay
#if MINDROOM_MAC_APP_STORE
            guard MacWindowing.requireSupport(), display != nil else {
                MacWindowing.reportFailure("Quick Capture could not identify its screen. Close and reopen Quick Capture.")
                return call.reject("Quick Capture's screen is unavailable", "NO_WINDOW")
            }
#endif
            do {
                let shot = try await MacScreenshot.capture(
                    target,
                    frontProcess: MacWindowing.lastFrontProcess,
                    display: display
                )
                call.resolve(["path": shot.path, "name": shot.name])
            } catch let failure as MacScreenshot.Failure {
                call.reject("Screenshot failed", failure.rawValue)
            } catch {
                call.reject("Screenshot failed", MacScreenshot.Failure.captureFailed.rawValue)
            }
        }
    }
#else
    @objc func hide(_ call: CAPPluginCall) { unsupported(call) }
    @objc func showMainWindow(_ call: CAPPluginCall) { unsupported(call) }
    @objc func openScreenRecordingSettings(_ call: CAPPluginCall) { unsupported(call) }
    @objc func captureScreenshot(_ call: CAPPluginCall) { unsupported(call) }

    private func unsupported(_ call: CAPPluginCall) {
        call.reject("Quick Capture is only on the Mac", "UNSUPPORTED")
    }
#endif
}
