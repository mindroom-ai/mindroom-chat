import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import os

private let log = Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "session")

/// The watch's Matrix account: signs in with the iPhone's login token, restores, syncs, signs out.
@MainActor
final class MatrixSession: ObservableObject {
    /// The app's session, for the notification controller and actions, which run in the app's process.
    static weak var shared: MatrixSession?

    enum State {
        case signedOut
        case connecting
        /// The login token ran out or was used: connect again from the iPhone.
        case expired
        case signedIn(Client)
        case failed
    }

    @Published private(set) var state: State = .signedOut
    @Published private(set) var syncState: SyncServiceState = .idle
    private(set) var syncService: SyncService?
    private var handles: [TaskHandle] = []
    /// The last session change queued: connecting, restoring, importing secrets and signing out run one at a
    /// time, so two clients never open the one store and a sign-out never misses a client still starting.
    private var lastChange: Task<Void, Never>?
    /// Called with the new device (user id, device id, its Ed25519 key) after a sign-in, to tell the iPhone
    /// (WatchLink).
    var onSignedIn: ((String, String, String) -> Void)?

    var client: Client? {
        if case let .signedIn(client) = state { return client }
        return nil
    }

    private func serially(_ change: @escaping @MainActor () async -> Void) async {
        let previous = lastChange
        let task = Task { @MainActor in
            await previous?.value
            await change()
        }
        lastChange = task
        await task.value
    }

    func connect(_ message: WatchLinkMessage) async {
        await serially { await self.connectNow(message) }
    }

    private func connectNow(_ message: WatchLinkMessage) async {
        guard case let .credentials(homeserverUrl, userId, token, _) = message else { return }
        // A live session stays until the new one works: stale or repeated credentials must not sign the watch out.
        let signedIn = client != nil
        if TokenLoginRequest.isExpired(message, now: Date()) {
            if !signedIn { state = .expired }
            return
        }
        if !signedIn { state = .connecting }
        do {
            let (data, response) = try await URLSession.shared.data(for: TokenLoginRequest.make(homeserverUrl: homeserverUrl, token: token))
            let result = try TokenLoginRequest.parse(data: data, status: (response as? HTTPURLResponse)?.statusCode ?? 0, userId: userId)
            // Connecting again replaces the old device, which is logged out on the server: its client is
            // opened first when the credentials came before the app restored it.
            if SessionStore.load() != nil {
                if client == nil { await restoreNow() }
                await signOutNow()
            }
            let session = Session(accessToken: result.accessToken, refreshToken: nil, userId: result.userId,
                                  deviceId: result.deviceId, homeserverUrl: homeserverUrl.absoluteString,
                                  oauthData: nil, slidingSyncVersion: .native)
            do { try await start(session) } catch {
                // Its store is this sign-in's alone: nothing else would ever delete it.
                SessionStore.removeStore(session)
                throw error
            }
            do { try SessionStore.save(session) } catch {
                // A session the Keychain did not keep could not be opened again: the sign-in is undone
                // (its device logged out) before the iPhone hears of it.
                await signOutNow()
                SessionStore.removeStore(session)
                throw error
            }
            // The iPhone verifies the device by the key the watch names here, not by what the server lists.
            if let deviceKey = await client?.encryption().ed25519Key() {
                log.notice("reporting the device with key \(deviceKey, privacy: .public)")
                onSignedIn?(result.userId, result.deviceId, deviceKey)
            } else {
                log.error("the new device has no signing key to report")
            }
        } catch TokenLoginError.expired {
            if !signedIn { state = .expired }
        } catch {
            log.error("connect failed: \(String(describing: type(of: error)), privacy: .public)")
            if !signedIn { state = .failed }
        }
    }

    /// Opens the saved session, if there is one (and none is open or opening).
    func restore() async {
        await serially { await self.restoreNow() }
    }

    private func restoreNow() async {
        guard client == nil, let session = SessionStore.load() else { return }
        // The app was deleted and installed again: the Keychain kept the session, the store with the
        // device's keys is gone. A new store would give the old device new keys, which nothing trusts:
        // the watch is signed out, and Disconnect on the iPhone deletes the device.
        guard SessionStore.hasStore(session) else {
            log.notice("the saved session has no store: signed out")
            SessionStore.clear()
            return
        }
        state = .connecting
        do {
            try await start(session)
        } catch {
            log.error("restore failed: \(String(describing: error), privacy: .public)")
            state = .failed
        }
    }

    /// Logs the device out on the server when it can, then forgets everything on the watch.
    func signOut() async {
        await serially { await self.signOutNow() }
    }

    private func signOutNow() async {
        await syncService?.stop()
        if let client { try? await client.logout() }
        tearDown()
        SessionStore.clear()
        state = .signedOut
    }

    /// Imports the account's secrets bundle the iPhone sent: verifies this device and turns key backup on,
    /// so the account's devices trust it and messages from before it signed in decrypt.
    func importSecrets(userId: String, bundle: String) async {
        await serially { await self.importSecretsNow(userId: userId, bundle: bundle) }
    }

    private func importSecretsNow(userId: String, bundle: String) async {
        // The bundle may arrive while the app is still opening its session.
        if client == nil { await restoreNow() }
        guard let client, (try? client.userId()) == userId else {
            log.error("secrets bundle for another account or no session")
            return
        }
        do {
            let secrets = try SecretsBundleWithUserId.fromJson(userId: userId, json: bundle)
            try await client.encryption().importSecretsBundle(secretsBundle: secrets)
            log.notice("imported the secrets bundle")
        } catch {
            log.error("secrets import failed: \(String(describing: type(of: error)), privacy: .public)")
        }
    }

    /// Starts or stops sync as the app comes forward or goes to the background.
    func setActive(_ active: Bool) async {
        guard let syncService else { return }
        if active {
            await syncService.start()
            await client?.enableAllSendQueues(enable: true)
        } else {
            await syncService.stop()
        }
    }

    private func start(_ session: Session) async throws {
        let paths = SessionStore.paths(session)
        let store = SqliteStoreBuilder(dataPath: paths.data.path, cachePath: paths.cache.path)
            .passphrase(passphrase: try SessionStore.passphrase())
        let client = try await ClientBuilder()
            .homeserverUrl(url: session.homeserverUrl)
            .sqliteStore(config: store)
            .slidingSyncVersionBuilder(versionBuilder: .native)
            // Turn key backup on when another device hands over its key, and fetch a room's keys from it
            // when a message there does not decrypt.
            .autoEnableBackups(autoEnableBackups: true)
            .backupDownloadStrategy(backupDownloadStrategy: .afterDecryptionFailure)
            .userAgent(userAgent: "MindRoom Apple Watch")
            .build()
        try await client.restoreSession(session: session)
        let deviceId = session.deviceId
        if let handle = try client.setDelegate(delegate: AuthErrorDelegate { [weak self] in
            Task { @MainActor in await self?.revoked(deviceId: deviceId) }
        }) { handles.append(handle) }
        // Offline mode: sync waits for the network to come back instead of stopping at the first error.
        let syncService = try await client.syncService().withOfflineMode().finish()
        handles.append(syncService.state(listener: SyncStateListener { [weak self] state in
            log.notice("sync \(String(describing: state), privacy: .public)")
            Task { @MainActor in
                self?.syncState = state
                // A send that failed for want of a network stops the room's queue until it is turned on again.
                if state == .running { await client.enableAllSendQueues(enable: true) }
            }
        }))
        self.syncService = syncService
        state = .signedIn(client)
        log.notice("signed in as device \(session.deviceId, privacy: .public)")
        await syncService.start()
    }

    /// The server no longer knows the token (signed out elsewhere, device deleted).
    private func revoked(deviceId: String) async {
        await serially {
            // An error from a client that "Connect again" already replaced does not sign the new one out.
            guard SessionStore.load()?.deviceId == deviceId else { return }
            await self.revokedNow()
        }
    }

    private func revokedNow() async {
        log.notice("session revoked")
        await syncService?.stop()
        tearDown()
        SessionStore.clear()
        state = .signedOut
    }

    private func tearDown() {
        handles.forEach { $0.cancel() }
        handles = []
        syncService = nil
    }
}

private final class AuthErrorDelegate: ClientDelegate, @unchecked Sendable {
    let onError: () -> Void
    init(_ onError: @escaping () -> Void) { self.onError = onError }
    func didReceiveAuthError(isSoftLogout: Bool) { onError() }
    func onBackgroundTaskErrorReport(taskName: String, error: BackgroundTaskFailureReason) {}
}

private final class SyncStateListener: SyncServiceStateObserver, @unchecked Sendable {
    let onChange: (SyncServiceState) -> Void
    init(_ onChange: @escaping (SyncServiceState) -> Void) { self.onChange = onChange }
    func onUpdate(state: SyncServiceState) { onChange(state) }
}
