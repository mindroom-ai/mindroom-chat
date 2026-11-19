import Foundation

/// The calls the Developer ID Mac app makes into its updater bundle, which alone links Sparkle.
@objc(MindRoomMacUpdaterProtocol)
protocol MindRoomMacUpdaterProtocol: NSObjectProtocol {
    /// Starts Sparkle's scheduled checks. `onChange` runs on the main thread with the version
    /// (`CFBundleShortVersionString`) of an update that is downloaded and waits to be installed,
    /// and with nil when Sparkle gave that update up.
    func start(onChange: @escaping (String?) -> Void)
    /// Quits the app, installs the waiting update and opens it. False when none waits.
    func install() -> Bool
    /// Sparkle's own flag: false before start() and while a check runs or an update waits.
    var canCheckForUpdates: Bool { get }
    /// A check the user asked for, in Sparkle's windows. Does nothing while it cannot check.
    func checkForUpdates()
}
