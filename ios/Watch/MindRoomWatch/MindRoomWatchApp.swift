import MindRoomWatchKit
import SwiftUI

@main
struct MindRoomWatchApp: App {
    @StateObject private var session: MatrixSession
    @Environment(\.scenePhase) private var scenePhase
    private let link: WatchLink

    init() {
        let session = MatrixSession()
        _session = StateObject(wrappedValue: session)
        link = WatchLink(session: session)
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.client != nil {
                    SignedInView()
                } else {
                    ConnectView()
                }
            }
            .environmentObject(session)
            .task { await start() }
        }
        .onChange(of: scenePhase) { _, phase in
            Task { await session.setActive(phase == .active) }
        }
    }

    private func start() async {
        await session.restore()
        #if DEBUG
        // The simulator e2e run hands the credentials over in the launch environment.
        if session.client == nil,
           let json = ProcessInfo.processInfo.environment["MINDROOM_WATCH_E2E_CREDENTIALS"],
           let dictionary = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
           let message = WatchLinkMessage(dictionary: dictionary) {
            await session.connect(message)
        }
        #endif
    }
}

/// Replaced by the home screen in the next step.
struct SignedInView: View {
    @EnvironmentObject private var session: MatrixSession

    var body: some View {
        VStack {
            Text("Signed in")
            Text(String(describing: session.syncState)).font(.footnote)
        }
    }
}
