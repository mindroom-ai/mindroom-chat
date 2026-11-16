import SwiftUI

/// Shown while the watch has no account: connecting happens on the iPhone.
struct ConnectView: View {
    @EnvironmentObject private var session: MatrixSession

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "iphone.and.arrow.forward")
                    .font(.title2)
                    .foregroundStyle(.tint)
                switch session.state {
                case .connecting:
                    ProgressView()
                    Text("Connecting…")
                case .expired:
                    Text("Connect again from your iPhone")
                        .font(.headline)
                    Text("Open MindRoom on your iPhone: Settings, Apple Watch.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                case let .failed(reason):
                    Text("Could not connect")
                        .font(.headline)
                    Text("Connect again from your iPhone")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(verbatim: reason)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                default:
                    Text("Open MindRoom on your iPhone: Settings, Apple Watch.")
                        .font(.headline)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }
}
