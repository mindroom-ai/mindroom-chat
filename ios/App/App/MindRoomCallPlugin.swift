#if targetEnvironment(macCatalyst)
import AVFoundation
import Capacitor
import LiveKit

/// Carries a call's audio for the Mac app, whose WebKit has no WebRTC
/// (`src/app/calls/nativeCallMedia.ts`). Membership and media keys stay with the page. A session
/// belongs to the page that started it and ends with it.
@objc(MindRoomCallPlugin)
public class MindRoomCallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomCallPlugin"
    public let jsName = "MindRoomCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMembers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSound", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMicrophone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise)
    ]

    /// The sessions live in the app (main queue): the voice recorder leaves the audio session
    /// alone meanwhile.
    static private(set) var liveSessions = 0

    private final class Session {
        let id = UUID().uuidString
        let room: Room
        let keyProvider: BaseKeyProvider?
        /// The media identities of the call's members; nobody until the page names them.
        var members = Set<String>()
        var sound = true

        init(room: Room, keyProvider: BaseKeyProvider?) {
            self.room = room
            self.keyProvider = keyProvider
        }
    }

    /// Tells the plugin that who is in the room, or what they publish, changed.
    private final class Events: NSObject, RoomDelegate, @unchecked Sendable {
        weak var plugin: MindRoomCallPlugin?

        func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { plugin?.roomChanged(room) }
        func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) { plugin?.roomChanged(room) }
        func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) { plugin?.roomChanged(room) }
        func roomDidReconnect(_ room: Room) { plugin?.roomChanged(room) }
    }

    private let events = Events()
    private var live: Session?
    /// Its window closed: it connects nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one connects nothing.
    private var generation = 0
    /// LiveKit's calls, one after another in the order the page made them.
    private var chain = Task<Void, Never> {}

    override public func load() {
        events.plugin = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewNavigationStarted,
            object: bridge?.webView
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewTerminated,
            object: bridge?.webView
        )
    }

    private func enqueue(_ work: @escaping () async -> Void) {
        let previous = chain
        chain = Task {
            await previous.value
            await work()
        }
    }

    /// The live session a call names, or a rejection (main queue).
    private func session(_ call: CAPPluginCall) -> Session? {
        guard let live, live.id == call.getString("id") else {
            call.reject("No such call", "NOT_CONNECTED")
            return nil
        }
        return live
    }

    /// The one way out (main queue): a leave, a page load, a closed window, a newer start and a
    /// failed connect all end the session here. The SDK deactivates the audio session once its
    /// engine has stopped.
    private func endLive() {
        guard let session = live else { return }
        live = nil
        Self.liveSessions -= 1
        enqueue { await session.room.disconnect() }
    }

    fileprivate func roomChanged(_ room: Room) {
        DispatchQueue.main.async {
            guard let session = self.live, session.room === room else { return }
            self.apply(session)
        }
    }

    /// Only the call's members are subscribed to and may subscribe to this device's tracks, and
    /// they are heard while sound is on (main queue).
    private func apply(_ session: Session) {
        let room = session.room
        var permissions = [ParticipantTrackPermission]()
        var subscriptions = [(RemoteTrackPublication, Bool)]()
        var volumes = [(RemoteAudioTrack, Double)]()
        for participant in room.remoteParticipants.values {
            let member = participant.identity.map { session.members.contains($0.stringValue) } ?? false
            if member, let sid = participant.sid?.stringValue {
                permissions.append(ParticipantTrackPermission(participantSid: sid, allTracksAllowed: true))
            }
            for publication in participant.audioTracks {
                guard let remote = publication as? RemoteTrackPublication else { continue }
                if remote.isSubscribed != member { subscriptions.append((remote, member)) }
                if let track = remote.track as? RemoteAudioTrack {
                    volumes.append((track, session.sound ? 1 : 0))
                }
            }
        }
        enqueue {
            for (publication, subscribed) in subscriptions {
                try? await publication.set(subscribed: subscribed)
            }
            volumes.forEach { $0.0.volume = $0.1 }
            try? await room.localParticipant.setTrackSubscriptionPermissions(
                allParticipantsAllowed: false, trackPermissions: permissions
            )
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // A closed or loading page connects nothing.
            guard !self.closed, let webView = self.bridge?.webView, !webView.isLoading,
                  let nonce = call.getString("nonce"), let url = call.getString("url"),
                  let token = call.getString("token") else {
                return call.reject("The page is gone", "START_FAILED")
            }
            let generation = self.generation
            // The page names its newest start, and the page loaded now is asked for it: an older
            // start of this page, and a start of a page since replaced, connect nothing.
            webView.evaluateJavaScript("window.mindroomCallStart") { newest, _ in
                guard generation == self.generation, !self.closed, !webView.isLoading,
                      (newest as? String) == nonce else {
                    return call.reject("The page is gone", "START_FAILED")
                }
                self.endLive()
                var keyProvider: BaseKeyProvider?
                if call.getBool("encrypted") == true {
                    // As the web client and MindRoom's agents key frames (callKeyProvider.ts).
                    keyProvider = BaseKeyProvider(options: KeyProviderOptions(
                        sharedKey: false, ratchetWindowSize: 10, failureTolerance: 10,
                        keyRingSize: 256, keyDerivationAlgorithm: .hkdf
                    ))
                }
                let options = keyProvider.map {
                    RoomOptions(encryptionOptions: EncryptionOptions(keyProvider: $0, encryptionType: .gcm))
                } ?? RoomOptions()
                // Nothing is subscribed to until the page names the call's members.
                let room = Room(
                    delegate: self.events, connectOptions: ConnectOptions(autoSubscribe: false),
                    roomOptions: options
                )
                let session = Session(room: room, keyProvider: keyProvider)
                self.live = session
                Self.liveSessions += 1
                self.enqueue {
                    do {
                        try await room.connect(url: url, token: token)
                    } catch {
                        DispatchQueue.main.async {
                            if self.live === session { self.endLive() }
                            call.reject("Could not connect the call", "CONNECT_FAILED")
                        }
                        return
                    }
                    DispatchQueue.main.async {
                        // A page load, a closed window or a newer start ended it meanwhile.
                        guard self.live === session else {
                            return call.reject("The page is gone", "START_FAILED")
                        }
                        call.resolve(["id": session.id])
                    }
                }
            }
        }
    }

    @objc func setKey(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            guard let identity = call.getString("identity"), let index = call.getInt("index"),
                  let key = call.getString("key").flatMap({ Data(base64Encoded: $0) }) else {
                return call.reject("Not a key", "BAD_KEY")
            }
            session.keyProvider?.setKey(keyData: key, participantId: identity, index: Int32(index))
            if call.getBool("own") == true {
                session.keyProvider?.setCurrentKeyIndex(Int32(index))
            }
            call.resolve()
        }
    }

    @objc func setMembers(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            session.members = Set(call.getArray("identities", String.self) ?? [])
            self.apply(session)
            call.resolve()
        }
    }

    @objc func setSound(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            session.sound = call.getBool("on") ?? true
            self.apply(session)
            call.resolve()
        }
    }

    @objc func setMicrophone(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            let on = call.getBool("on") ?? false
            let publish = {
                self.enqueue {
                    do {
                        try await session.room.localParticipant.setMicrophone(enabled: on)
                        call.resolve()
                    } catch {
                        call.reject("The microphone could not be used", "MICROPHONE_FAILED")
                    }
                }
            }
            guard on else { return publish() }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    // A page load, a closed window, a leave or a newer start under the prompt.
                    guard self.live === session else {
                        return call.reject("No such call", "NOT_CONNECTED")
                    }
                    guard granted else {
                        return call.reject("Microphone access is denied", "PERMISSION_DENIED")
                    }
                    guard AVCaptureDevice.default(for: .audio) != nil else {
                        return call.reject("No microphone", "NO_MICROPHONE")
                    }
                    publish()
                }
            }
        }
    }

    /// The call as it is now. The page asks at its own pace: a listener would be notified here
    /// while the bridge queue adds and removes listeners.
    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            let room = session.room
            let state: String
            switch room.connectionState {
            case .connected: state = "connected"
            case .reconnecting: state = "reconnecting"
            case .connecting: state = "connecting"
            default: state = "disconnected"
            }
            let participants: [[String: Any]] = room.remoteParticipants.values.compactMap { participant in
                guard let identity = participant.identity?.stringValue else { return nil }
                return [
                    "identity": identity, "speaking": participant.isSpeaking,
                    "microphone": participant.isMicrophoneEnabled()
                ]
            }
            call.resolve([
                "state": state,
                "local": [
                    "speaking": room.localParticipant.isSpeaking,
                    "microphone": room.localParticipant.isMicrophoneEnabled()
                ],
                "participants": participants
            ])
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.live?.id == call.getString("id") { self.endLive() }
            call.resolve()
        }
    }

    /// The page is going, or its process ended (main queue): its call ends, and a start or a
    /// microphone prompt still on its way connects nothing.
    @objc private func pageWillLoad() {
        generation += 1
        endLive()
    }

    /// The window closed (main queue), for good.
    func close() {
        closed = true
        pageWillLoad()
    }
}
#endif
