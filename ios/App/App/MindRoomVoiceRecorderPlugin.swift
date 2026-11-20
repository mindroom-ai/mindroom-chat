#if targetEnvironment(macCatalyst)
import Accelerate
import AVFoundation
import Capacitor

/// Records voice messages for the Mac app, whose WebKit has no media capture
/// (`src/app/native/nativeVoiceRecorder.ts`). Each recording has an ID and a file of its own, so a
/// late call for an earlier recording cannot touch the next one. Only `cancel` deletes a file: one
/// the page let go of (`keep`), never read, or left (killed, reloaded, closed) stays for `orphans`.
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
        CAPPluginMethod(name: "keep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "orphans", returnType: CAPPluginReturnPromise)
    ]

    /// Not the temp folder, which macOS may empty. Named as `MindRoomDiagnostics`: the Developer ID
    /// build is not sandboxed and shares Application Support with other apps.
    private static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MindRoomVoiceRecorder", isDirectory: true)
    }

    /// The file of a recording, named by its UUID as `UUID` writes it, so that one recording has one
    /// name also on a case-insensitive disk; nil for an ID that is not a UUID, so no ID names a path
    /// elsewhere.
    private static func file(of id: String) -> URL? {
        UUID(uuidString: id).map { folder.appendingPathComponent("\($0.uuidString).m4a") }
    }

    /// An exclusive lock on a recording (its `.lock` beside it), held from its start until the page
    /// lets go of it; nil while another window or process holds it. The kernel drops it when the
    /// process ends, so a file whose lock is free belongs to no one.
    private static func lock(_ id: String) -> Int32? {
        guard let url = file(of: id)?.deletingPathExtension().appendingPathExtension("lock") else { return nil }
        let fd = open(url.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { return nil }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(fd)
            return nil
        }
        return fd
    }

    /// A regular file, not a link.
    private static func isRegularFile(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0 && info.st_mode & S_IFMT == S_IFREG
    }

    /// Deletes a recording's file and then its lock, regular files only (call it holding the lock):
    /// true when both are gone.
    private static func delete(_ id: String) -> Bool {
        guard let url = file(of: id) else { return false }
        return [url, url.deletingPathExtension().appendingPathExtension("lock")].allSatisfy { item in
            var info = stat()
            guard lstat(item.path, &info) == 0 else { return errno == ENOENT }
            return info.st_mode & S_IFMT == S_IFREG && unlink(item.path) == 0
        }
    }

    private var live: Recording?
    /// The recordings this page holds, each with its lock: the live one, those ending, and those
    /// stopped for the page, until it cancels or keeps them, or goes.
    private var held: [String: Recording] = [:]
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
                        self.live.map(self.keep)
                        let id = UUID().uuidString
                        guard let url = Self.file(of: id) else {
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        let session = AVAudioSession.sharedInstance()
                        var lock: Int32?
                        do {
                            // Not `.record`: the session keeps its category afterwards, and the page
                            // must still play audio then.
                            try session.setCategory(.playAndRecord, mode: .default)
                            try session.setActive(true)
                            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                            lock = Self.lock(id)
                            guard let lock else { throw CocoaError(.fileWriteUnknown) }
                            // `live` is set only once it records, so a failed attempt cleans up here.
                            let recording = try Recording(id: id, url: url, lock: lock)
                            self.live = recording
                            self.held[id] = recording
                            // It ended by itself: the page learns it from its next call.
                            recording.onInterrupt = { [weak self, weak recording] in
                                if let self, let recording { self.endIfLive(recording) }
                            }
                        } catch {
                            _ = Self.delete(id)
                            if let lock { Darwin.close(lock) }
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
    /// here while the bridge queue adds and removes listeners. Rejects once the recording has ended,
    /// also by itself.
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
                endIfLive(live)
                live.finish { _ in }
                return call.reject("Could not resume", "NOT_RECORDING")
            }
            call.resolve()
        }
    }

    /// Ends the recording and resolves its path once the file is whole; the page reads it and then
    /// cancels or keeps it. A file that did not finish stays, held, for `keep`.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let live = self.live, live.id == call.getString("id") else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            endIfLive(live)
            live.finish { [self] written in
                guard held[live.id] === live else { return call.reject("The recording was canceled", "CANCELED") }
                guard written else { return call.reject("Could not finish the recording", "STOP_FAILED") }
                call.resolve(["path": live.url.path])
            }
        }
    }

    /// Deletes the recording of the given ID and no other: one this page holds once its file is
    /// written, an orphan only while no one else holds it. Resolves once the file is gone.
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let id = call.getString("id") ?? ""
            let settle = { (deleted: Bool) in
                deleted ? call.resolve() : call.reject("Could not delete the recording", "DELETE_FAILED")
            }
            if let recording = held.removeValue(forKey: id) {
                endIfLive(recording)
                recording.finish { _ in
                    let deleted = Self.delete(id)
                    recording.unlock()
                    settle(deleted)
                }
            } else if let lock = Self.lock(id) {
                let deleted = Self.delete(id)
                Darwin.close(lock)
                settle(deleted)
            } else {
                call.reject("The recording is held elsewhere", "BUSY")
            }
        }
    }

    /// Lets go of the recording of the given ID without deleting it: it stays for `orphans`.
    @objc func keep(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            held[call.getString("id") ?? ""].map(keep)
            call.resolve()
        }
    }

    /// The recordings no window or process holds: left by an app that was killed, a page that went,
    /// or a page that kept them. The files whose lock is free, named by their UUID, no links.
    @objc func orphans(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: Self.folder, includingPropertiesForKeys: [.creationDateKey]
            )) ?? []
            let recordings: [[String: Any]] = urls.compactMap { url in
                let id = url.deletingPathExtension().lastPathComponent
                guard Self.file(of: id)?.lastPathComponent == url.lastPathComponent, Self.isRegularFile(url),
                      let lock = Self.lock(id) else { return nil }
                Darwin.close(lock)
                let startedAt = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
                return ["id": id, "path": url.path, "startedAt": Int(startedAt.timeIntervalSince1970 * 1_000)]
            }
            call.resolve(["recordings": recordings])
        }
    }

    /// The live recording ends: the microphone goes now.
    private func endIfLive(_ recording: Recording) {
        guard live === recording else { return }
        live = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Lets go of a recording: it ends, and once its file is written its lock goes.
    private func keep(_ recording: Recording) {
        endIfLive(recording)
        held[recording.id] = nil
        recording.finish { _ in recording.unlock() }
    }

    /// The page is going, or its process ended (main queue): it records nothing more, its recordings
    /// stay on disk for the next page, and a start that waits on the prompt ends.
    @objc private func pageWillLoad() {
        generation += 1
        Array(held.values).forEach(keep)
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        closed = true
        pageWillLoad()
    }
}

/// One recording: the microphone through `AVAudioEngine` into an AAC `.m4a` that `AVAssetWriter`
/// writes in fragments of a second, so a killed app leaves a file that plays up to its last fragment.
/// It ends by itself when its device changes or is interrupted, or when the file cannot be written.
private final class Recording {
    let id: String
    let url: URL
    /// Called (main queue) once it ended by itself.
    var onInterrupt: (() -> Void)?
    private var lock: Int32
    private let engine = AVAudioEngine()
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var observers: [NSObjectProtocol] = []
    /// The appends, the level and the end, in turn.
    private let queue = DispatchQueue(label: "chat.mindroom.voice-recorder")
    /// The length written, the next buffer's time (queue): exact at any rate, and a pause leaves no
    /// gap.
    private var written = CMTime.zero
    /// Buffers the writer was not ready for yet, oldest first (queue).
    private var pending: [CMSampleBuffer] = []
    private var newestLevel: Float = 0
    /// It takes no more buffers (queue).
    private var ended = false
    /// Its end began (main queue).
    private var finishing = false
    /// Its file is written: true when whole (main queue).
    private var finished: Bool?
    private var waiters: [(Bool) -> Void] = []

    init(id: String, url: URL, lock: Int32) throws {
        self.id = id
        self.url = url
        self.lock = lock
        let node = engine.inputNode
        let format = node.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw CocoaError(.fileWriteUnknown) }
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
        node.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            self?.append(buffer)
        }
        do {
            try engine.start()
        } catch {
            node.removeTap(onBus: 0)
            writer.cancelWriting()
            throw error
        }
        // The engine stops on either: what is written stays, and the recording ends.
        observers = [
            (Notification.Name.AVAudioEngineConfigurationChange, engine as Any),
            (AVAudioSession.interruptionNotification, AVAudioSession.sharedInstance() as Any)
        ].map { name, object in
            NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
                self?.interrupt()
            }
        }
    }

    deinit {
        unlock()
    }

    /// The level of the newest buffer, linear from 0 to 1.
    var level: Float { queue.sync { newestLevel } }

    func pause() {
        engine.pause()
    }

    func resume() -> Bool {
        !finishing && (try? engine.start()) != nil
    }

    /// Releases the microphone at once, then calls `done` (main queue) with whether the file was
    /// finished whole, once it is written: at once when it already is.
    func finish(then done: @escaping (Bool) -> Void) {
        if let finished { return done(finished) }
        waiters.append(done)
        guard !finishing else { return }
        finishing = true
        observers.forEach(NotificationCenter.default.removeObserver)
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        queue.async { [self] in
            ended = true
            // The writer takes what it was not ready for yet, within about 2 s.
            var waits = 0
            while !pending.isEmpty, drain(), waits < 200 {
                usleep(10_000)
                waits += 1
            }
            guard pending.isEmpty, writer.status == .writing else { return settle(false) }
            input.markAsFinished()
            writer.finishWriting { [self] in settle(writer.status == .completed) }
        }
    }

    func unlock() {
        guard lock >= 0 else { return }
        Darwin.close(lock)
        lock = -1
    }

    private func settle(_ whole: Bool) {
        DispatchQueue.main.async { [self] in
            finished = whole
            waiters.forEach { $0(whole) }
            waiters = []
        }
    }

    /// It ended by itself (main queue).
    private func interrupt() {
        guard !finishing else { return }
        finish { _ in }
        onInterrupt?()
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
                duration: CMTime(value: 1, timescale: rate), presentationTimeStamp: written, decodeTimeStamp: .invalid
            )
            var sample: CMSampleBuffer?
            guard CMSampleBufferCreate(
                      allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
                      makeDataReadyCallback: nil, refcon: nil, formatDescription: buffer.format.formatDescription,
                      sampleCount: CMItemCount(buffer.frameLength), sampleTimingEntryCount: 1,
                      sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
                      sampleBufferOut: &sample
                  ) == noErr, let sample,
                  CMSampleBufferSetDataBufferFromAudioBufferList(
                      sample, blockBufferAllocator: kCFAllocatorDefault,
                      blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0, bufferList: buffer.audioBufferList
                  ) == noErr else { return fail() }
            written = CMTimeAdd(written, CMTime(value: CMTimeValue(buffer.frameLength), timescale: rate))
            pending.append(sample)
            // About 5 s of buffers the writer was not ready for: it is not keeping up.
            guard drain(), pending.count <= 64 else { return fail() }
        }
    }

    /// Appends the pending buffers while the writer is ready for them (queue): false once it fails.
    private func drain() -> Bool {
        while let sample = pending.first, input.isReadyForMoreMediaData {
            guard input.append(sample) else { return false }
            pending.removeFirst()
        }
        return writer.status == .writing
    }

    /// The file cannot be written on (queue): what is written stays, and the recording ends.
    private func fail() {
        ended = true
        DispatchQueue.main.async { [self] in interrupt() }
    }
}
#endif
