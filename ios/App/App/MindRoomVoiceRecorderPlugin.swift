#if targetEnvironment(macCatalyst)
import Accelerate
import AVFoundation
import Capacitor

/// Records voice messages for the Mac app, whose WebKit has no media capture
/// (`src/app/native/nativeVoiceRecorder.ts`). Each recording has an ID and a file of its own, so a
/// late call for an earlier recording cannot touch the next one. Only `forget` deletes a file:
/// whatever else ends a recording (a stop, a page load, a closed window, a changed device, a
/// kill) leaves its file for `orphans`.
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
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
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

    /// This page's recordings whose writer is not done, by ID: each holds its lock.
    private var writing: [String: Recording] = [:]
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
                        self.writing.values.forEach { $0.end() }
                        let id = UUID().uuidString
                        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                        guard let lock = Self.file(of: id).flatMap(RecordingLock.init) else {
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        guard let recording = try? Recording(lock: lock) else {
                            // What a failed start wrote goes, under its lock.
                            _ = lock.delete()
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        self.writing[id] = recording
                        recording.whenDone { [weak self] _, _ in self?.writing[id] = nil }
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
            guard let recording = capturing(call) else { return }
            call.resolve(["level": recording.level])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let recording = capturing(call) else { return }
            recording.pause()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let recording = capturing(call) else { return }
            guard recording.resume() else {
                recording.end()
                return call.reject("Could not resume", "NOT_RECORDING")
            }
            call.resolve()
        }
    }

    /// Ends the recording and resolves its path once its file is finished whole. A file that lost
    /// audio it could not write is finished too and rejects `INCOMPLETE`.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let recording = capturing(call) else { return }
            recording.end()
            recording.whenDone { whole, _ in
                guard whole else { return call.reject("The recording is incomplete", "INCOMPLETE") }
                call.resolve(["path": recording.url.path])
            }
        }
    }

    /// Deletes the file of the given ID, the only way a recording leaves the disk: one this page
    /// still writes once its writer is done (it ends first), any other while no window or process
    /// writes or lists it (else `BUSY`). Resolves once the file is gone.
    @objc func forget(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let id = call.getString("id") ?? ""
            let delete = { (lock: RecordingLock) in
                lock.delete() ? call.resolve() : call.reject("Could not delete the recording", "DELETE_FAILED")
            }
            if let recording = writing[id] {
                recording.end()
                recording.whenDone { _, lock in delete(lock) }
            } else if let lock = Self.file(of: id).flatMap(RecordingLock.init) {
                delete(lock)
            } else {
                call.reject("The recording is being written", "BUSY")
            }
        }
    }

    /// The recordings no window or process is writing: stopped ones, and those a page that went or
    /// an app that was killed left. Each stays listed until `forget`.
    @objc func orphans(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: Self.folder, includingPropertiesForKeys: nil
            )) ?? []
            let recordings: [[String: Any]] = urls.compactMap { url in
                let id = url.deletingPathExtension().lastPathComponent
                // The lock first: the file is read under it, so it is neither written on nor deleted.
                guard Self.file(of: id)?.lastPathComponent == url.lastPathComponent,
                      let startedAt = RecordingLock(url)?.startedAt else { return nil }
                return ["id": id, "path": url.path, "startedAt": startedAt]
            }
            call.resolve(["recordings": recordings])
        }
    }

    /// The recording of the call's ID while it captures; else the call is rejected `NOT_RECORDING`:
    /// the recording ended, also by itself.
    private func capturing(_ call: CAPPluginCall) -> Recording? {
        if let recording = writing[call.getString("id") ?? ""], recording.capturing { return recording }
        call.reject("No such recording", "NOT_RECORDING")
        return nil
    }

    /// The page is going, or its process ended (main queue): it records nothing more, its files
    /// stay, and a start that waits on the prompt ends.
    @objc private func pageWillLoad() {
        generation += 1
        writing.values.forEach { $0.end() }
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        closed = true
        pageWillLoad()
    }
}

/// The exclusive `flock` on a recording's `.lock` file beside it, held by whoever writes the file,
/// lists it or deletes it. This object alone owns the descriptor and closes it once; the kernel
/// drops the lock of a process that dies.
private final class RecordingLock {
    let file: URL
    private let lockFile: URL
    private let descriptor: Int32

    /// nil while it is held elsewhere, by this process too.
    init?(_ file: URL) {
        let lockFile = file.deletingPathExtension().appendingPathExtension("lock")
        let descriptor = open(lockFile.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { return nil }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            return nil
        }
        (self.file, self.lockFile, self.descriptor) = (file, lockFile, descriptor)
    }

    deinit { Darwin.close(descriptor) }

    /// When the file was made, in ms since 1970; nil unless it is a regular file, not a link.
    var startedAt: Int? {
        var info = stat()
        guard lstat(file.path, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { return nil }
        return info.st_birthtimespec.tv_sec * 1_000 + info.st_birthtimespec.tv_nsec / 1_000_000
    }

    /// Deletes the file and then the lock file, regular files only: true when both are gone.
    func delete() -> Bool {
        [file, lockFile].allSatisfy { item in
            var info = stat()
            guard lstat(item.path, &info) == 0 else { return errno == ENOENT }
            return info.st_mode & S_IFMT == S_IFREG && unlink(item.path) == 0
        }
    }
}

/// One recording: the microphone through `AVAudioEngine` into an AAC `.m4a` that `AVAssetWriter`
/// writes in fragments of a second, so a killed app leaves a file that plays up to its last fragment.
/// It ends by itself when its device changes or is interrupted, or when the file cannot be written,
/// and holds its lock until its writer is done: finished or failed.
private final class Recording {
    var url: URL { writer.outputURL }
    /// It captures (main queue): until `end`.
    private(set) var capturing = true
    /// Held until the writer is done (main queue).
    private var lock: RecordingLock?
    private var waiters: [(Bool, RecordingLock) -> Void] = []
    private let engine = AVAudioEngine()
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var observers: [NSObjectProtocol] = []
    private var readiness: NSKeyValueObservation?
    /// The appends, the level and the end of the file, in turn.
    private let queue = DispatchQueue(label: "chat.mindroom.voice-recorder")
    /// What the file takes (queue): buffers; after the capture ended only those it holds; nothing.
    private enum Phase { case open, closing, sealed }
    private var phase = Phase.open
    /// The length taken in, the next buffer's time (queue): exact at any rate, and a pause leaves
    /// no gap.
    private var written = CMTime.zero
    /// Buffers the writer was not ready for yet, oldest first (queue).
    private var pending: [CMSampleBuffer] = []
    private var newestLevel: Float = 0

    init(lock: RecordingLock) throws {
        self.lock = lock
        writer = try AVAssetWriter(outputURL: lock.file, fileType: .m4a)
        writer.movieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 600)
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000
        ])
        input.expectsMediaDataInRealTime = true
        do {
            try begin()
        } catch {
            stopCapture()
            if writer.status == .writing { writer.cancelWriting() }
            throw error
        }
    }

    private func begin() throws {
        let session = AVAudioSession.sharedInstance()
        // Not `.record`: the session keeps its category afterwards, and the page must still play
        // audio then.
        try session.setCategory(.playAndRecord, mode: .default)
        try session.setActive(true)
        let node = engine.inputNode
        let format = node.outputFormat(forBus: 0)
        // An input without a rate or a channel records nothing.
        guard format.sampleRate > 0, format.channelCount > 0, writer.canAdd(input) else {
            throw CocoaError(.fileWriteUnknown)
        }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? CocoaError(.fileWriteUnknown) }
        writer.startSession(atSourceTime: .zero)
        // A backlog goes on to the writer each time it is ready again, also during a pause.
        readiness = input.observe(\.isReadyForMoreMediaData) { [weak self] _, _ in
            self?.queue.async { self?.drain() }
        }
        // The engine stops on either. They are in place before it starts, and only ask for the end:
        // nothing is torn down from inside a notification.
        observers = [
            (Notification.Name.AVAudioEngineConfigurationChange, engine as Any),
            (AVAudioSession.interruptionNotification, session as Any)
        ].map { name, object in
            NotificationCenter.default.addObserver(forName: name, object: object, queue: nil) { [weak self] _ in
                DispatchQueue.main.async { self?.end() }
            }
        }
        node.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            self?.append(buffer)
        }
        try engine.start()
    }

    /// The level of the newest buffer, linear from 0 to 1.
    var level: Float { queue.sync { newestLevel } }

    func pause() { engine.pause() }

    func resume() -> Bool { capturing && (try? engine.start()) != nil }

    /// Calls `done` (main queue) once the writer is done, with whether the file holds all that was
    /// recorded and with the lock, still held then. Not for a recording that is done.
    func whenDone(_ done: @escaping (Bool, RecordingLock) -> Void) {
        waiters.append(done)
    }

    /// Ends the capture (main queue), once: the microphone goes now, and the file is finished with
    /// what the writer takes within 2 s.
    func end() {
        guard capturing else { return }
        capturing = false
        stopCapture()
        queue.async { [self] in
            if phase == .open { phase = .closing }
            drain()
            queue.asyncAfter(deadline: .now() + 2) { [self] in seal(whole: false) }
        }
    }

    /// The one way the microphone goes (main queue): the tap, the engine, then the audio session.
    private func stopCapture() {
        observers.forEach(NotificationCenter.default.removeObserver)
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func append(_ buffer: AVAudioPCMBuffer) {
        queue.sync {
            guard phase == .open else { return }
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
            drain()
            // About 5 s of buffers the writer did not take: it is not keeping up.
            if pending.count > 64 { fail() }
        }
    }

    /// Gives the writer the buffers it is ready for (queue); the last one after the capture ended
    /// finishes the file.
    private func drain() {
        guard phase != .sealed else { return }
        while let sample = pending.first, input.isReadyForMoreMediaData, input.append(sample) {
            pending.removeFirst()
        }
        if writer.status != .writing {
            fail()
        } else if phase == .closing, pending.isEmpty {
            seal(whole: true)
        }
    }

    /// The file takes no more (queue): the recording ends, keeping what the writer took.
    private func fail() {
        DispatchQueue.main.async { [self] in end() }
        seal(whole: false)
    }

    /// Finishes the file with what the writer took (queue), once, dropping what it did not; the
    /// lock goes when the writer is done.
    private func seal(whole: Bool) {
        guard phase != .sealed else { return }
        phase = .sealed
        pending = []
        guard writer.status == .writing else { return done(false) }
        input.markAsFinished()
        writer.finishWriting { [self] in done(whole && writer.status == .completed) }
    }

    private func done(_ whole: Bool) {
        DispatchQueue.main.async { [self] in
            guard let lock else { return }
            waiters.forEach { $0(whole, lock) }
            waiters = []
            self.lock = nil
        }
    }
}
#endif
