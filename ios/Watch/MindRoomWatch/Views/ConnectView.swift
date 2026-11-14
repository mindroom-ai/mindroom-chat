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
                    Text("Open MindRoom on your iPhone: Settings, Privacy, Apple Watch.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                case let .failed(reason):
                    Text("Could not connect")
                        .font(.headline)
                    Text(reason)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                default:
                    Text("Open MindRoom on your iPhone: Settings, Privacy, Apple Watch.")
                        .font(.headline)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }
}
