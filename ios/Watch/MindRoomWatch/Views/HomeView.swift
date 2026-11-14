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
    @State private var path: [String] = []
    @ObservedObject private var openThread = OpenThreadRequest.shared

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let model {
                    RoomHome(model: model, path: $path, pick: { picking = true })
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
        .onChange(of: openThread.target?.threadId) { _, _ in
            // A tapped notification: its room becomes the default and its thread opens.
            guard let target = openThread.target else { return }
            openThread.target = nil
            if model?.room.id() != target.roomId { select(target.roomId) }
            if !target.threadId.isEmpty { path = [target.threadId] }
        }
        .onChange(of: model?.gone ?? false) { _, gone in
            // The room was left or replaced: choose another.
            if gone { DefaultRoom.set(nil, userId: userId); model = nil }
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

private struct RoomHome: View {
    @ObservedObject var model: RoomModel
    @Binding var path: [String]
    let pick: () -> Void
    @ObservedObject private var request = RecordRequest.shared
    @State private var recording = false
    @State private var sendError: String?

    var body: some View {
        List {
            Section {
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
                    NavigationLink(value: row.rootId ?? row.id) { ThreadRowView(row: row) }
                        .disabled(row.rootId == nil)
                        .swipeActions {
                            if let rootId = row.rootId {
                                Button { Task { await model.resolve(rootId) } } label: {
                                    Label("Done", systemImage: "checkmark")
                                }
                                .tint(.green)
                            }
                        }
                }
            }
        }
        .navigationTitle(model.roomName)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: pick) { Image(systemName: "list.bullet") }
                    .accessibilityLabel(Text("Rooms"))
            }
        }
        .navigationDestination(for: String.self) { rootId in
            ThreadView(roomModel: model, rootId: rootId)
        }
        .fullScreenCover(isPresented: $recording) {
            RecordingView { take in
                Task {
                    do { sendError = nil; try await model.sendVoice(take) } catch { sendError = String(localized: "Not sent") }
                }
            }
        }
        .onAppear { takeRequest() }
        .onChange(of: request.pending) { _, _ in takeRequest() }
        #if DEBUG
        .onChange(of: model.rows) { _, rows in
            // The thread of the message the hooks just sent: the newest root, once it has an event id.
            if E2EHooks.openNewest, path.isEmpty, let row = rows.max(by: { $0.rootTs < $1.rootTs }),
               row.rootTs >= E2EHooks.launchedAt, let rootId = row.rootId { path = [rootId] }
            if E2EHooks.resolveNewest, !E2EHooks.resolved, let rootId = rows.first(where: { $0.state != .queued })?.rootId {
                E2EHooks.resolved = true
                Task { await model.resolve(rootId); E2EHooks.log("resolved \(rootId)") }
            }
        }
        #endif
    }

    private var summary: String {
        let counts = WidgetSnapshot(roomName: model.roomName, states: model.rows.map(\.state), at: Date())
        return counts.needsYou + counts.running == 0 ? String(localized: "Tap to talk") : counts.summary
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
