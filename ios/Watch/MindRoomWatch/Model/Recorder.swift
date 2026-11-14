import AVFoundation
import Foundation
import MatrixRustSDK
import MindRoomWatchKit

/// A finished recording, ready to send.
struct Take {
    let url: URL
    let duration: TimeInterval
    let waveform: [Float]
}

/// Records a voice message as AAC in an .m4a, with meter levels for the waveform. At most 5 minutes.
@MainActor
final class Recorder: ObservableObject {
    static let maxDuration: TimeInterval = 300

    @Published private(set) var levels: [Float] = []
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var isRecording = false
    private var recorder: AVAudioRecorder?
    private var timer: Timer?

    static func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let name = "voice-message-\(ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-")).m4a"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        let recorder = try AVAudioRecorder(url: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
        ])
        recorder.isMeteringEnabled = true
        guard recorder.record(forDuration: Self.maxDuration) else { throw RecorderError.couldNotStart }
        self.recorder = recorder
        levels = []
        elapsed = 0
        isRecording = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    /// Stops and returns the take (also when the 5 minutes ran out).
    func stop() -> Take? {
        guard let recorder else { return nil }
        let duration = recorder.isRecording ? recorder.currentTime : elapsed
        recorder.stop()
        finish()
        guard duration > 0.3 else { return nil }
        return Take(url: recorder.url, duration: duration, waveform: Waveform.bars(from: levels))
    }

    func cancel() {
        recorder?.stop()
        recorder?.deleteRecording()
        finish()
    }

    private func tick() {
        guard let recorder else { return }
        if recorder.isRecording {
            recorder.updateMeters()
            levels.append(recorder.averagePower(forChannel: 0))
            elapsed = recorder.currentTime
        } else {
            isRecording = false
        }
    }

    private func finish() {
        timer?.invalidate()
        timer = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

enum RecorderError: Error {
    case couldNotStart
}

/// Sends a take as a voice message on the timeline: a new message in the room, or a reply in a thread.
func sendVoiceMessage(_ take: Take, on timeline: Timeline) async throws {
    let size = (try? FileManager.default.attributesOfItem(atPath: take.url.path)[.size] as? NSNumber)?.uint64Value
    let handle = try timeline.sendVoiceMessage(
        params: UploadParameters(source: .file(filename: take.url.path), caption: nil, formattedCaption: nil,
                                 mentions: nil, inReplyTo: nil),
        audioInfo: AudioInfo(duration: take.duration, size: size, mimetype: "audio/mp4"),
        waveform: take.waveform)
    try await handle.join()
}
