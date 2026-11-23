import MindRoomWatchKit
import SwiftUI

/// One thread: what it is about and every message in it, opened at what waits for the person or the newest
/// answer, with a floating done/reply bottom toolbar, expandable work folds, and Handoff to the iPhone.
struct ThreadView: View {
    @ObservedObject var roomModel: RoomModel
    let rootId: String
    @StateObject private var model: ThreadModel
    @State private var recording = false
    @State private var expandedWork: Set<String> = []
    @StateObject private var speaker = Speaker()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(roomModel: RoomModel, rootId: String) {
        self.roomModel = roomModel
        self.rootId = rootId
        _model = StateObject(wrappedValue: ThreadModel(room: roomModel.room, rootId: rootId, userId: roomModel.userId,
                                                       trust: roomModel.trust,
                                                       initial: roomModel.snapshot(of: rootId), events: roomModel.events(of: rootId),
                                                       refreshTrust: { [weak roomModel] in roomModel?.readStateIfDue() }))
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    if let snapshot = model.snapshot {
                        if let heading = snapshot.heading {
                            Text(heading)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(WatchTheme.tealBright.opacity(0.92))
                                .padding(.horizontal, 4)
                                .accessibilityAddTraits(.isHeader)
                        }
                        ForEach(snapshot.entries) { entry in
                            switch entry {
                            case let .message(message): messageView(message, in: snapshot)
                            case let .approval(card): approvalView(card)
                            }
                        }
                        if snapshot.reply == nil {
                            Text("Sent")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 4)
                        }
                    } else {
                        ProgressView()
                            .tint(WatchTheme.tealBright)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 16)
                    }
                    if let error = model.error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(WatchTheme.coral)
                            .padding(.horizontal, 4)
                    }
                    ForEach(model.failedReplies, id: \.self) { transactionId in
                        HStack {
                            Text("Not sent").font(.footnote).foregroundStyle(WatchTheme.coral)
                            Spacer()
                            Button("Delete", role: .destructive) { Task { await model.discard(transactionId) } }
                                .fixedSize()
                        }
                        .padding(8)
                        .background(
                            GlassCardBackground(
                                tint: WatchTheme.coral.opacity(0.12),
                                border: WatchTheme.coral.opacity(0.32),
                                cornerRadius: 12
                            )
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 40)
            }
            // Opens at the top of what waits (so an approval card's tool name is always read first) or the newest answer.
            .onChange(of: model.snapshot?.focusId, initial: true) { _, focus in
                if let focus { scroll.scrollTo(focus, anchor: .top) }
            }
        }
        .containerBackground(for: .navigation) {
            WatchTheme.threadBackground
        }
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                // Marks the thread done (resolved) and goes back to the room.
                Button {
                    Task { await roomModel.resolve(rootId); dismiss() }
                } label: {
                    Label("Done", systemImage: "checkmark")
                        .labelStyle(.iconOnly)
                }
                Spacer()
                Button {
                    speaker.stop()
                    recording = true
                } label: {
                    Label("Reply", systemImage: "mic.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(WatchTheme.tealInk)
                }
                .buttonStyle(.glassProminent)
                .tint(WatchTheme.teal)
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

    @ViewBuilder
    private func messageView(_ message: ThreadSnapshot.Message, in snapshot: ThreadSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let question = snapshot.openQuestion, question.eventId == message.eventId {
                QuestionView(question: question, busy: model.answered.contains(question.eventId)) { key in
                    Task { await model.answer(question, key: key) }
                }
            }
            if message.isOwn {
                ownMessageBubble(message)
            } else {
                agentMessageCard(message, in: snapshot)
            }
        }
    }

    private func ownMessageBubble(_ message: ThreadSnapshot.Message) -> some View {
        HStack {
            Spacer(minLength: 16)
            VStack(alignment: .leading, spacing: 5) {
                if message.isVoiceOnly {
                    Label("Voice message", systemImage: "waveform")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.88))
                } else {
                    Text(message.text.isEmpty ? "…" : roomModel.named(message.text))
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.90))
                }
                if let audio = message.audio, message.isVoiceOnly {
                    listen(message) { speaker.toggle(message.eventId) { try await roomModel.audio(audio) } }
                    if speaker.failed == message.eventId {
                        Text("Could not play").font(.caption2).foregroundStyle(WatchTheme.coral)
                    }
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(
                GlassCardBackground(
                    tint: Color.white.opacity(0.11),
                    border: Color.white.opacity(0.16),
                    cornerRadius: 14
                )
            )
        }
    }

    private func agentMessageCard(_ message: ThreadSnapshot.Message, in snapshot: ThreadSnapshot) -> some View {
        let senderName = roomModel.name(message.sender)
        let showsWorkFold = !message.toolNames.isEmpty || message.workText != nil
        let displayText = message.answerText.isEmpty ? message.text : message.answerText
        let onListen = listenAction(for: message, in: snapshot)
        return VStack(alignment: .leading, spacing: 5) {
            if let onListen {
                ViewThatFits(in: .horizontal) {
                    agentHeader(message, senderName: senderName, showsWorkFold: showsWorkFold,
                                onListen: onListen, iconOnlyListen: false)
                    agentHeader(message, senderName: senderName, showsWorkFold: showsWorkFold,
                                onListen: onListen, iconOnlyListen: true)
                }
            } else {
                agentHeader(message, senderName: senderName, showsWorkFold: showsWorkFold,
                            onListen: nil, iconOnlyListen: false)
            }
            if speaker.failed == message.eventId {
                Text("Could not play").font(.footnote).foregroundStyle(WatchTheme.coral)
            }
            if showsWorkFold {
                WorkFoldView(
                    message: message,
                    namedWorkText: message.workText.map(roomModel.named),
                    expanded: expandedWork.contains(message.eventId),
                    reduceMotion: reduceMotion
                ) {
                    let toggle = {
                        if expandedWork.contains(message.eventId) {
                            expandedWork.remove(message.eventId)
                        } else {
                            expandedWork.insert(message.eventId)
                        }
                    }
                    if reduceMotion { toggle() } else { withAnimation(.easeInOut(duration: 0.2), toggle) }
                }
            }
            if message.isVoiceOnly {
                Label("Voice message", systemImage: "waveform")
                    .font(.body)
                    .foregroundStyle(.primary)
            } else {
                Text(displayText.isEmpty ? "…" : roomModel.named(displayText))
                    .font(.body)
                    .foregroundStyle(.primary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GlassCardBackground(
                tint: WatchTheme.teal.opacity(0.13),
                border: WatchTheme.tealBright.opacity(0.26),
                cornerRadius: 14
            )
        )
    }

    private func agentHeader(_ message: ThreadSnapshot.Message, senderName: String, showsWorkFold: Bool,
                             onListen: (() -> Void)?, iconOnlyListen: Bool) -> some View {
        HStack(spacing: 5) {
            AgentMonogram(name: senderName)
            Text(senderName)
                .font(.caption.bold())
                .foregroundStyle(WatchTheme.tealBright)
                .lineLimit(1)
            Spacer(minLength: 2)
            if !showsWorkFold && message.tools > 0 {
                Text(message.tools == 1 ? String(localized: "1 tool") : String(localized: "\(message.tools) tools"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            // The work fold has its own mark of a run that goes on.
            if !showsWorkFold && message.run == .streaming {
                if reduceMotion {
                    Circle()
                        .fill(WatchTheme.tealBright)
                        .frame(width: 6, height: 6)
                } else {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(WatchTheme.tealBright)
                }
            }
            if let onListen {
                listen(message, compact: true, iconOnly: iconOnlyListen, action: onListen)
            }
        }
    }

    private func listenAction(for message: ThreadSnapshot.Message, in snapshot: ThreadSnapshot) -> (() -> Void)? {
        if let audio = message.audio {
            return { speaker.toggle(message.eventId) { try await roomModel.audio(audio) } }
        }
        if message.eventId == snapshot.reply?.eventId, !message.text.isEmpty {
            let spoken = message.answerText.isEmpty ? message.text : message.answerText
            return { speaker.toggle(message.eventId, text: roomModel.named(spoken)) }
        }
        return nil
    }

    private func listen(_ message: ThreadSnapshot.Message, compact: Bool = false, iconOnly: Bool = false,
                        action: @escaping () -> Void) -> some View {
        let sounds = speaker.current == message.eventId
        let horizontal: CGFloat = compact ? 7 : 10
        let vertical: CGFloat = compact ? 3 : 5
        let top: CGFloat = compact ? 0 : 2
        return Button(action: action) {
            Group {
                if iconOnly {
                    Label(sounds ? LocalizedStringKey("Stop") : LocalizedStringKey("Listen"),
                          systemImage: sounds ? "stop.fill" : "play.fill")
                        .labelStyle(.iconOnly)
                } else {
                    Label(sounds ? LocalizedStringKey("Stop") : LocalizedStringKey("Listen"),
                          systemImage: sounds ? "stop.fill" : "play.fill")
                }
            }
            .font((compact ? Font.caption2 : Font.caption).weight(.bold))
            .foregroundStyle(sounds ? WatchTheme.tealInk : WatchTheme.tealBright)
            .padding(.horizontal, horizontal)
            .padding(.vertical, vertical)
            .background(
                Capsule()
                    .fill(sounds ? WatchTheme.tealBright : WatchTheme.teal.opacity(0.22))
                    .overlay(Capsule().strokeBorder(WatchTheme.tealBright.opacity(0.38), lineWidth: 0.75))
            )
        }
        .buttonStyle(.plain)
        .fixedSize()
        .padding(.top, top)
    }

    private func approvalView(_ card: ApprovalCard) -> some View {
        ApprovalCardView(card: card, agent: card.agentName, busy: model.answered.contains(card.eventId)) { yes in
            Task { await model.approve(card, yes) }
        }
    }
}

/// Expandable in-card fold showing an agent reply's tool calls and intermediate work prose.
private struct WorkFoldView: View {
    let message: ThreadSnapshot.Message
    let namedWorkText: String?
    let expanded: Bool
    let reduceMotion: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button(action: toggle) {
                HStack(spacing: 5) {
                    leadingIcon
                    labelText
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.84))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                    Spacer(minLength: 2)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8.5, weight: .bold))
                        .foregroundStyle(WatchTheme.tealBright.opacity(0.85))
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.09))
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 0.6))
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
            .accessibilityValue(Text(expanded ? String(localized: "Expanded") : String(localized: "Collapsed")))

            if expanded {
                VStack(alignment: .leading, spacing: 5) {
                    if let workText = namedWorkText, !workText.isEmpty {
                        Text(workText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if !message.toolNames.isEmpty {
                        VStack(alignment: .leading, spacing: 3) {
                            ForEach(Array(message.toolNames.enumerated()), id: \.offset) { _, tool in
                                HStack(alignment: .top, spacing: 4) {
                                    Image(systemName: "wrench.fill")
                                        .font(.system(size: 8))
                                        .foregroundStyle(WatchTheme.tealBright.opacity(0.85))
                                        .padding(.top, 3)
                                    Text(tool)
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(.white.opacity(0.85))
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                }
                .padding(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(Color.black.opacity(0.34))
                        .overlay(
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.09), lineWidth: 0.6)
                        )
                )
            }
        }
    }

    @ViewBuilder private var leadingIcon: some View {
        if message.run == .streaming {
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
        } else if message.durationSeconds != nil {
            Image(systemName: "clock")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(WatchTheme.tealBright)
        } else {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(WatchTheme.tealBright)
        }
    }

    @ViewBuilder private var labelText: some View {
        if message.run == .streaming {
            if message.tools > 0 {
                Text(verbatim: "\(String(localized: "Working…")) · \(message.tools)")
            } else {
                Text("Working…")
            }
        } else if let secs = message.durationSeconds {
            let worked = String(localized: "Worked for \(DurationLabel.format(seconds: secs))")
            if message.tools > 0 {
                Text(verbatim: "\(worked) · \(message.tools)")
            } else {
                Text(worked)
            }
        } else if message.tools == 1 {
            Text("1 tool")
        } else {
            Text("\(message.tools) tools")
        }
    }

    private var accessibilityLabel: String {
        let toolLabel: String? = message.tools == 0 ? nil : (message.tools == 1 ? String(localized: "1 tool") : String(localized: "\(message.tools) tools"))
        if message.run == .streaming {
            let working = String(localized: "Working…")
            return toolLabel.map { "\(working), \($0)" } ?? working
        }
        if let secs = message.durationSeconds {
            let worked = String(localized: "Worked for \(DurationLabel.format(seconds: secs))")
            return toolLabel.map { "\(worked), \($0)" } ?? worked
        }
        return toolLabel ?? String(localized: "Working")
    }
}

func agentName(_ userId: String) -> String {
    let local = userId.dropFirst().split(separator: ":").first.map(String.init) ?? userId
    return local.hasPrefix("mindroom_") ? String(local.dropFirst("mindroom_".count)).capitalized : local
}
