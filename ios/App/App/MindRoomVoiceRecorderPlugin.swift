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
    private var meter: Timer?
    /// The page this plugin serves; raised when it goes away, so that an answer to its
    /// microphone prompt records nothing.
    private var epoch = 0

    override public func load() {
        // A recording left behind when the app quit.
        Self.clearFolder()
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewNavigationStarted,
            object: bridge?.webView
        )
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let epoch = self.epoch
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    guard epoch == self.epoch else { return call.reject("The page is gone", "START_FAILED") }
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
                        try? session.setActive(false, options: .notifyOthersOnDeactivation)
                        return call.reject("Could not start recording", "START_FAILED")
                    }
                    self.meter = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                        guard let self, let recorder = self.live?.recorder, recorder.isRecording else { return }
                        recorder.updateMeters()
                        let level = pow(10, recorder.averagePower(forChannel: 0) / 20)
                        self.notifyListeners("level", data: ["level": level])
                    }
                    call.resolve(["id": id])
                }
            }
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
            meter?.invalidate()
            meter = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
        meter?.invalidate()
        meter = nil
        guard let live else { return }
        self.live = nil
        live.recorder.stop()
        live.recorder.deleteRecording()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// The page is gone (main queue): nothing of it records or stays on disk.
    func cancelRecording() {
        epoch += 1
        discardLive()
        Self.clearFolder()
    }

    @objc private func pageWillLoad() {
        cancelRecording()
    }
}
#endif
