import MatrixRustSDK
import MindRoomWatchKit
import SwiftUI
import UserNotifications

/// The signed-in watch: the default room's mic and its threads, or the room picker when there is none.
struct HomeView: View {
    let client: Client
    let userId: String
    @EnvironmentObject private var session: MatrixSession
    @StateObject private var rooms = RoomList()
    @State private var model: RoomModel?
    @State private var picking = false
    @State private var path: [ThreadTarget] = []
    /// Rooms other than the default one whose thread a notification opened.
    @State private var otherRooms: [String: RoomModel] = [:]
    @ObservedObject private var openThread = OpenThreadRequest.shared

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let model {
                    RoomHome(model: model, path: $path, pick: { picking = true }, roomGone: roomGone)
                        // Another default room starts without the last one's "Not sent".
                        .id(model.room.id())
                        .navigationDestination(for: ThreadTarget.self) { target in
                            if let roomModel = roomModel(target.roomId) {
                                // A notification can replace the open thread: each thread is a view of its own,
                                // or the new one would keep the old one's model.
                                ThreadView(roomModel: roomModel, rootId: target.rootId).id(target)
                            }
                        }
                } else {
                    RoomPickerView(rooms: rooms, selected: nil, pick: select)
                }
            }
            .sheet(isPresented: $picking) {
                NavigationStack {
                    RoomPickerView(rooms: rooms, selected: model?.room.id(), pick: select)
                }
            }
        }
        .task {
            if let syncService = session.syncService { await rooms.start(syncService) }
            #if DEBUG
            if let roomId = E2EHooks.room { DefaultRoom.set(roomId, userId: userId) }
            E2EHooks.logCrypto(client)
            #endif
            if model == nil, let roomId = DefaultRoom.get(userId: userId) { open(roomId) }
        }
        // The watch's own "Not sent" notice needs the permission; a push the iPhone forwards does not.
        .task {
            #if DEBUG
            // No prompt over the simulator run's screenshots.
            if E2EHooks.room != nil { return }
            #endif
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        }
        .onChange(of: rooms.rooms) { _, _ in
            // At launch the default room may reach the room list only after the first sync.
            if model == nil, let roomId = DefaultRoom.get(userId: userId) { open(roomId) }
        }
        .onChange(of: openThread.target?.threadId, initial: true) { _, _ in openRequestedThread() }
        // On a cold launch the tap may come before the default room is open.
        .onChange(of: model?.room.id()) { _, _ in openRequestedThread() }
        .onChange(of: session.syncState) { _, state in
            // A notification tapped offline opens its thread now.
            guard state == .running, let tap = openThread.unread else { return }
            openThread.unread = nil
            Task { await NotificationActions.perform("open", userInfo: tap) }
        }
    }

    /// A tapped notification opens its thread; another room's thread opens without making it the default.
    private func openRequestedThread() {
        guard model != nil, let target = openThread.target else { return }
        openThread.target = nil
        if !target.threadId.isEmpty { path = [ThreadTarget(roomId: target.roomId, rootId: target.threadId)] }
    }

    private func select(_ roomId: String) {
        DefaultRoom.set(roomId, userId: userId)
        picking = false
        open(roomId)
    }

    private func roomGone() {
        // The room was left or replaced: choose another.
        DefaultRoom.set(nil, userId: userId)
        path = []
        model?.trust.persist = nil
        model = nil
    }

    private func roomModel(_ roomId: String) -> RoomModel? {
        if model?.room.id() == roomId { return model }
        if let other = otherRooms[roomId] { return other }
        guard let room = try? client.getRoom(roomId: roomId) else { return nil }
        let other = RoomModel(room: room, userId: userId, client: client)
        otherRooms[roomId] = other
        return other
    }

    private func open(_ roomId: String) {
        guard model?.room.id() != roomId, let room = try? client.getRoom(roomId: roomId) else { return }
        let model = RoomModel(room: room, userId: userId, client: client, persistsResolved: true)
        // The model it replaces may still be reading its room's state: only the newest writes `ResolvedCache`.
        self.model?.trust.persist = nil
        self.model = model
        Task { await model.start() }
    }
}

/// A request to start recording from outside the home screen (complication, App Shortcut).
@MainActor
final class RecordRequest: ObservableObject {
    static let shared = RecordRequest()
    @Published var pending = false
}

/// A thread to show: its room (the default one, or another a notification named) and its root.
struct ThreadTarget: Hashable {
    let roomId: String
    let rootId: String
}

private struct RoomHome: View {
    @ObservedObject var model: RoomModel
    @Binding var path: [ThreadTarget]
    let pick: () -> Void
    let roomGone: () -> Void
    @ObservedObject private var request = RecordRequest.shared
    @EnvironmentObject private var session: MatrixSession
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var recording = false
    @State private var sendError: String?
    /// The file name of the voice message that just went out: its thread opens once it has an id.
    @State private var following: String?
    @State private var collapsed: Set<ThreadSectionKind> = []

    private var counts: WidgetSnapshot {
        WidgetSnapshot(roomName: model.roomName, states: model.rows.map(\.state), at: Date())
    }

    private var hasUrgent: Bool {
        counts.needsYou > 0 || model.rows.contains { $0.state == .failed }
    }

    var body: some View {
        #if DEBUG
        // The simulator run's screenshot shows the rows, which start below the mic.
        ScrollViewReader { scroll in
            list.onChange(of: model.rows) { _, rows in
                if E2EHooks.scrollToRows,
                   let first = groupThreadRows(rows, state: \.state).first?.items.first {
                    scroll.scrollTo(first.id, anchor: .top)
                }
            }
        }
        #else
        list
        #endif
    }

    private var list: some View {
        let sections = groupThreadRows(model.rows, state: \.state)
        return List {
            Section {
                voiceCapsule
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 2, leading: 2, bottom: 4, trailing: 2))
                if let sendError {
                    Text(sendError)
                        .font(.footnote)
                        .foregroundStyle(WatchTheme.coral)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 2, trailing: 6))
                }
            }
            if sections.count > 1 {
                ForEach(sections) { section in
                    Section {
                        sectionHeader(for: section)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 6, leading: 4, bottom: 2, trailing: 4))
                        if !collapsed.contains(section.kind) {
                            ForEach(section.items) { row in
                                threadRowLink(row)
                            }
                        }
                    }
                }
            } else if let sole = sections.first {
                Section {
                    ForEach(sole.items) { row in
                        threadRowLink(row)
                    }
                }
            }
        }
        .containerBackground(for: .navigation) {
            WatchTheme.homeBackground(hasUrgent: hasUrgent)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: pick) {
                    HStack(spacing: 4) {
                        Text(model.roomName)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(WatchTheme.tealBright)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(0.12))
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75))
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Rooms"))
            }
        }
        .fullScreenCover(isPresented: $recording) {
            RecordingView { take in
                following = take.url.lastPathComponent
                Task {
                    do { sendError = nil; try await model.sendVoice(take) } catch {
                        following = nil
                        sendError = String(localized: "Not sent")
                    }
                }
            }
        }
        .onChange(of: model.rows) { _, rows in openSent(rows) }
        .onChange(of: path) { _, _ in following = nil }
        .task(id: following) {
            // Offline the message waits in the queue: stay on the room, where its row says so.
            guard following != nil else { return }
            try? await Task.sleep(for: .seconds(30))
            if !Task.isCancelled { following = nil }
        }
        // A reply in a thread whose root the room's timeline has not loaded changes nothing there: read the
        // list each time the room comes on screen, and every 30 s while it stays.
        .task(id: "\(scenePhase == .active) \(model.room.id())") {
            guard scenePhase == .active else { return }
            model.foregrounded()
            while !Task.isCancelled {
                model.scheduleRefresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .onAppear { takeRequest() }
        .onChange(of: request.pending) { _, _ in takeRequest() }
        .onChange(of: model.gone, initial: true) { _, gone in if gone { roomGone() } }
        #if DEBUG
        .onChange(of: model.rows) { _, rows in
            // The thread of the message the hooks just sent: the newest root, once it has an event id.
            if E2EHooks.openNewest, path.isEmpty, let row = rows.max(by: { $0.rootTs < $1.rootTs }),
               row.rootTs >= E2EHooks.launchedAt, let rootId = row.rootId {
                path = [ThreadTarget(roomId: model.room.id(), rootId: rootId)]
            }
            if E2EHooks.resolveNewest, !E2EHooks.resolved, let rootId = rows.first(where: { $0.state != .queued })?.rootId {
                E2EHooks.resolved = true
                Task { await model.resolve(rootId); E2EHooks.log("resolved \(rootId)") }
            }
        }
        #endif
    }

    private var voiceCapsule: some View {
        Button { recording = true } label: {
            HStack(spacing: 9) {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [WatchTheme.tealBright, WatchTheme.teal],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 34, height: 34)
                        .shadow(color: WatchTheme.tealBright.opacity(0.45), radius: 6, x: 0, y: 0)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(WatchTheme.tealInk)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Talk")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(summary)
                        .font(.caption2.weight(counts.needsYou > 0 ? .semibold : .regular))
                        .foregroundStyle(counts.needsYou > 0 ? WatchTheme.amberWarm : WatchTheme.tealBright.opacity(0.88))
                        .lineLimit(1)
                }
                Spacer(minLength: 2)
            }
            .padding(.leading, 7)
            .padding(.trailing, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .background(
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [WatchTheme.teal.opacity(0.34), WatchTheme.tealDeep.opacity(0.75)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay(Capsule().strokeBorder(WatchTheme.tealBright.opacity(0.45), lineWidth: 0.85))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Record a voice message"))
        .accessibilityValue(Text(summary))
    }

    private func sectionHeader(for section: ThreadSection<ThreadRow>) -> some View {
        let isCollapsed = collapsed.contains(section.kind)
        return Button {
            let toggle = {
                if collapsed.contains(section.kind) {
                    collapsed.remove(section.kind)
                } else {
                    collapsed.insert(section.kind)
                }
            }
            if reduceMotion { toggle() } else { withAnimation(.easeInOut(duration: 0.2), toggle) }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 10)
                sectionIndicator(for: section.kind)
                Text(sectionTitle(for: section.kind))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(sectionTint(for: section.kind))
                Text(verbatim: "· \(section.items.count)")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(sectionTitleString(for: section.kind)), \(section.items.count)"))
        .accessibilityValue(Text(isCollapsed ? String(localized: "Collapsed") : String(localized: "Expanded")))
    }

    @ViewBuilder
    private func sectionIndicator(for kind: ThreadSectionKind) -> some View {
        switch kind {
        case .needsYou:
            Circle()
                .fill(WatchTheme.amber)
                .frame(width: 6, height: 6)
        case .working:
            if reduceMotion {
                Circle()
                    .fill(WatchTheme.tealBright)
                    .frame(width: 6, height: 6)
            } else {
                ProgressView()
                    .controlSize(.mini)
                    .tint(WatchTheme.tealBright)
                    .frame(width: 10, height: 10)
            }
        case .recent:
            Circle()
                .fill(Color.white.opacity(0.35))
                .frame(width: 6, height: 6)
        }
    }

    private func sectionTitle(for kind: ThreadSectionKind) -> LocalizedStringKey {
        switch kind {
        case .needsYou: "Needs you"
        case .working: "Working"
        case .recent: "Recent"
        }
    }

    private func sectionTitleString(for kind: ThreadSectionKind) -> String {
        switch kind {
        case .needsYou: String(localized: "Needs you")
        case .working: String(localized: "Working")
        case .recent: String(localized: "Recent")
        }
    }

    private func sectionTint(for kind: ThreadSectionKind) -> Color {
        switch kind {
        case .needsYou: WatchTheme.amberWarm
        case .working: WatchTheme.tealBright
        case .recent: .secondary
        }
    }

    private func threadRowLink(_ row: ThreadRow) -> some View {
        NavigationLink(value: ThreadTarget(roomId: model.room.id(), rootId: row.rootId ?? row.id)) {
            ThreadRowView(row: row)
        }
        .id(row.id)
        .disabled(row.rootId == nil)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 3, leading: 2, bottom: 3, trailing: 2))
        .swipeActions {
            if let rootId = row.rootId {
                Button { Task { await model.resolve(rootId) } } label: {
                    Label("Done", systemImage: "checkmark")
                }
                .tint(.green)
            } else if row.state == .failed {
                // A message that could not be sent: drop it (Delete), which also frees the queue.
                Button(role: .destructive) { Task { await model.discard(transactionId: row.id) } } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    private var summary: String {
        // Recording still works offline: the message waits in the queue.
        if session.syncState == .offline { return String(localized: "No connection") }
        return counts.needsYou + counts.running == 0 ? String(localized: "Tap to talk") : counts.summary
    }

    /// After Send: opens the message's thread once it has an id. Each recording's file has its own name.
    private func openSent(_ rows: [ThreadRow]) {
        guard let sent = following, path.isEmpty,
              let rootId = rows.first(where: { $0.voiceFile == sent })?.rootId else { return }
        following = nil
        path = [ThreadTarget(roomId: model.room.id(), rootId: rootId)]
    }

    private func takeRequest() {
        guard request.pending else { return }
        request.pending = false
        recording = true
    }
}

struct ThreadRowView: View {
    let row: ThreadRow

    private var accentBar: Color? {
        switch row.state {
        case .needsYou: WatchTheme.amber
        case .running: WatchTheme.teal
        case .failed: WatchTheme.coral
        case .idle, .queued: nil
        }
    }

    private var cardTint: Color {
        switch row.state {
        case .needsYou: WatchTheme.amber.opacity(0.14)
        case .failed: WatchTheme.coral.opacity(0.12)
        default: WatchTheme.glassFill
        }
    }

    private var cardBorder: Color {
        switch row.state {
        case .needsYou: WatchTheme.amber.opacity(0.36)
        case .running: WatchTheme.teal.opacity(0.28)
        case .failed: WatchTheme.coral.opacity(0.35)
        default: WatchTheme.glassBorder
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .center, spacing: 4) {
                Text(row.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Spacer(minLength: 4)
                chip
            }
            Text(row.line)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.leading, accentBar == nil ? 10 : 12)
        .padding(.trailing, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GlassCardBackground(
                tint: cardTint,
                border: cardBorder,
                accentBar: accentBar,
                cornerRadius: 13
            )
        )
    }

    @ViewBuilder private var chip: some View {
        switch row.state {
        case .needsYou:
            StatusPill(text: "Needs you", foreground: WatchTheme.amberWarm, background: WatchTheme.amber.opacity(0.24))
        case .running:
            StatusPill(text: "Live", foreground: WatchTheme.tealBright, background: WatchTheme.teal.opacity(0.22), showSpinner: true)
        case .queued:
            Image(systemName: "clock")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityLabel(Text("Queued"))
        case .failed:
            StatusPill(text: "Not sent", foreground: WatchTheme.coral, background: WatchTheme.coral.opacity(0.22))
        case let .idle(date):
            Text(date, format: .relative(presentation: .numeric, unitsStyle: .narrow))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
