import MindRoomWatchKit
import SwiftUI

/// One thread: what it is about and the newest agent answer, with reply, done and Handoff to the iPhone.
struct ThreadView: View {
    @ObservedObject var roomModel: RoomModel
    let rootId: String
    @StateObject private var model: ThreadModel
    @State private var recording = false
    @StateObject private var speaker = Speaker()
    @Environment(\.dismiss) private var dismiss

    init(roomModel: RoomModel, rootId: String) {
        self.roomModel = roomModel
        self.rootId = rootId
        _model = StateObject(wrappedValue: ThreadModel(room: roomModel.room, rootId: rootId, userId: roomModel.userId,
                                                       initial: roomModel.snapshot(of: rootId)))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let snapshot = model.snapshot {
                    Text(snapshot.title).font(.headline)
                    // What waits for the person comes first.
                    if let card = snapshot.pendingApproval {
                        approvalView(card)
                    }
                    if let question = snapshot.openQuestion {
                        QuestionView(question: question, busy: model.answered.contains(question.eventId)) { key in
                            Task { await model.answer(question, key: key) }
                        }
                    }
                    if let reply = snapshot.reply {
                        HStack(spacing: 4) {
                            Text(roomModel.name(reply.sender)).font(.caption.bold()).foregroundStyle(.tint)
                            if reply.tools > 0 {
                                Text("\(reply.tools) tools").font(.caption2).foregroundStyle(.secondary)
                            }
                            if reply.run == .streaming { ProgressView().controlSize(.mini) }
                        }
                        Text(reply.text.isEmpty ? "…" : roomModel.named(reply.text)).font(.body)
                        if !reply.text.isEmpty {
                            Button { speaker.toggle(roomModel.named(reply.text)) } label: {
                                Label(speaker.speaking ? "Stop" : "Listen", systemImage: speaker.speaking ? "stop.fill" : "play.fill")
                            }
                        }
                    } else {
                        Text("Sent").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let card = snapshot.approvals.last, card.status != .pending {
                        approvalView(card)
                    }
                } else {
                    ProgressView()
                }
                if let error = model.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                HStack {
                    Button { recording = true } label: { Image(systemName: "mic.fill") }
                        .accessibilityLabel(Text("Reply"))
                        .tint(.accentColor)
                    Button {
                        Task { await roomModel.resolve(rootId); dismiss() }
                    } label: { Image(systemName: "checkmark") }
                        .accessibilityLabel(Text("Done"))
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { await model.start() }
        .onChange(of: model.snapshot?.reply) { _, reply in
            if let reply { Task { await roomModel.learnNames([reply.sender] + PlainText.mentionedUserIds(reply.text)) } }
        }
        .onDisappear { model.stop() }
        .fullScreenCover(isPresented: $recording) {
            RecordingView { take in Task { await model.replyVoice(take) } }
        }
        // "Open on iPhone": Handoff offers the thread to the iPhone app.
        .userActivity("chat.mindroom.open-thread") { activity in
            activity.isEligibleForHandoff = true
            activity.title = model.snapshot?.title
            activity.userInfo = ["roomId": roomModel.room.id(), "threadId": rootId]
        }
    }

    private func approvalView(_ card: ApprovalCard) -> some View {
        ApprovalCardView(card: card, agent: card.agentName, busy: model.answered.contains(card.eventId)) { yes in
            Task { await model.approve(card, yes) }
        }
    }
}

func agentName(_ userId: String) -> String {
    let local = userId.dropFirst().split(separator: ":").first.map(String.init) ?? userId
    return local.hasPrefix("mindroom_") ? String(local.dropFirst("mindroom_".count)).capitalized : local
}
