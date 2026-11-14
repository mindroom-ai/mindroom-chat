#if DEBUG
import AVFoundation
import Foundation
import MatrixRustSDK
import MindRoomWatchKit
import os

/// Launch-environment hooks for the simulator runs (scripts/watch/e2e.sh); DEBUG builds only.
///
///   MINDROOM_WATCH_E2E_CREDENTIALS  the iPhone's credentials message, as JSON (MindRoomWatchApp)
///   MINDROOM_WATCH_E2E_ROOM         the room to make the default
///   MINDROOM_WATCH_E2E_SEND_TONE    seconds of a test tone to send as a voice message, once
///   MINDROOM_WATCH_E2E_SEND_TEXT    a text message to send, once (drives the stub model's hashtags)
///   MINDROOM_WATCH_E2E_OPEN         `newest`: open the newest thread once the list has it
///   MINDROOM_WATCH_E2E_APPROVE      `approve` or `deny`: answer the open thread's pending approval, once
///   MINDROOM_WATCH_E2E_ANSWER       `first`: answer the open thread's question with its first option, once
///   MINDROOM_WATCH_E2E_RESOLVE      `newest`: mark the newest thread done, once
enum E2EHooks {
    static let environment = ProcessInfo.processInfo.environment
    static var room: String? { environment["MINDROOM_WATCH_E2E_ROOM"] }
    static var openNewest: Bool { environment["MINDROOM_WATCH_E2E_OPEN"] == "newest" }
    /// Milliseconds since the epoch when the app started: the hooks act on what was sent after it.
    static let launchedAt = Int(Date().timeIntervalSince1970 * 1000) - 5_000
    static var resolveNewest: Bool { environment["MINDROOM_WATCH_E2E_RESOLVE"] == "newest" }
    static var resolved = false
    private static var sent = false
    private static var acted: Set<String> = []
    private static var asked: String?

    /// Answers what the thread asks, through the same calls the buttons make.
    @MainActor
    static func act(on snapshot: ThreadSnapshot, model: ThreadModel) {
        if let decision = environment["MINDROOM_WATCH_E2E_APPROVE"], let card = snapshot.pendingApproval,
           acted.insert(card.eventId).inserted {
            Task { await model.approve(card, decision == "approve") }
        }
        if environment["MINDROOM_WATCH_E2E_ANSWER"] == "first", let question = snapshot.openQuestion,
           let option = question.options.first, acted.insert(question.eventId).inserted {
            asked = question.eventId
            Task { await model.answer(question, key: option.key) }
        }
        if let question = asked, snapshot.openQuestion?.eventId != question {
            asked = nil
            log("question \(question) answered")
        }
    }

    /// A line the e2e script reads from the simulator's log.
    static func log(_ line: String) {
        Logger(subsystem: "chat.mindroom.app.watchkitapp", category: "e2e").notice("\(line, privacy: .public)")
    }

    @MainActor
    static func send(on timeline: Timeline) async {
        guard !sent else { return }
        sent = true
        if let seconds = environment["MINDROOM_WATCH_E2E_SEND_TONE"].flatMap(Double.init) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-message-e2e.m4a")
            do {
                try writeTone(to: url, seconds: seconds)
                try await sendVoiceMessage(Take(url: url, duration: seconds, waveform: (0..<48).map { Float($0 % 8) / 8 }), on: timeline)
            } catch {
                print("E2E send tone failed: \(error)")
            }
        }
        if let text = environment["MINDROOM_WATCH_E2E_SEND_TEXT"] {
            _ = try? await timeline.send(msg: messageEventContentFromMarkdown(md: text))
        }
    }

    private static func writeTone(to url: URL, seconds: Double) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
        let file = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32_000,
        ])
        let frames = AVAudioFrameCount(16_000 * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        for index in 0..<Int(frames) {
            buffer.floatChannelData![0][index] = Float(sin(2 * Double.pi * 440 * Double(index) / 16_000) * 0.3)
        }
        try file.write(from: buffer)
    }
}
#endif
