#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE
import Capacitor

/// The updater's side of `src/app/native/nativeUpdate.ts`: the page asks for the staged update and
/// installs it. No events: the page asks (see that file). Plugin calls arrive on the bridge's
/// queue; MacUpdater is main thread only.
@objc(MindRoomUpdatePlugin)
public class MindRoomUpdatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomUpdatePlugin"
    public let jsName = "MindRoomUpdate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "install", returnType: CAPPluginReturnPromise)
    ]

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let version = MacUpdater.readyVersion {
                call.resolve(["version": version])
            } else {
                call.resolve([:])
            }
        }
    }

    @objc func install(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if MacUpdater.install() {
                call.resolve()
            } else {
                call.reject("No update is ready", "NOT_READY")
            }
        }
    }
}
#endif
