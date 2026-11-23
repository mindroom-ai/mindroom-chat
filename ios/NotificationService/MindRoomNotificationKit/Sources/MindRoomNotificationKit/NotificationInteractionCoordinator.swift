import Foundation

/// Donates the interaction of a notification only for an account the app still shares, and takes
/// the donation back when the account went away while it was being made.
public enum NotificationInteractionCoordinator {
    /// Whether the interaction is donated and the account is still the one it was donated for.
    ///
    /// The app clears an account (a sign-out, notifications turned off) by deleting the account's
    /// record and its interactions. A donation that is under way then lands after that delete and
    /// would stay, so the account is looked at again once `donate` returns, and a donation that
    /// outlived its account is deleted by the ID it was given. The caller looks at the
    /// cancellation of its task only after this returns, so the cleanup also runs for a
    /// notification whose time ran out.
    ///
    /// - Parameters:
    ///   - isAccountStillValid: Whether the account's record is the one the notification started with.
    ///   - donate: Donates the interaction under the given identifier.
    ///   - deleteInteraction: Deletes the interaction with the given identifier.
    public static func donateIfValid(
        isAccountStillValid: () -> Bool,
        donate: (_ interactionId: String) async throws -> Void,
        deleteInteraction: (_ interactionId: String) async -> Void
    ) async -> Bool {
        let interactionId = UUID().uuidString
        guard isAccountStillValid() else {
            return false
        }

        do {
            try await donate(interactionId)
        } catch {
            // Whatever a failed donation left behind.
            await deleteInteraction(interactionId)
            return false
        }

        guard isAccountStillValid() else {
            await deleteInteraction(interactionId)
            return false
        }
        return true
    }
}
