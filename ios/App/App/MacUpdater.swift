#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE
import Foundation

/// The Developer ID app's updater. Sparkle is AppKit, so it lives in
/// Contents/PlugIns/MindRoomMacUpdater.bundle, which this Catalyst app loads through a shared
/// protocol (Sparkle's documented Catalyst setup). The Store app and iOS have none of it.
enum MacUpdater {
    /// The staged update's version. Main thread only.
    private(set) static var readyVersion: String?
    private static var updater: MindRoomMacUpdaterProtocol?

    /// Loads the bundle and starts it. Does nothing in an app whose Info.plist has no SUFeedURL
    /// (every build but a release): a local build would otherwise replace itself with the release.
    static func start() {
        guard updater == nil, Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil else { return }
        guard let url = Bundle.main.builtInPlugInsURL?.appendingPathComponent("MindRoomMacUpdater.bundle"),
              let bundle = Bundle(url: url), bundle.load(),
              let principal = bundle.principalClass as? NSObject.Type,
              let instance = principal.init() as? MindRoomMacUpdaterProtocol else {
            NSLog("MindRoom updater bundle did not load: this app does not update itself")
            return
        }
        updater = instance
        instance.start { version in
            readyVersion = version
            if let version {
                NSLog("MindRoom update ready: %@", version)
            } else {
                NSLog("MindRoom update withdrawn")
            }
        }
    }

    /// Installs the staged update and restarts. False when none is staged.
    static func install() -> Bool {
        updater?.install() ?? false
    }

    /// False in a build that does not update itself, and while Sparkle is busy.
    static var canCheckForUpdates: Bool { updater?.canCheckForUpdates ?? false }

    static func checkForUpdates() {
        updater?.checkForUpdates()
    }
}
#endif
