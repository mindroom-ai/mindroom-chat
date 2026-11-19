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
}
