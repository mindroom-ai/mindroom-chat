import MatrixRustSDK
import MindRoomWatchKit
import SwiftUI

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
                        .navigationDestination(for: ThreadTarget.self) { target in
                            if let roomModel = roomModel(target.roomId) {
                                ThreadView(roomModel: roomModel, rootId: target.rootId)
                            }
                        }
                } else {
                    RoomPickerView(rooms: rooms, selected: nil, pick: select)
                }
            }
            .sheet(isPresented: $picking) {
                RoomPickerView(rooms: rooms, selected: model?.room.id(), pick: select)
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
        .onChange(of: rooms.rooms) { _, _ in
            // At launch the default room may reach the room list only after the first sync.
            if model == nil, let roomId = DefaultRoom.get(userId: userId) { open(roomId) }
        }
        .onChange(of: openThread.target?.threadId, initial: true) { _, _ in
            // A tapped notification opens its thread; another room's thread opens without making it the default.
            guard model != nil, let target = openThread.target else { return }
            openThread.target = nil
            if !target.threadId.isEmpty { path = [ThreadTarget(roomId: target.roomId, rootId: target.threadId)] }
        }
        .onOpenURL { url in
            // The complication opens the app recording (`mindroom-watch://record`).
            if url.host == "record" { RecordRequest.shared.pending = true }
        }
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
        model = nil
    }

    private func roomModel(_ roomId: String) -> RoomModel? {
        if model?.room.id() == roomId { return model }
        if let other = otherRooms[roomId] { return other }
        guard let room = try? client.getRoom(roomId: roomId) else { return nil }
        let other = RoomModel(room: room, userId: userId, session: try? client.session())
        otherRooms[roomId] = other
        return other
    }

    private func open(_ roomId: String) {
        guard model?.room.id() != roomId, let room = try? client.getRoom(roomId: roomId) else { return }
        let model = RoomModel(room: room, userId: userId, session: try? client.session())
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
    @State private var recording = false
    @State private var sendError: String?
    /// The threads there were when a voice message went out: the first new one is its thread, opened once it has an id.
    @State private var following: Set<String>?

    var body: some View {
        List {
            Section {
                // The room's name switches rooms.
                Button(action: pick) {
                    HStack(spacing: 4) {
                        Text(model.roomName).font(.headline).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2.bold()).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Rooms"))
                .listRowBackground(Color.clear)
                Button { recording = true } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 40, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 84)
                }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)
                .clipShape(Circle())
                .accessibilityLabel(Text("Record a voice message"))
                .listRowBackground(Color.clear)
                if let sendError {
                    Text(sendError).font(.footnote).foregroundStyle(.red)
                }
                Text(summary).font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
            Section {
                ForEach(model.rows) { row in
                    NavigationLink(value: ThreadTarget(roomId: model.room.id(), rootId: row.rootId ?? row.id)) {
                        ThreadRowView(row: row)
                    }
                    .disabled(row.rootId == nil)
                    .swipeActions {
                        if let rootId = row.rootId {
                            Button { Task { await model.resolve(rootId) } } label: {
                                Label("Done", systemImage: "checkmark")
                            }
                            .tint(.green)
                        } else if row.state == .failed {
                            // A message that could not be sent: send it again, or drop it.
                            Button { Task { await model.retry() } } label: {
                                Label("Retry", systemImage: "arrow.clockwise")
                            }
                            .tint(.accentColor)
                            Button(role: .destructive) { Task { await model.discard(transactionId: row.id) } } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $recording) {
            RecordingView { take in
                following = Set(model.rows.compactMap(\.rootId))
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

    private var summary: String {
        // Recording still works offline: the message waits in the queue.
        if session.syncState == .offline { return String(localized: "No connection") }
        let counts = WidgetSnapshot(roomName: model.roomName, states: model.rows.map(\.state), at: Date())
        return counts.needsYou + counts.running == 0 ? String(localized: "Tap to talk") : counts.summary
    }

    /// After Send: opens the message's thread once it has an id, if it is the room's newest.
    private func openSent(_ rows: [ThreadRow]) {
        guard let known = following, path.isEmpty,
              let newest = rows.filter({ $0.rootId != nil }).max(by: { $0.rootTs < $1.rootTs }),
              let rootId = newest.rootId, !known.contains(rootId) else { return }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.title).font(.headline).lineLimit(1)
                Spacer(minLength: 4)
                chip
            }
            Text(row.line).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    @ViewBuilder private var chip: some View {
        switch row.state {
        case .needsYou: Text("Needs you").font(.caption2.bold()).foregroundStyle(.orange)
        case .running: ProgressView().controlSize(.mini).frame(width: 14, height: 14)
        case .unread: Circle().fill(Color.accentColor).frame(width: 7, height: 7).accessibilityLabel(Text("New"))
        case .queued: Image(systemName: "clock").font(.caption2).accessibilityLabel(Text("Queued"))
        case .failed: Text("Not sent").font(.caption2.bold()).foregroundStyle(.red)
        case let .idle(date): Text(date, format: .relative(presentation: .numeric, unitsStyle: .narrow)).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
