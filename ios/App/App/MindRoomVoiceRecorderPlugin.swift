#if targetEnvironment(macCatalyst)
import Accelerate
import AVFoundation
import Capacitor

/// Records voice messages for the Mac app, whose WebKit has no media capture
/// (`src/app/native/nativeVoiceRecorder.ts`). Each recording has an ID and a file of its own, so a
/// late call for an earlier recording cannot touch the next one. Only `cancel` deletes a file: one
/// the page never read (the app killed, the page reloaded, the window closed) stays for `orphans`.
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
        CAPPluginMethod(name: "orphans", returnType: CAPPluginReturnPromise)
    ]

    /// Not the temp folder, which macOS may empty. Named as `MindRoomDiagnostics`: the Developer ID
    /// build is not sandboxed and shares Application Support with other apps.
    private static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MindRoomVoiceRecorder", isDirectory: true)
    }

    /// The file of a recording; nil for an ID that is not a UUID, so no ID names a path elsewhere.
    private static func file(of id: String) -> URL? {
        UUID(uuidString: id) == nil ? nil : folder.appendingPathComponent("\(id).m4a")
    }

    private var live: Recording?
    /// The recordings whose file is still written, the live one and those ending.
    private var writing: Set<String> = []
    /// The recordings stopped for the loaded page, which reads each and then cancels it.
    private var delivered: Set<String> = []
    /// Its window closed: it records nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one records nothing.
    private var generation = 0

    override public func load() {
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
                        self.endLive()
                        let id = UUID().uuidString
                        guard let url = Self.file(of: id) else {
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        let session = AVAudioSession.sharedInstance()
                        do {
                            // Not `.record`: the session keeps its category afterwards, and the page
                            // must still play audio then.
                            try session.setCategory(.playAndRecord, mode: .default)
                            try session.setActive(true)
                            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                            // `live` is set only once it records, so a failed attempt cleans up here.
                            self.live = try Recording(id: id, url: url)
                            self.writing.insert(id)
                        } catch {
                            try? FileManager.default.removeItem(at: url)
                            try? session.setActive(false, options: .notifyOthersOnDeactivation)
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
            call.resolve(["level": live.level])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            live.pause()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            guard live.resume() else {
                endLive()
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
            delivered.insert(live.id)
            endLive { call.resolve(["path": $0.url.path]) }
        }
    }

    /// Deletes the recording of the given ID, live or stopped, and no other.
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let id = call.getString("id") ?? ""
            delivered.remove(id)
            if live?.id == id {
                endLive { try? FileManager.default.removeItem(at: $0.url) }
            } else if let url = Self.file(of: id) {
                try? FileManager.default.removeItem(at: url)
            }
            call.resolve()
        }
    }

    /// The recordings left behind, by an app that was killed, a page that reloaded or a window that
    /// closed: the files no recorder writes and the loaded page was not handed.
    @objc func orphans(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: Self.folder, includingPropertiesForKeys: [.creationDateKey]
            )) ?? []
            let recordings: [[String: Any]] = urls.compactMap { url in
                let id = url.deletingPathExtension().lastPathComponent
                guard Self.file(of: id)?.lastPathComponent == url.lastPathComponent,
                      !writing.contains(id), !delivered.contains(id) else { return nil }
                let startedAt = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
                return ["id": id, "path": url.path, "startedAt": Int(startedAt.timeIntervalSince1970 * 1_000)]
            }
            call.resolve(["recordings": recordings])
        }
    }

    /// Ends the live recording: the microphone at once, then its file, after which `done` runs
    /// (main queue).
    private func endLive(then done: @escaping (Recording) -> Void = { _ in }) {
        guard let live else { return }
        self.live = nil
        live.finish {
            DispatchQueue.main.async { [self] in
                writing.remove(live.id)
                done(live)
            }
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// The page is going, or its process ended (main queue): it records nothing more, its live
    /// recording stays on disk for the next page, and a start that waits on the prompt ends.
    @objc private func pageWillLoad() {
        generation += 1
        delivered.removeAll()
        endLive()
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        closed = true
        pageWillLoad()
    }
}

/// One recording: the microphone through `AVAudioEngine` into an AAC `.m4a` that `AVAssetWriter`
/// writes in fragments of a second, so a killed app leaves a file that plays up to its last fragment.
private final class Recording {
    let id: String
    let url: URL
    private let engine = AVAudioEngine()
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    /// The appends, the level and the end, in turn.
    private let queue = DispatchQueue(label: "chat.mindroom.voice-recorder")
    /// The frames written, the next buffer's time: a pause leaves no gap.
    private var frames: AVAudioFramePosition = 0
    private var newestLevel: Float = 0
    private var ended = false

    init(id: String, url: URL) throws {
        self.id = id
        self.url = url
        writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
        writer.movieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 600)
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw CocoaError(.fileWriteUnknown) }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? CocoaError(.fileWriteUnknown) }
        writer.startSession(atSourceTime: .zero)
        let node = engine.inputNode
        node.installTap(onBus: 0, bufferSize: 4_096, format: node.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            self?.append(buffer)
        }
        do {
            try engine.start()
        } catch {
            node.removeTap(onBus: 0)
            writer.cancelWriting()
            throw error
        }
    }

    /// The level of the newest buffer, linear from 0 to 1.
    var level: Float { queue.sync { newestLevel } }

    func pause() {
        engine.pause()
    }

    func resume() -> Bool {
        (try? engine.start()) != nil
    }

    /// Releases the microphone at once and finishes the file, then calls `done`.
    func finish(then done: @escaping () -> Void) {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        queue.async { [self] in
            ended = true
            guard writer.status == .writing else { return done() }
            input.markAsFinished()
            writer.finishWriting(completionHandler: done)
        }
    }

    private func append(_ buffer: AVAudioPCMBuffer) {
        queue.sync {
            guard !ended else { return }
            if let samples = buffer.floatChannelData?[0] {
                var rms: Float = 0
                vDSP_rmsqv(samples, 1, &rms, vDSP_Length(buffer.frameLength))
                newestLevel = min(rms, 1)
            }
            // The engine reuses its buffer: the sample buffer holds a copy of the samples.
            let rate = CMTimeScale(buffer.format.sampleRate)
            var timing = CMSampleTimingInfo(
                duration: CMTime(value: 1, timescale: rate),
                presentationTimeStamp: CMTime(value: frames, timescale: rate), decodeTimeStamp: .invalid
            )
            var sample: CMSampleBuffer?
            guard writer.status == .writing, input.isReadyForMoreMediaData,
                  CMSampleBufferCreate(
                      allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
                      makeDataReadyCallback: nil, refcon: nil, formatDescription: buffer.format.formatDescription,
                      sampleCount: CMItemCount(buffer.frameLength), sampleTimingEntryCount: 1,
                      sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
                      sampleBufferOut: &sample
                  ) == noErr, let sample,
                  CMSampleBufferSetDataBufferFromAudioBufferList(
                      sample, blockBufferAllocator: kCFAllocatorDefault,
                      blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0, bufferList: buffer.audioBufferList
                  ) == noErr,
                  input.append(sample) else { return }
            frames += AVAudioFramePosition(buffer.frameLength)
        }
    }
}
#endif
