import Foundation

/// Donates the interaction of a notification only for an account the app still shares, and takes
/// the donation back when the account went away while it was being made.
public enum NotificationInteractionCoordinator {
    /// Whether the interaction is donated and the account is still the one it was donated for.
    ///
    /// The app removes an account (a sign-out, notifications turned off) by deleting the account's
    /// record and its interactions. A donation that is under way then lands after that delete and
    /// would stay, so the account is looked at again once `donate` returns, and a donation that
    /// outlived its account is deleted by the ID it was given. A delete that the system refuses
    /// is noted down for the app, which tries it again. The caller looks at the cancellation of
    /// its task only after this returns, so the cleanup also runs for a notification whose time
    /// ran out.
    ///
    /// - Parameters:
    ///   - isAccountStillValid: Whether the account's record is the one the notification started with.
    ///   - donate: Donates the interaction under the given identifier.
    ///   - deleteInteraction: Deletes the interaction with the given identifier.
    ///   - recordPendingDelete: Notes down the identifier of an interaction that could not be deleted.
    public static func donateIfValid(
        isAccountStillValid: () -> Bool,
        donate: (_ interactionId: String) async throws -> Void,
        deleteInteraction: (_ interactionId: String) async throws -> Void,
        recordPendingDelete: (_ interactionId: String) -> Void
    ) async -> Bool {
        let interactionId = UUID().uuidString
        guard isAccountStillValid() else {
            return false
        }

        do {
            try await donate(interactionId)
            if isAccountStillValid() {
                return true
            }
        } catch {
            // Whatever the failed donation left behind is deleted below.
        }

        // The donation outlived its account, or failed.
        do {
            try await deleteInteraction(interactionId)
        } catch {
            recordPendingDelete(interactionId)
        }
        return false
    }
}
