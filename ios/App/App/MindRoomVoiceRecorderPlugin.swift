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

    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("voice-recorder")
    }

    private func removeFile(_ id: String) throws {
        guard owners[id] != nil else { return }
        if live?.id == id { finishLive() }
        do { try FileManager.default.removeItem(at: Self.file(of: id)) }
        catch CocoaError.fileNoSuchFile { /* Already removed. */ }
        owners[id] = nil
    }

    // Called only with a UUID generated here or looked up in owners.
    private static func file(of id: String) -> URL { folder.appendingPathComponent("\(id).m4a") }

    private var owners: [String: (userId: String, recoverable: Bool)] = [:]
    private var pendingOwner: String?
    private var live: (id: String, recorder: AVAudioRecorder)?
    /// Its window closed: it records nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one records nothing.
    private var generation = 0

    override public func load() {
        // A recording left behind when the app quit.
        try? FileManager.default.removeItem(at: Self.folder)
        let pageEvents: [Notification.Name] = [.capacitorWebViewNavigationStarted, .capacitorWebViewTerminated]
        for name in pageEvents {
            NotificationCenter.default.addObserver(self, selector: #selector(pageWillLoad), name: name, object: bridge?.webView)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // A closed or loading page is not asked for the microphone.
            guard !self.closed, let webView = self.bridge?.webView, !webView.isLoading,
                  let userId = call.getString("userId"), !userId.isEmpty else {
                return call.reject("Could not start recording", "START_FAILED")
            }
            self.pendingOwner = userId
            let generation = self.generation
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    // The page names its newest start, and the page loaded now, after the prompt, is
                    // asked for it: an older start of this page, a start of a page that has been
                    // replaced or is being replaced, one under which a page load began (also one
                    // that failed and left the page), and one of a closed window record nothing.
                    webView.evaluateJavaScript("window.mindroomVoiceStart") { newest, _ in
                        guard generation == self.generation, !self.closed, !webView.isLoading,
                              let newest = newest as? String, newest == call.getString("nonce") else {
                            return call.reject("The page is gone", "START_FAILED")
                        }
                        guard granted else { return call.reject("Microphone access is denied", "PERMISSION_DENIED") }
                        guard AVCaptureDevice.default(for: .audio) != nil else {
                            return call.reject("No microphone", "NO_MICROPHONE")
                        }
                        self.discardLive()
                        let id = UUID().uuidString
                        let url = Self.file(of: id)
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
                            self.owners[id] = (userId, false)
                        } catch {
                            attempt?.stop()
                            try? FileManager.default.removeItem(at: url)
                            Self.deactivateAudio()
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
                finishLive()
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
            do { try removeFile(id) }
            catch { return call.reject("Could not remove recording", "CANCEL_FAILED") }
            call.resolve()
        }
    }

    /// Lists files without removing them. The new page cancels each file after saving its audio.
    @objc func listLeftovers(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let recordings: [[String: Any]] = owners.compactMap { id, owner in
                let url = Self.file(of: id)
                guard owner.recoverable, id != live?.id,
                      let start = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate,
                      let player = try? AVAudioPlayer(contentsOf: url), player.duration > 0 else { return nil }
                return ["id": id, "path": url.path, "startedAt": (start.timeIntervalSince1970 * 1_000).rounded(),
                        "duration": player.duration * 1_000, "userId": owner.userId]
            }
            call.resolve(["recordings": recordings])
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let userId = call.getString("userId"), !userId.isEmpty else {
                return call.reject("Missing recording owner", "CLEAR_FAILED")
            }
            if pendingOwner == userId { generation += 1 }
            var failed = false
            for (id, owner) in owners where owner.userId == userId {
                do { try removeFile(id) }
                catch { failed = true }
            }
            if failed { return call.reject("Could not remove recordings", "CLEAR_FAILED") }
            call.resolve()
        }
    }

    private static func deactivateAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func finishLive() {
        guard let live else { return }
        live.recorder.stop()
        self.live = nil
        Self.deactivateAudio()
    }

    private func discardLive() {
        if let id = live?.id { try? removeFile(id) }
    }

    /// Navigation or WebContent termination ends the capture, not its file. A start still
    /// waiting for permission belongs to the old page and must not record.
    @objc private func pageWillLoad() {
        generation += 1
        let id = live?.id
        finishLive()
        if let id { owners[id]?.recoverable = true }
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        guard !closed else { return }
        closed = true
        finishLive()
        try? FileManager.default.removeItem(at: Self.folder)
        owners.removeAll()
    }
}
#endif
