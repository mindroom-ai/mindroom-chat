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
                if let client = session.client, let userId = try? client.userId() {
                    HomeView(client: client, userId: userId)
                } else {
                    ConnectView()
                }
            }
            .environmentObject(session)
            .task { await start() }
        }
        .onChange(of: scenePhase) { _, phase in
            Task { await session.setActive(phase == .active) }
            if phase == .background { BackgroundRefresh.schedule() }
        }
        .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
            await BackgroundRefresh.run(session)
        }
    }

    private func start() async {
        #if DEBUG
        // The simulator e2e run hands the credentials over in the launch environment; they replace any session.
        if let json = ProcessInfo.processInfo.environment["MINDROOM_WATCH_E2E_CREDENTIALS"],
           let dictionary = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
           let message = WatchLinkMessage(dictionary: dictionary) {
            await session.connect(message)
            return
        }
        #endif
        await session.restore()
    }
}
