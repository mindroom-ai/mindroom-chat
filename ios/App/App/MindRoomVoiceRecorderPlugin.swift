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
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("voice-recorder")
    }

    private static func clearFolder() {
        try? FileManager.default.removeItem(at: folder)
    }

    /// The file of a recording; nil for an ID that is not a UUID, so no ID names a path elsewhere.
    private static func file(of id: String) -> URL? {
        UUID(uuidString: id) == nil ? nil : folder.appendingPathComponent("\(id).m4a")
    }

    private var live: (id: String, recorder: AVAudioRecorder)?
    /// The audio session's settings before a recording took it.
    private var sessionBefore: (
        category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions
    )?
    /// Its window closed: it records nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one records nothing.
    private var generation = 0

    override public func load() {
        // A recording left behind when the app quit.
        Self.clearFolder()
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
                        guard let url = Self.file(of: id) else {
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        let session = AVAudioSession.sharedInstance()
                        // `live` is set only once it records, so a failed attempt cleans up from here.
                        var attempt: AVAudioRecorder?
                        do {
                            self.sessionBefore = (session.category, session.mode, session.categoryOptions)
                            try session.setCategory(.record, mode: .default)
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
                        } catch {
                            attempt?.stop()
                            try? FileManager.default.removeItem(at: url)
                            self.releaseAudioSession()
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
            live.recorder.stop()
            releaseAudioSession()
            self.live = nil
            call.resolve(["path": live.recorder.url.path])
        }
    }

    /// Deletes the recording of the given ID, live or stopped, and no other.
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let id = call.getString("id") ?? ""
            if live?.id == id {
                discardLive()
            } else if let url = Self.file(of: id) {
                try? FileManager.default.removeItem(at: url)
            }
            call.resolve()
        }
    }

    private func discardLive() {
        guard let live else { return }
        self.live = nil
        live.recorder.stop()
        live.recorder.deleteRecording()
        releaseAudioSession()
    }

    /// Ends the recording's audio session and gives it back its settings: left in the record
    /// category, it would keep the page's audio silent.
    private func releaseAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        if let before = sessionBefore {
            try? session.setCategory(before.category, mode: before.mode, options: before.options)
        }
        sessionBefore = nil
    }

    /// The page is going, or its process ended (main queue): nothing of it records or stays on
    /// disk, and a start that waits on the prompt ends.
    @objc private func pageWillLoad() {
        generation += 1
        discardLive()
        Self.clearFolder()
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        closed = true
        pageWillLoad()
    }
}
#endif
