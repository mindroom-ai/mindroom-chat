import SwiftUI

/// Records until Send (or Double Tap) or ✕; recording goes on with the wrist down.
struct RecordingView: View {
    let send: (Take) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var recorder = Recorder()
    @State private var denied = false
    /// Recording could not start though the microphone is allowed.
    @State private var failed = false
    @State private var pulsing = false

    var body: some View {
        VStack(spacing: 8) {
            if denied {
                VStack(spacing: 8) {
                    Image(systemName: "mic.slash.fill")
                        .font(.title3)
                        .foregroundStyle(WatchTheme.coral)
                    Text("MindRoom may not use the microphone. Allow it in Settings on the watch: Privacy & Security, Microphone.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.9))
                        .multilineTextAlignment(.center)
                }
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(
                    GlassCardBackground(
                        tint: WatchTheme.coral.opacity(0.12),
                        border: WatchTheme.coral.opacity(0.32),
                        cornerRadius: 14
                    )
                )
            } else if failed {
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.title3)
                        .foregroundStyle(WatchTheme.amber)
                    Button("Retry") { start() }
                        .buttonStyle(.borderedProminent)
                        .tint(WatchTheme.teal)
                }
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(
                    GlassCardBackground(
                        tint: WatchTheme.amber.opacity(0.12),
                        border: WatchTheme.amber.opacity(0.34),
                        cornerRadius: 14
                    )
                )
            } else {
                liveBadge
                Spacer(minLength: 2)
                MirroredWaveform(levels: recorder.levels.suffix(10))
                    .frame(height: 46)
                Text(Duration.seconds(recorder.elapsed), format: .time(pattern: .minuteSecond))
                    .font(.system(size: 28, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.white)
                Spacer(minLength: 2)
                Button {
                    if let take = recorder.stop() { send(take) }
                    dismiss()
                } label: {
                    Label("Send", systemImage: "arrow.up")
                        .font(.headline)
                        .foregroundStyle(WatchTheme.tealInk)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [WatchTheme.tealBright, WatchTheme.teal],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .shadow(color: WatchTheme.tealBright.opacity(0.35), radius: 8, x: 0, y: 2)
                        )
                }
                .buttonStyle(.plain)
                .handGestureShortcut(.primaryAction)
            }
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.recordingBackground.ignoresSafeArea())
        .containerBackground(for: .navigation) {
            WatchTheme.recordingBackground
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button { recorder.cancel(); dismiss() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel(Text("Discard"))
            }
        }
        .task {
            guard await Recorder.requestPermission() else { denied = true; return }
            start()
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        // The screen can go without a button: a tapped notification replaces the thread under it.
        .onDisappear { recorder.cancel() }
        .onChange(of: recorder.reachedLimit) { _, reached in
            // The 5 minutes ran out: send what there is.
            if reached, let take = recorder.stop() { send(take); dismiss() }
        }
    }

    private var liveBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(WatchTheme.coral)
                .frame(width: 7, height: 7)
                .opacity(reduceMotion ? 1.0 : (pulsing ? 0.35 : 1.0))
            Text("Rec")
                .font(.caption2.weight(.bold))
                .foregroundStyle(WatchTheme.coral)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 3)
        .background(
            Capsule()
                .fill(WatchTheme.coral.opacity(0.18))
                .overlay(Capsule().strokeBorder(WatchTheme.coral.opacity(0.35), lineWidth: 0.6))
        )
    }

    private func start() {
        do { try recorder.start(); failed = false } catch { failed = true }
    }
}

/// Symmetrical mirrored waveform bars transitioning from ocean teal to warm amber.
private struct MirroredWaveform: View {
    let levels: ArraySlice<Float>

    private var bars: [CGFloat] {
        let halfCount = 9
        let normalized = levels.map { CGFloat(max(0, min(1, ($0 + 50) / 50))) }
        let padded = Array(repeating: CGFloat(0.08), count: max(0, halfCount - normalized.count)) + normalized.suffix(halfCount)
        let left = Array(padded.dropLast())
        let right = Array(padded.reversed())
        return left + right
    }

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(Array(bars.enumerated()), id: \.offset) { _, value in
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [WatchTheme.tealBright, WatchTheme.amberWarm],
                            startPoint: .bottom,
                            endPoint: .top
                        )
                    )
                    .frame(width: 3.5, height: max(6, value * 44))
            }
        }
        .accessibilityHidden(true)
    }
}
