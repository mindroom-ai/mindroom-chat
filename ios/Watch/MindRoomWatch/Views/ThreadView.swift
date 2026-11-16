import MindRoomWatchKit
import SwiftUI

/// One thread: what it is about and every message in it, opened at what waits for the person or the newest
/// answer, with reply, done and Handoff to the iPhone.
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
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let snapshot = model.snapshot {
                        if let heading = snapshot.heading {
                            Text(heading).font(.headline)
                        }
                        ForEach(snapshot.entries) { entry in
                            switch entry {
                            case let .message(message): messageView(message, in: snapshot)
                            case let .approval(card): approvalView(card)
                            }
                        }
                        if snapshot.reply == nil {
                            Text("Sent").font(.footnote).foregroundStyle(.secondary)
                        }
                    } else {
                        ProgressView()
                    }
                    if let error = model.error {
                        Text(error).font(.footnote).foregroundStyle(.red)
                    }
                    ForEach(model.failedReplies, id: \.self) { transactionId in
                        HStack {
                            Text("Not sent").font(.footnote).foregroundStyle(.red)
                            Spacer()
                            Button("Delete", role: .destructive) { Task { await model.discard(transactionId) } }
                                .fixedSize()
                        }
                    }
                    Button { speaker.stop(); recording = true } label: {
                        Label("Reply", systemImage: "mic.fill").frame(maxWidth: .infinity)
                    }
                    .tint(.accentColor)
                    .padding(.top, 4)
                    // Marks the thread done (resolved) and goes back to the room.
                    Button {
                        Task { await roomModel.resolve(rootId); dismiss() }
                    } label: {
                        Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Opens there, and goes there again when something new waits or is answered.
            .onChange(of: model.snapshot?.focusId, initial: true) { _, focus in
                if let focus { scroll.scrollTo(focus, anchor: .top) }
            }
        }
        .task { await model.start() }
        .onChange(of: model.snapshot.map(people), initial: true) { _, people in
            if let people { Task { await roomModel.learnNames(people) } }
        }
        .onDisappear { model.stop(); speaker.stop() }
        .fullScreenCover(isPresented: $recording) {
            RecordingView { take in Task { await model.replyVoice(take) } }
        }
        // "Open on iPhone": Handoff offers the thread to the iPhone app.
        .userActivity("chat.mindroom.open-thread") { activity in
            activity.isEligibleForHandoff = true
            activity.title = model.snapshot?.title
            activity.userInfo = ["roomId": roomModel.room.id(), "threadId": rootId, "userId": roomModel.userId]
        }
        #if DEBUG
        .onChange(of: model.snapshot?.entries) { _, entries in
            for case let .message(message) in entries ?? [] where !message.isOwn {
                if let audio = message.audio, E2EHooks.listen(message.eventId) {
                    speaker.toggle(message.eventId) { try await roomModel.audio(audio) }
                }
            }
        }
        .onChange(of: speaker.current) { _, current in E2EHooks.log("sound \(current ?? "ended")") }
        .onChange(of: speaker.failed) { _, failed in if let failed { E2EHooks.log("sound failed \(failed)") } }
        #endif
    }

    /// Everyone the thread's messages are from or name.
    private func people(_ snapshot: ThreadSnapshot) -> [String] {
        snapshot.entries.flatMap { entry -> [String] in
            guard case let .message(message) = entry else { return [] }
            return [message.sender] + PlainText.mentionedUserIds(message.text)
        }
    }

    /// A message: the question it asks first (the thread opens there, and it waits for the person), the
    /// person's own without a name and dimmed, a voice message with its audio to play (the person's own only
    /// while nothing says what is in it), the newest answer with Listen.
    private func messageView(_ message: ThreadSnapshot.Message, in snapshot: ThreadSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let question = snapshot.openQuestion, question.eventId == message.eventId {
                QuestionView(question: question, busy: model.answered.contains(question.eventId)) { key in
                    Task { await model.answer(question, key: key) }
                }
            }
            if !message.isOwn {
                HStack(spacing: 4) {
                    Text(roomModel.name(message.sender)).font(.caption.bold()).foregroundStyle(.tint)
                    if message.tools > 0 {
                        Text("\(message.tools) tools").font(.caption2).foregroundStyle(.secondary)
                    }
                    if message.run == .streaming { ProgressView().controlSize(.mini) }
                }
            }
            if message.isVoiceOnly {
                Label("Voice message", systemImage: "waveform").foregroundStyle(message.isOwn ? .secondary : .primary)
            } else {
                Text(message.text.isEmpty ? "…" : roomModel.named(message.text))
                    .font(.body).foregroundStyle(message.isOwn ? .secondary : .primary)
            }
            if let audio = message.audio, !message.isOwn || message.isVoiceOnly {
                listen(message) { speaker.toggle(message.eventId) { try await roomModel.audio(audio) } }
                if speaker.failed == message.eventId {
                    Text("Could not play").font(.footnote).foregroundStyle(.red)
                }
            } else if message.eventId == snapshot.reply?.eventId, !message.text.isEmpty {
                listen(message) { speaker.toggle(message.eventId, text: roomModel.named(message.text)) }
            }
        }
    }

    private func listen(_ message: ThreadSnapshot.Message, action: @escaping () -> Void) -> some View {
        let sounds = speaker.current == message.eventId
        return Button(action: action) {
            Label(sounds ? LocalizedStringKey("Stop") : LocalizedStringKey("Listen"), systemImage: sounds ? "stop.fill" : "play.fill")
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
