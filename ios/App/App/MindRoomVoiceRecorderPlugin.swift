#if targetEnvironment(macCatalyst)
import AVFoundation
import Capacitor

/// Records voice messages for the Mac app, whose WebKit has no media capture
/// (`src/app/native/nativeVoiceRecorder.ts`). Each recording has an ID and a file of its own, so a
/// late call for an earlier recording cannot touch the next one.
@objc(MindRoomVoiceRecorderPlugin)
public class MindRoomVoiceRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomVoiceRecorderPlugin"
    public let jsName = "MindRoomVoiceRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "level", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listLeftovers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    // Shared by the windows on the main queue; nothing survives app restart.
    private static var liveRecorders: [String: MindRoomVoiceRecorderPlugin] = [:]
    private static var owners: [String: String] = [:]
    private static var ownerGenerations: [String: Int] = [:]
    private static var instances = 0

    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("voice-recorder")
    }

    private static func clearFolder() {
        try? FileManager.default.removeItem(at: folder)
        owners.removeAll()
    }

    private static func removeFile(_ id: String) throws {
        guard let url = file(of: id) else { return }
        do { try FileManager.default.removeItem(at: url) }
        catch CocoaError.fileNoSuchFile { /* Already removed. */ }
        owners[id] = nil
    }

    /// The file of a recording; nil for an ID that is not a UUID, so no ID names a path elsewhere.
    private static func file(of id: String) -> URL? {
        UUID(uuidString: id) == nil ? nil : folder.appendingPathComponent("\(id).m4a")
    }

    private var live: (id: String, recorder: AVAudioRecorder)?
    /// Its window closed: it records nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one records nothing.
    private var generation = 0

    override public func load() {
        // A recording left behind when the app quit.
        if Self.instances == 0 { Self.clearFolder() }
        Self.instances += 1
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewNavigationStarted,
            object: bridge?.webView
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewTerminated,
            object: bridge?.webView
        )
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // A closed or loading page is not asked for the microphone.
            guard !self.closed, let webView = self.bridge?.webView, !webView.isLoading else {
                return call.reject("The page is gone", "START_FAILED")
            }
            guard let userId = call.getString("userId"), !userId.isEmpty else {
                return call.reject("No recording owner", "START_FAILED")
            }
            let ownerGeneration = Self.ownerGenerations[userId, default: 0]
            let generation = self.generation
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    // The page names its newest start, and the page loaded now, after the prompt, is
                    // asked for it: an older start of this page, a start of a page that has been
                    // replaced or is being replaced, one under which a page load began (also one
                    // that failed and left the page), and one of a closed window record nothing.
                    webView.evaluateJavaScript("window.mindroomVoiceStart") { newest, _ in
                        guard generation == self.generation, !self.closed, !webView.isLoading,
                              ownerGeneration == Self.ownerGenerations[userId, default: 0],
                              let newest = newest as? String, newest == call.getString("nonce") else {
                            return call.reject("The page is gone", "START_FAILED")
                        }
                        guard granted else { return call.reject("Microphone access is denied", "PERMISSION_DENIED") }
                        guard AVCaptureDevice.default(for: .audio) != nil else {
                            return call.reject("No microphone", "NO_MICROPHONE")
                        }
                        self.discardLive()
                        let id = UUID().uuidString
                        guard let url = Self.file(of: id) else {
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        let session = AVAudioSession.sharedInstance()
                        // `live` is set only once it records, so a failed attempt cleans up from here.
                        var attempt: AVAudioRecorder?
                        do {
                            // Not `.record`: the session keeps its category afterwards, and the page
                            // must still play audio then.
                            try session.setCategory(.playAndRecord, mode: .default)
                            try session.setActive(true)
                            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                            let recorder = try AVAudioRecorder(url: url, settings: [
                                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
                                AVEncoderBitRateKey: 32_000
                            ])
                            attempt = recorder
                            recorder.isMeteringEnabled = true
                            guard recorder.record() else { throw CocoaError(.fileWriteUnknown) }
                            self.live = (id, recorder)
                            Self.liveRecorders[id] = self
                            Self.owners[id] = userId
                        } catch {
                            attempt?.stop()
                            try? FileManager.default.removeItem(at: url)
                            Self.deactivateIfIdle()
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        call.resolve(["id": id])
                    }
                }
            }
        }
    }

    /// The linear level now, 0 to 1. The page asks at its own pace: a listener would be notified
    /// here while the bridge queue adds and removes listeners.
    @objc func level(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            live.recorder.updateMeters()
            call.resolve(["level": pow(10, live.recorder.averagePower(forChannel: 0) / 20)])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            live.recorder.pause()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            guard live.recorder.record() else {
                discardLive()
                return call.reject("Could not resume", "NOT_RECORDING")
            }
            call.resolve()
        }
    }

    /// Ends the recording and keeps its file, which the page reads and then cancels.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            finishLive()
            call.resolve(["path": live.recorder.url.path])
        }
    }

    /// Deletes the recording of the given ID, live or stopped, and no other.
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let id = call.getString("id") ?? ""
            guard Self.liveRecorders[id] == nil || Self.liveRecorders[id] === self else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            if live?.id == id {
                finishLive()
                // Explicit live discard is not a handoff. Never offer this file even if removal fails.
                Self.owners[id] = nil
            }
            do { try Self.removeFile(id) }
            catch { return call.reject("Could not remove recording", "CANCEL_FAILED") }
            call.resolve()
        }
    }

    /// Lists files without removing them. The new page cancels each file after saving its audio.
    @objc func listLeftovers(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let recordings: [[String: Any]] = Self.owners.compactMap { id, userId in
                guard Self.liveRecorders[id] == nil, let url = Self.file(of: id),
                      let start = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate,
                      let player = try? AVAudioPlayer(contentsOf: url), player.duration > 0 else { return nil }
                return ["id": id, "path": url.path, "startedAt": (start.timeIntervalSince1970 * 1_000).rounded(),
                        "duration": player.duration * 1_000, "userId": userId]
            }
            call.resolve(["recordings": recordings])
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let userId = call.getString("userId") else { return call.resolve() }
            Self.ownerGenerations[userId, default: 0] += 1
            for id in Self.owners.filter({ $0.value == userId }).keys {
                Self.liveRecorders[id]?.finishLive()
                Self.owners[id] = nil
                try? Self.removeFile(id)
            }
            if Self.owners.isEmpty { Self.clearFolder() }
            call.resolve()
        }
    }

    private static func deactivateIfIdle() {
        if liveRecorders.isEmpty {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func finishLive() {
        guard let live else { return }
        live.recorder.stop()
        self.live = nil
        Self.liveRecorders.removeValue(forKey: live.id)
        Self.deactivateIfIdle()
    }

    private func discardLive() {
        guard let id = live?.id else { return }
        finishLive()
        Self.owners[id] = nil
        try? Self.removeFile(id)
    }

    /// Navigation or WebContent termination ends the capture, not its file. A start still
    /// waiting for permission belongs to the old page and must not record.
    @objc private func pageWillLoad() {
        generation += 1
        finishLive()
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        guard !closed else { return }
        closed = true
        discardLive()
        Self.instances -= 1
        if Self.instances == 0 { Self.clearFolder() }
    }
}
#endif
