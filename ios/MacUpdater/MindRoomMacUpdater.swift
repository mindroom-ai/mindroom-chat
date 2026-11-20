import Foundation
import Sparkle

/// Sparkle in its automatic mode: it checks, downloads and stages an update silently, and this
/// keeps the block that installs it now, so the page's Reload can run it.
@objc(MindRoomMacUpdater)
final class MindRoomMacUpdater: NSObject, MindRoomMacUpdaterProtocol, SPUUpdaterDelegate {
    private var updater: SPUUpdater?
    private var onChange: ((String?) -> Void)?
    private var installNow: (() -> Void)?

    func start(onChange: @escaping (String?) -> Void) {
        guard updater == nil else { return }
        self.onChange = onChange
        // SPUStandardUpdaterController would show an alert when the start fails; this only logs.
        let updater = SPUUpdater(
            hostBundle: .main, applicationBundle: .main,
            userDriver: SPUStandardUserDriver(hostBundle: .main, delegate: nil), delegate: self
        )
        self.updater = updater
        do {
            try updater.start()
        } catch {
            NSLog("MindRoom updater did not start: %@", error.localizedDescription)
        }
    }

    func install() -> Bool {
        guard let installNow else { return false }
        // Kept while its cycle lives: Sparkle allows a second call after a cancelled quit.
        installNow()
        return true
    }

    var canCheckForUpdates: Bool { updater?.canCheckForUpdates ?? false }

    func checkForUpdates() {
        guard let updater, updater.canCheckForUpdates else { return }
        updater.checkForUpdates()
    }

    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        installNow = immediateInstallHandler
        onChange?(item.displayVersionString)
        return true
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        // Sparkle runs no cycle while a staged update waits, so a finished cycle means that
        // update's session is over; its block holds its driver weakly and would do nothing.
        guard installNow != nil else { return }
        installNow = nil
        onChange?(nil)
    }
}
