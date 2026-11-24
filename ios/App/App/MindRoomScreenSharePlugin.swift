#if os(iOS) && !targetEnvironment(macCatalyst) && canImport(LiveKit)
import Capacitor
import Combine
import Foundation
import LiveKit
import OSLog
import ReplayKit
import UIKit

/// Publish-only LiveKit room for iOS whole-phone ReplayKit screen sharing
/// (`src/app/calls/nativeScreenShare.ts`). Runs beside WKWebView's call without touching
/// AVAudioSession or subscribing to remote tracks.
@objc(MindRoomScreenSharePlugin)
public final class MindRoomScreenSharePlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
    public let identifier = "MindRoomScreenSharePlugin"
    public let jsName = "MindRoomScreenShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateAllowedParticipants", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "heartbeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private struct Session {
        let generation: Int
        let identity: String
        let room: Room
        var keyProvider: BaseKeyProvider?
        var keyIndex: Int32
        var allowedIdentities: Set<String>
        let leaseSeconds: TimeInterval
        var lastHeartbeatAt = Date()
        var lastHeartbeatLogAt = Date.distantPast
        var isBroadcasting = false
        var watchdogTask: Task<Void, Never>?
    }

    private let log = Logger(subsystem: "chat.mindroom.app", category: "ScreenShare")
    private var broadcastSubscription: AnyCancellable?
    @MainActor private var generation = 0
    @MainActor private var session: Session?
    @MainActor private weak var pickerSheet: BroadcastPickerSheetController?

    override public func load() {
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
        AudioManager.shared.audioSession.isAutomaticDeactivationEnabled = false
        AudioManager.shared.set(engineObservers: [])
        BroadcastManager.shared.shouldPublishTrack = false
        broadcastSubscription = BroadcastManager.shared.isBroadcastingPublisher
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isBroadcasting in
                Task { @MainActor [weak self] in await self?.handleBroadcast(isBroadcasting) }
            }
    }

    deinit { broadcastSubscription?.cancel() }

    @objc func start(_ call: CAPPluginCall) {
        guard let url = Self.nonEmpty(call.getString("url")),
              let token = Self.nonEmpty(call.getString("token")),
              let identity = Self.nonEmpty(call.getString("identity")) else {
            return call.reject("Missing url, token, or identity", "INVALID")
        }
        let encrypted = call.getBool("encrypted") ?? false
        let allowed = Set(call.getArray("allowedIdentities") as? [String] ?? [])
        let leaseSeconds = TimeInterval(max(5_000, call.getInt("leaseMs") ?? 90_000)) / 1_000.0
        let rawStrings = call.getObject("strings")
        let str = { (key: String, fallback: String) in Self.nonEmpty(rawStrings?[key] as? String) ?? fallback }
        let strings = SheetStrings(
            title: str("title", "Share entire screen"),
            body: str("body", "Everything on your screen, including notifications and other apps, will be visible to the call."),
            caption: str("caption", "Tap the button above, then tap Start Broadcast."),
            cancel: str("cancel", "Cancel")
        )
        let initialKey: (data: Data, index: Int32)?
        if encrypted {
            guard let decoded = Self.decodeKey(call) else { return call.reject("Invalid E2EE key payload", "INVALID") }
            initialKey = decoded
        } else {
            initialKey = nil
        }

        Task { @MainActor [weak self] in
            guard let self else { return call.reject("Plugin unavailable", "UNAVAILABLE") }
            await self.teardown(expectedGeneration: nil, reason: "replaced")
            self.generation += 1
            let gen = self.generation

            var keyProvider: BaseKeyProvider?
            var encryptionOptions: EncryptionOptions?
            if let initialKey {
                let provider = BaseKeyProvider(options: KeyProviderOptions(
                    sharedKey: false, ratchetWindowSize: 10, keyRingSize: 256,
                    discardFrameWhenCryptorNotReady: true, keyDerivationAlgorithm: .hkdf))
                provider.setKey(keyData: initialKey.data, participantId: identity, index: initialKey.index)
                provider.setCurrentKeyIndex(initialKey.index)
                keyProvider = provider
                encryptionOptions = EncryptionOptions(keyProvider: provider, encryptionType: .gcm)
            }

            let room = Room(
                delegate: self,
                connectOptions: ConnectOptions(autoSubscribe: false, enableMicrophone: false),
                roomOptions: RoomOptions(
                    defaultScreenShareCaptureOptions: ScreenShareCaptureOptions(
                        appAudio: false, useBroadcastExtension: true, useScreenCaptureKit: false),
                    defaultVideoPublishOptions: VideoPublishOptions(simulcast: false, preferredCodec: .vp8),
                    suspendLocalVideoTracksInBackground: false,
                    encryptionOptions: encryptionOptions))
            do { try await room.connect(url: url, token: token) } catch {
                let message = error.localizedDescription
                self.log.error("Screen share connect failed: \(message, privacy: .public)")
                return call.reject("Failed to connect screen share room: \(message)", "CONNECT_FAILED")
            }
            guard self.generation == gen else {
                await room.disconnect()
                return call.reject("Screen share start superseded", "CANCELLED")
            }

            var next = Session(generation: gen, identity: identity, room: room, keyProvider: keyProvider,
                               keyIndex: initialKey?.index ?? 0, allowedIdentities: allowed, leaseSeconds: leaseSeconds)
            next.watchdogTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled, let self, let active = self.session,
                      active.generation == gen, !active.isBroadcasting else { return }
                self.log.info("Screen share picker timed out gen=\(gen, privacy: .public)")
                await self.teardown(expectedGeneration: gen, reason: "picker_timeout")
            }
            self.session = next
            do { try await self.applyPermissions() } catch {
                self.log.error("Failed to apply screen share permissions: \(error.localizedDescription, privacy: .public)")
                await self.teardown(expectedGeneration: gen, reason: "permissions_failed", detail: error.localizedDescription)
                return call.reject("Failed to apply screen share permissions", "PERMISSIONS_FAILED")
            }
            guard self.generation == gen, self.session?.generation == gen else {
                return call.reject("Screen share start superseded", "CANCELLED")
            }
            guard let presenter = self.topPresenter() else {
                if let active = self.session, active.generation == gen {
                    self.session = nil
                    active.watchdogTask?.cancel()
                    await active.room.disconnect()
                }
                return call.reject("Unable to present screen share picker", "UNAVAILABLE")
            }
            let sheet = BroadcastPickerSheetController(strings: strings) { [weak self] in
                guard let plugin = self else { return }
                Task { @MainActor [weak plugin] in
                    guard let plugin, let active = plugin.session,
                          active.generation == gen, !active.isBroadcasting else { return }
                    await plugin.teardown(expectedGeneration: gen, reason: "cancelled")
                }
            }
            self.pickerSheet = sheet
            presenter.present(sheet, animated: true)
            call.resolve(["generation": gen])
        }
    }

    @objc func setKey(_ call: CAPPluginCall) {
        guard let gen = call.getInt("generation"), let decoded = Self.decodeKey(call) else {
            return call.reject("Invalid key update payload", "INVALID")
        }
        Task { @MainActor [weak self] in
            guard let self, var active = self.session, active.generation == gen,
                  let provider = active.keyProvider else {
                return call.reject("No matching encrypted screen share session", "INVALID_STATE")
            }
            provider.setKey(keyData: decoded.data, participantId: active.identity, index: decoded.index)
            provider.setCurrentKeyIndex(decoded.index)
            active.keyIndex = decoded.index
            active.lastHeartbeatAt = Date()
            self.session = active
            call.resolve()
        }
    }

    @objc func updateAllowedParticipants(_ call: CAPPluginCall) {
        guard let gen = call.getInt("generation"),
              let identities = call.getArray("identities") as? [String] else {
            return call.reject("Invalid participants payload", "INVALID")
        }
        Task { @MainActor [weak self] in
            guard let self, var active = self.session, active.generation == gen else {
                return call.reject("No matching screen share session", "INVALID_STATE")
            }
            active.allowedIdentities = Set(identities)
            active.lastHeartbeatAt = Date()
            self.session = active
            do {
                try await self.applyPermissions()
                call.resolve()
            } catch {
                self.log.error("Failed to update screen share permissions: \(error.localizedDescription, privacy: .public)")
                await self.teardown(expectedGeneration: gen, reason: "permissions_failed", detail: error.localizedDescription)
                call.reject("Failed to update screen share permissions", "PERMISSIONS_FAILED")
            }
        }
    }

    @objc func heartbeat(_ call: CAPPluginCall) {
        guard let gen = call.getInt("generation") else { return call.reject("Missing generation", "INVALID") }
        Task { @MainActor [weak self] in
            guard let self, var active = self.session, active.generation == gen else {
                return call.reject("No matching screen share session", "INVALID_STATE")
            }
            let now = Date()
            let spacing = now.timeIntervalSince(active.lastHeartbeatAt)
            active.lastHeartbeatAt = now
            if now.timeIntervalSince(active.lastHeartbeatLogAt) >= 30 {
                active.lastHeartbeatLogAt = now
                self.log.info("Heartbeat gen=\(gen, privacy: .public) spacing=\(spacing, format: .fixed(precision: 1), privacy: .public)s broadcasting=\(active.isBroadcasting, privacy: .public) keyIndex=\(active.keyIndex, privacy: .public)")
            }
            self.session = active
            call.resolve([
                "broadcasting": active.isBroadcasting,
                "connected": active.room.connectionState == .connected,
                "keyIndex": Int(active.keyIndex),
            ])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self else { return call.resolve() }
            self.generation += 1
            await self.teardown(expectedGeneration: nil, reason: "user")
            BroadcastManager.shared.requestStop()
            call.resolve()
        }
    }

    @MainActor
    private func handleBroadcast(_ isBroadcasting: Bool) async {
        if isBroadcasting {
            guard var active = session else {
                log.info("Stopping system broadcast started outside a call")
                BroadcastManager.shared.requestStop()
                return
            }
            guard !active.isBroadcasting else { return }
            active.watchdogTask?.cancel()
            active.watchdogTask = nil
            session = active
            let gen = active.generation
            do { _ = try await active.room.localParticipant.setScreenShare(enabled: true) } catch {
                log.error("Failed to publish broadcast track: \(error.localizedDescription, privacy: .public)")
                await teardown(expectedGeneration: gen, reason: "publish_failed", detail: error.localizedDescription)
                return
            }
            guard var current = session, current.generation == gen else {
                BroadcastManager.shared.requestStop()
                return
            }
            guard BroadcastManager.shared.isBroadcasting else {
                await teardown(expectedGeneration: gen, reason: "system")
                return
            }
            current.isBroadcasting = true
            current.lastHeartbeatAt = Date()
            current.watchdogTask = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    guard !Task.isCancelled, let self, let live = self.session,
                          live.generation == gen, live.isBroadcasting else { return }
                    let elapsed = Date().timeIntervalSince(live.lastHeartbeatAt)
                    if elapsed > live.leaseSeconds {
                        self.log.error("Screen share lease expired after \(elapsed, format: .fixed(precision: 1), privacy: .public)s")
                        await self.teardown(expectedGeneration: gen, reason: "lease_expired")
                        return
                    }
                }
            }
            session = current
            dismissPickerSheet()
            notifyListeners("stateChange", data: ["generation": gen, "state": "broadcasting"])
        } else if let active = session, active.isBroadcasting {
            await teardown(expectedGeneration: active.generation, reason: "system")
        }
    }

    @MainActor
    private func applyPermissions() async throws {
        guard let active = session else { return }
        let permissions = active.room.remoteParticipants.values.compactMap { participant -> ParticipantTrackPermission? in
            guard let id = participant.identity?.stringValue, active.allowedIdentities.contains(id),
                  let sid = participant.sid?.stringValue else { return nil }
            return ParticipantTrackPermission(participantSid: sid, allTracksAllowed: true)
        }
        try await active.room.localParticipant.setTrackSubscriptionPermissions(
            allParticipantsAllowed: false, trackPermissions: permissions)
    }

    @MainActor
    private func topPresenter() -> UIViewController? {
        guard var top = bridge?.viewController else { return nil }
        while let presented = top.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }

    @MainActor
    private func dismissPickerSheet() {
        guard let sheet = pickerSheet else { return }
        pickerSheet = nil
        if let coordinator = sheet.transitionCoordinator, sheet.isBeingPresented {
            coordinator.animate(alongsideTransition: nil) { _ in Task { @MainActor in Self.dismissSheet(sheet) } }
        } else { Self.dismissSheet(sheet) }
    }

    @MainActor
    private static func dismissSheet(_ sheet: UIViewController) {
        guard !sheet.isBeingDismissed, let presenter = sheet.presentingViewController else { return }
        (presenter.presentedViewController === sheet ? presenter : sheet).dismiss(animated: true)
    }

    @MainActor
    private func teardown(expectedGeneration: Int?, reason: String, detail: String? = nil) async {
        guard let active = session else {
            if expectedGeneration == nil { dismissPickerSheet() }
            return
        }
        if let expectedGeneration, active.generation != expectedGeneration { return }
        session = nil
        dismissPickerSheet()
        active.watchdogTask?.cancel()
        if active.isBroadcasting || BroadcastManager.shared.isBroadcasting { BroadcastManager.shared.requestStop() }
        await active.room.disconnect()
        var payload: [String: Any] = ["generation": active.generation, "state": "stopped", "reason": reason]
        if let detail, !detail.isEmpty { payload["detail"] = detail }
        notifyListeners("stateChange", data: payload)
    }

    private func refreshPermissions(for room: Room) {
        Task { @MainActor [weak self] in
            guard let self, self.session?.room === room else { return }
            do { try await self.applyPermissions() } catch {
                self.log.error("Failed to refresh screen share permissions: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private static func decodeKey(_ call: CAPPluginCall) -> (data: Data, index: Int32)? {
        guard let b64 = nonEmpty(call.getString("keyBase64")),
              let data = Data(base64Encoded: b64), !data.isEmpty,
              let idx = call.getInt("keyIndex"), (0...255).contains(idx) else { return nil }
        return (data, Int32(idx))
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }
}

private struct SheetStrings: Sendable { let title, body, caption, cancel: String }

private final class BroadcastPickerSheetController: UIViewController, UIAdaptivePresentationControllerDelegate {
    private let strings: SheetStrings
    private let onCancel: @MainActor () -> Void
    private let pickerView = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    private var didAutoTrigger = false
    private var didReportCancel = false

    init(strings: SheetStrings, onCancel: @escaping @MainActor () -> Void) {
        self.strings = strings
        self.onCancel = onCancel
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        sheetPresentationController?.detents = [.medium()]
        sheetPresentationController?.prefersGrabberVisible = true
        presentationController?.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private static func makeLabel(_ text: String, font: UIFont, color: UIColor = .label) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = font
        label.textColor = color
        label.adjustsFontForContentSizeCategory = true
        label.textAlignment = .center
        label.numberOfLines = 0
        return label
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let titleLabel = Self.makeLabel(
            strings.title,
            font: UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: 22, weight: .bold)))
        let bodyLabel = Self.makeLabel(
            strings.body, font: .preferredFont(forTextStyle: .subheadline), color: .secondaryLabel)
        let captionLabel = Self.makeLabel(
            strings.caption, font: .preferredFont(forTextStyle: .footnote), color: .secondaryLabel)

        let backdrop = UIView()
        backdrop.translatesAutoresizingMaskIntoConstraints = false
        backdrop.backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor.white.withAlphaComponent(0.88)
                : UIColor.tintColor.withAlphaComponent(0.15)
        }
        backdrop.layer.cornerRadius = 36
        backdrop.clipsToBounds = true

        pickerView.preferredExtension = "chat.mindroom.app.broadcast"
        pickerView.showsMicrophoneButton = false
        pickerView.tintColor = .tintColor
        pickerView.translatesAutoresizingMaskIntoConstraints = false
        backdrop.addSubview(pickerView)

        var cancelConfig = UIButton.Configuration.plain()
        cancelConfig.title = strings.cancel
        let cancelButton = UIButton(
            configuration: cancelConfig, primaryAction: UIAction { [weak self] _ in self?.handleCancel() })

        let stack = UIStackView(arrangedSubviews: [titleLabel, bodyLabel, backdrop, captionLabel, cancelButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(24, after: bodyLabel)
        stack.setCustomSpacing(20, after: captionLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        let centerY = stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor)
        centerY.priority = .defaultHigh
        NSLayoutConstraint.activate([
            backdrop.widthAnchor.constraint(equalToConstant: 72),
            backdrop.heightAnchor.constraint(equalToConstant: 72),
            pickerView.centerXAnchor.constraint(equalTo: backdrop.centerXAnchor),
            pickerView.centerYAnchor.constraint(equalTo: backdrop.centerYAnchor),
            pickerView.widthAnchor.constraint(equalToConstant: 72),
            pickerView.heightAnchor.constraint(equalToConstant: 72),
            centerY,
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didAutoTrigger else { return }
        didAutoTrigger = true
        pickerView.subviews.compactMap { $0 as? UIButton }.first?.sendActions(for: .touchUpInside)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { reportCancelOnce() }

    private func handleCancel() { reportCancelOnce(); dismiss(animated: true) }

    private func reportCancelOnce() {
        guard !didReportCancel else { return }
        didReportCancel = true
        onCancel()
    }
}

extension MindRoomScreenSharePlugin: RoomDelegate {
    @objc public func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { refreshPermissions(for: room) }
    @objc public func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) { refreshPermissions(for: room) }
    @objc public func roomDidReconnect(_ room: Room) { refreshPermissions(for: room) }
    @objc public func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        let detail = error?.localizedDescription
        Task { @MainActor [weak self] in
            if let active = self?.session, active.room === room {
                await self?.teardown(expectedGeneration: active.generation, reason: "disconnected", detail: detail)
            }
        }
    }
}
#endif
