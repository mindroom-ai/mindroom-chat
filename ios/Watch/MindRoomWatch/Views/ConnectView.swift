import SwiftUI

/// Shown while the watch has no account: connecting happens on the iPhone.
struct ConnectView: View {
    @EnvironmentObject private var session: MatrixSession

    var body: some View {
        ZStack {
            WatchTheme.threadBackground.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [WatchTheme.tealBright.opacity(0.32), WatchTheme.tealDeep.opacity(0.85)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 48, height: 48)
                            .overlay(Circle().strokeBorder(WatchTheme.tealBright.opacity(0.45), lineWidth: 1))
                            .shadow(color: WatchTheme.tealBright.opacity(0.35), radius: 8, x: 0, y: 0)
                        Image(systemName: "iphone.and.arrow.forward")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(WatchTheme.tealBright)
                    }
                    .padding(.top, 6)

                    VStack(spacing: 6) {
                        switch session.state {
                        case .connecting:
                            ProgressView()
                                .tint(WatchTheme.tealBright)
                            Text("Connecting…")
                                .font(.headline)
                                .foregroundStyle(.white)
                        case .expired:
                            Text("Connect again from your iPhone")
                                .font(.headline)
                                .foregroundStyle(WatchTheme.amberWarm)
                            Text("Open MindRoom on your iPhone: Settings, Apple Watch.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        case let .failed(reason):
                            Text("Could not connect")
                                .font(.headline)
                                .foregroundStyle(WatchTheme.coral)
                            Text("Connect again from your iPhone")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Text(verbatim: reason)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        default:
                            Text("Open MindRoom on your iPhone: Settings, Apple Watch.")
                                .font(.headline)
                                .foregroundStyle(.white)
                        }
                    }
                    .padding(11)
                    .frame(maxWidth: .infinity)
                    .background(
                        GlassCardBackground(
                            tint: WatchTheme.glassFill,
                            border: WatchTheme.tealBright.opacity(0.24),
                            cornerRadius: 14
                        )
                    )
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 4)
            }
        }
    }
}
