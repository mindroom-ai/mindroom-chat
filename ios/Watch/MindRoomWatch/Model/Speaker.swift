import AVFoundation
import os

private let log = Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "speaker")

/// Sounds a message on the watch's speaker or connected headphones: an agent's answer read aloud, or a voice
/// message's own audio. One message at a time.
@MainActor
final class Speaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    /// The id of the message that sounds, or whose audio is on its way.
    @Published private(set) var current: String?
    /// The id of the voice message whose audio could not be fetched or played.
    @Published private(set) var failed: String?
    private let synthesizer = AVSpeechSynthesizer()
    private var engine: AVAudioEngine?
    private var loading: Task<Void, Never>?
    /// What sounds now: a callback about anything older changes nothing.
    private var sounding: ObjectIdentifier?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Reads the text aloud, or stops when this message sounds.
    func toggle(_ id: String, text: String) {
        guard start(id) else { return }
        let utterance = AVSpeechUtterance(string: text)
        sounding = ObjectIdentifier(utterance)
        synthesizer.speak(utterance)
    }

    /// Plays the audio `load` fetches, or stops when this message sounds.
    func toggle(_ id: String, audio load: @escaping () async throws -> Data) {
        guard start(id) else { return }
        loading = Task {
            do {
                let data = try await load()
                guard !Task.isCancelled else { return }
                try play(data)
            } catch {
                guard !Task.isCancelled else { return }
                log.error("could not play: \(String(describing: error), privacy: .public)")
                silence()
                current = nil
                failed = id
            }
        }
    }

    /// AVAudioPlayer opens the Ogg Opus that MindRoom's agents send and then does not play it. AVAudioFile
    /// decodes it, as it does AAC, so an engine plays the file.
    private func play(_ data: Data) throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString)")
        try data.write(to: url)
        // The open file keeps its data; only the name goes.
        defer { try? FileManager.default.removeItem(at: url) }
        let file = try AVAudioFile(forReading: url)
        let engine = AVAudioEngine()
        let node = AVAudioPlayerNode()
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: file.processingFormat)
        self.engine = engine
        try AVAudioSession.sharedInstance().setActive(true)
        try engine.start()
        let sound = ObjectIdentifier(engine)
        node.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in self?.ended(sound) }
        node.play()
        sounding = sound
    }

    /// Stops the engine and gives the audio session back, so that what it interrupted (music) goes on.
    private func silence() {
        guard let engine else { return }
        engine.stop()
        self.engine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func stop() {
        loading?.cancel()
        loading = nil
        silence()
        sounding = nil
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        current = nil
    }

    /// Stops what sounds and makes this message the current one; false when it was (the tap meant stop).
    private func start(_ id: String) -> Bool {
        let was = current
        stop()
        guard was != id else { return false }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        current = id
        failed = nil
        return true
    }

    private nonisolated func ended(_ sound: ObjectIdentifier) {
        Task { @MainActor in
            guard self.sounding == sound else { return }
            self.silence()
            self.sounding = nil
            self.current = nil
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        ended(ObjectIdentifier(utterance))
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        ended(ObjectIdentifier(utterance))
    }
}
