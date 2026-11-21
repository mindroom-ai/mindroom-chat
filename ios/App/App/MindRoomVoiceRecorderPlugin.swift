#if targetEnvironment(macCatalyst)
import Accelerate
import AVFoundation
import Capacitor
import UIKit

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

    /// This page's recordings by ID (main queue), until it forgets them or goes: the one that
    /// captures, and those that ended, whose audio it can still ask for.
    private var recordings: [String: Recording] = [:]
    /// Its window closed: it records nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one records nothing.
    private var generation = 0

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewNavigationStarted,
            object: bridge?.webView
        )
        center.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewTerminated,
            object: bridge?.webView
        )
        // The app quits: what is being written is finished as far as there is time.
        center.addObserver(
            self, selector: #selector(pageWillLoad), name: UIApplication.willTerminateNotification, object: nil
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
                        self.recordings.values.forEach { $0.end() }
                        let id = UUID().uuidString
                        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
                        guard let lock = Self.file(of: id).flatMap({ RecordingLock($0, create: true) }) else {
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        // Whose it is stands on disk before anything is recorded.
                        guard lock.write(owner: call.getString("owner") ?? ""),
                              let recording = try? Recording(lock: lock) else {
                            // What a failed start wrote goes, under its lock.
                            _ = lock.delete()
                            return call.reject("Could not start recording", "START_FAILED")
                        }
                        self.recordings[id] = recording
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

    /// Ends the recording, also one that ended by itself, and resolves its path once its file is
    /// finished. `incomplete`: the file lost audio it could not write, or, after 3 s, is not
    /// finished yet (a writer that hangs is not waited for) and holds what is on disk by then.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            guard let recording = recordings[call.getString("id") ?? ""] else {
                return call.reject("No such recording", "NOT_RECORDING")
            }
            var answered = false
            let answer = { (whole: Bool) in
                guard !answered else { return }
                answered = true
                call.resolve(["path": recording.url.path, "incomplete": !whole])
            }
            recording.end()
            recording.whenDone { whole, _ in answer(whole) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { answer(false) }
        }
    }

    /// Deletes the file of the given ID, the only way a recording leaves the disk: one of this page
    /// once its writer is done (it ends first), any other while no window or process writes or
    /// lists it (else `BUSY`). Resolves once the file is gone.
    @objc func forget(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            let id = call.getString("id") ?? ""
            guard let file = Self.file(of: id) else { return call.reject("Not a recording ID", "INVALID_ID") }
            let delete = { (lock: RecordingLock?) in
                guard let lock else { return call.reject("The recording is being written", "BUSY") }
                lock.delete() ? call.resolve() : call.reject("Could not delete the recording", "DELETE_FAILED")
            }
            guard let recording = recordings.removeValue(forKey: id) else {
                return delete(RecordingLock(file, create: true))
            }
            recording.end()
            recording.whenDone { _, lock in delete(lock ?? RecordingLock(file, create: true)) }
        }
    }

    /// The recordings no window or process is writing: stopped ones, and those a page that went or
    /// an app that was killed left, each with the account that recorded it. Each stays listed
    /// until `forget`.
    @objc func orphans(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: Self.folder, includingPropertiesForKeys: nil
            )) ?? []
            let recordings: [[String: Any]] = urls.compactMap { url in
                let id = url.deletingPathExtension().lastPathComponent
                // The lock first, and only one its writer made: the file is read under it, so it
                // is neither written on nor deleted.
                guard Self.file(of: id)?.lastPathComponent == url.lastPathComponent,
                      let lock = RecordingLock(url, create: false), let startedAt = lock.startedAt else { return nil }
                return ["id": id, "path": url.path, "startedAt": startedAt, "owner": lock.owner]
            }
            call.resolve(["recordings": recordings])
        }
    }

    /// The recording of the call's ID while it captures; else the call is rejected `NOT_RECORDING`:
    /// the recording ended, also by itself.
    private func capturing(_ call: CAPPluginCall) -> Recording? {
        if let recording = recordings[call.getString("id") ?? ""], recording.capturing { return recording }
        call.reject("No such recording", "NOT_RECORDING")
        return nil
    }

    /// The page is going, its process ended, or the app quits (main queue): it records nothing
    /// more, its files stay, and a start that waits on the prompt ends.
    @objc private func pageWillLoad() {
        generation += 1
        recordings.values.forEach { $0.end() }
        recordings = [:]
    }

    /// The window closed (main queue), for good: a start still on its way records nothing.
    func close() {
        closed = true
        pageWillLoad()
    }
}

/// The exclusive `flock` on a recording's `.lock` file beside it, held by whoever writes the file,
/// lists it or deletes it. This object alone owns the descriptor and closes it once; the kernel
/// drops the lock of a process that dies. The lock file holds the account that recorded.
private final class RecordingLock {
    let file: URL
    private let lockFile: URL
    private let descriptor: Int32

    /// nil while it is held elsewhere, by this process too; without `create` (a listing makes no
    /// files) also when there is none.
    init?(_ file: URL, create: Bool) {
        let lockFile = file.deletingPathExtension().appendingPathExtension("lock")
        let descriptor = open(lockFile.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC | (create ? O_CREAT : 0), 0o600)
        guard descriptor >= 0 else { return nil }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            return nil
        }
        (self.file, self.lockFile, self.descriptor) = (file, lockFile, descriptor)
    }

    deinit { Darwin.close(descriptor) }

    /// The account that recorded, as `write(owner:)` put it; empty when there is none.
    var owner: String {
        var bytes = [UInt8](repeating: 0, count: 1_024)
        let count = pread(descriptor, &bytes, bytes.count, 0)
        return String(decoding: bytes.prefix(max(count, 0)), as: UTF8.self)
    }

    func write(owner: String) -> Bool {
        let bytes = Array(owner.utf8)
        return pwrite(descriptor, bytes, bytes.count, 0) == bytes.count
    }

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

/// One recording: the microphone through `AVAudioEngine`, converted at the tap to 16 kHz mono,
/// into an AAC `.m4a` that `AVAssetWriter` writes in fragments of a second, so a killed app leaves
/// a file that plays up to its last fragment. A changed device is tapped anew. It ends by itself
/// when it is interrupted or the file cannot be written, and holds its lock until its writer is
/// done: finished or failed.
private final class Recording {
    /// What the writer is given, whatever the device delivers.
    private static let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
    /// About 5 s that the writer did not take: it is not keeping up.
    private static let backlog = 5 * 16_000

    var url: URL { writer.outputURL }
    /// It captures (main queue): until `end`.
    private(set) var capturing = true
    /// The page paused it (main queue): the engine starts again only for a resume.
    private var paused = false
    /// Held until the writer is done (main queue).
    private var lock: RecordingLock?
    /// Whether the file holds all that was recorded, once the writer is done (main queue).
    private var whole: Bool?
    private var waiters: [(Bool, RecordingLock?) -> Void] = []
    private let engine = AVAudioEngine()
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var observers: [NSObjectProtocol] = []
    private var readiness: NSKeyValueObservation?
    /// The writer, the file's times and its end, in turn: it may wait for the disk.
    private let queue = DispatchQueue(label: "chat.mindroom.voice-recorder")
    /// What the file takes (queue): buffers; after the capture ended only those it holds; nothing.
    private enum Phase { case open, closing, sealed }
    private var phase = Phase.open
    /// The length written, the next buffer's time (queue): a pause leaves no gap.
    private var written = CMTime.zero
    /// Guards the two below: the tap and the level never wait for the writer.
    private let shared = NSLock()
    /// Buffers the writer has not taken yet, oldest first.
    private var pending: [AVAudioPCMBuffer] = []
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
        guard writer.canAdd(input) else { throw CocoaError(.fileWriteUnknown) }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? CocoaError(.fileWriteUnknown) }
        writer.startSession(atSourceTime: .zero)
        // A backlog goes on to the writer each time it is ready again, also during a pause.
        readiness = input.observe(\.isReadyForMoreMediaData) { [weak self] _, _ in
            self?.queue.async { self?.drain() }
        }
        // The engine stops on either: a changed device (headphones that take over the microphone)
        // is tapped anew, an interruption ends the recording. They are in place before the engine
        // starts, and only ask for it on the main queue: nothing is done inside a notification.
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
                DispatchQueue.main.async { self?.retap(again: true) }
            },
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] _ in
                DispatchQueue.main.async { self?.end() }
            }
        ]
        try tap()
        try engine.start()
    }

    /// Taps the microphone in the format its hardware has now (main queue).
    private func tap() throws {
        let node = engine.inputNode
        // Not the node's output format, which can still be the one of the device before.
        let format = node.inputFormat(forBus: 0)
        // An input without a rate or a channel records nothing.
        guard format.sampleRate > 0, format.channelCount > 0 else { throw CocoaError(.fileWriteUnknown) }
        // Made for the format of the buffers that come, and again when that changes.
        var converter: AVAudioConverter?
        node.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            if converter?.inputFormat != buffer.format {
                converter = AVAudioConverter(from: buffer.format, to: Self.format)
                // By channel number: matched by layout, some devices come out silent.
                converter?.channelMap = [0]
            }
            self?.take(converter.flatMap { Self.convert(buffer, with: $0) })
        }
    }

    /// The buffer in the converter's output format; nil when it cannot be converted.
    private static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> AVAudioPCMBuffer? {
        let frames = Double(buffer.frameLength) * converter.outputFormat.sampleRate / converter.inputFormat.sampleRate
        guard let converted = AVAudioPCMBuffer(
            pcmFormat: converter.outputFormat, frameCapacity: AVAudioFrameCount(frames) + 16
        ) else { return nil }
        var given = false
        let status = converter.convert(to: converted, error: nil) { _, status in
            status.pointee = given ? .noDataNow : .haveData
            defer { given = true }
            return given ? nil : buffer
        }
        return status == .error ? nil : converted
    }

    /// A buffer of the tap, as 16 kHz mono (its thread): the level is its RMS, and the writer's
    /// queue takes it from `pending`. nil, or more than the writer keeps up with, ends the
    /// recording, keeping what the writer took.
    private func take(_ buffer: AVAudioPCMBuffer?) {
        var rms: Float = 0
        if let buffer, let samples = buffer.floatChannelData?[0] {
            vDSP_rmsqv(samples, 1, &rms, vDSP_Length(buffer.frameLength))
        }
        let taken = shared.withLock {
            guard let buffer, pending.reduce(0, { $0 + Int($1.frameLength) }) < Self.backlog else { return false }
            newestLevel = min(rms, 1)
            if buffer.frameLength > 0 { pending.append(buffer) }
            return true
        }
        queue.async { [self] in taken ? drain() : fail() }
    }

    /// The device changed, and the engine stopped itself (main queue): the recording goes on from
    /// the new one, at once unless it is paused. A device still switching has no format for a
    /// moment: it is asked once `again`, and the recording ends only when it cannot be recorded.
    private func retap(again: Bool) {
        guard capturing else { return }
        engine.inputNode.removeTap(onBus: 0)
        do {
            try tap()
            if !paused { try engine.start() }
        } catch {
            guard again else { return end() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.retap(again: false) }
        }
    }

    /// The level of the newest buffer, linear from 0 to 1.
    var level: Float { shared.withLock { newestLevel } }

    func pause() {
        paused = true
        engine.pause()
    }

    func resume() -> Bool {
        paused = false
        return capturing && (try? engine.start()) != nil
    }

    /// Calls `done` (main queue) once the writer is done, with whether the file holds all that was
    /// recorded, and with the lock while it is still held: for the first callers, not after.
    func whenDone(_ done: @escaping (Bool, RecordingLock?) -> Void) {
        if let whole { done(whole, nil) } else { waiters.append(done) }
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
        }
        queue.asyncAfter(deadline: .now() + 2) { [self] in seal(whole: false) }
    }

    /// The one way the microphone goes (main queue): the tap, the engine, then the audio session.
    private func stopCapture() {
        observers.forEach(NotificationCenter.default.removeObserver)
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Gives the writer the buffers it is ready for (queue); the last one after the capture ended
    /// finishes the file.
    private func drain() {
        guard phase != .sealed else { return }
        while input.isReadyForMoreMediaData, let buffer = shared.withLock({ pending.first }) {
            guard let sample = sample(of: buffer), input.append(sample) else { return fail() }
            shared.withLock { _ = pending.removeFirst() }
        }
        if writer.status != .writing {
            fail()
        } else if phase == .closing, shared.withLock({ pending.isEmpty }) {
            seal(whole: true)
        }
    }

    /// The buffer for the writer, at the time the file has reached (queue), which moves on.
    private func sample(of buffer: AVAudioPCMBuffer) -> CMSampleBuffer? {
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: 16_000), presentationTimeStamp: written, decodeTimeStamp: .invalid
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
              ) == noErr else { return nil }
        written = CMTimeAdd(written, CMTime(value: CMTimeValue(buffer.frameLength), timescale: 16_000))
        return sample
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
        shared.withLock { pending = [] }
        guard writer.status == .writing else { return done(false) }
        input.markAsFinished()
        writer.finishWriting { [self] in done(whole && writer.status == .completed) }
    }

    private func done(_ whole: Bool) {
        DispatchQueue.main.async { [self] in
            self.whole = whole
            waiters.forEach { $0(whole, lock) }
            waiters = []
            lock = nil
        }
    }
}
#endif
