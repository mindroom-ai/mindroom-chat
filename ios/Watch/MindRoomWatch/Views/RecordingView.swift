import SwiftUI

/// Records until Send (or Double Tap) or ✕; recording goes on with the wrist down.
struct RecordingView: View {
    let send: (Take) -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = Recorder()
    @State private var denied = false

    var body: some View {
        VStack(spacing: 8) {
            if denied {
                Text("MindRoom may not use the microphone. Allow it in Settings on the watch: Privacy & Security, Microphone.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            } else {
                Waveform(levels: recorder.levels.suffix(18))
                    .frame(height: 44)
                Text(Duration.seconds(recorder.elapsed), format: .time(pattern: .minuteSecond))
                    .font(.system(size: 28, weight: .semibold).monospacedDigit())
                Button {
                    if let take = recorder.stop() { send(take) }
                    dismiss()
                } label: {
                    Label("Send", systemImage: "arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .handGestureShortcut(.primaryAction)
            }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button { recorder.cancel(); dismiss() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel(Text("Discard"))
            }
        }
        .task {
            guard await Recorder.requestPermission() else { denied = true; return }
            do { try recorder.start() } catch { denied = true }
        }
        .onChange(of: recorder.isRecording) { wasRecording, isRecording in
            // The 5 minutes ran out: send what there is.
            if wasRecording, !isRecording, let take = recorder.stop() { send(take); dismiss() }
        }
    }
}

private struct Waveform: View {
    let levels: ArraySlice<Float>

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: 3, height: max(4, CGFloat(max(0, min(1, (level + 50) / 50))) * 44))
            }
        }
        .accessibilityHidden(true)
    }
}
