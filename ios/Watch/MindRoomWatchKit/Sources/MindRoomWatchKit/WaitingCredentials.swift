import Foundation

/// The newest credentials the watch has not signed in with yet. WatchConnectivity delivers them in the background
/// too, where URLSession sends no request (Apple, "Making default and ephemeral requests"), so they are used
/// only while the app is in front, and wait for that otherwise.
public struct WaitingCredentials: Sendable {
    private var message: WatchLinkMessage?

    public init() {}

    public var isEmpty: Bool { message == nil }

    /// Credentials from the iPhone: they replace any that waited.
    public mutating func received(_ message: WatchLinkMessage) {
        self.message = message
    }

    /// The credentials to sign in with now: none while the app is not in front.
    public mutating func take(inFront: Bool) -> WatchLinkMessage? {
        guard inFront, let message else { return nil }
        self.message = nil
        return message
    }

    /// The network failed a sign-in, which may never have reached the server: its credentials wait again,
    /// unless newer ones came.
    public mutating func notSent(_ message: WatchLinkMessage) {
        if self.message == nil { self.message = message }
    }

    public mutating func clear() {
        message = nil
    }
}
