import MindRoomWatchKit
import SwiftUI

/// A tool call waiting for the person's OK: the agent, the tool and every argument, then Approve or Deny.
struct ApprovalCardView: View {
    let card: ApprovalCard
    let agent: String?
    let busy: Bool
    let decide: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 7) {
                Image(systemName: "lock.shield.fill")
                    .font(.body)
                    .foregroundStyle(WatchTheme.amber)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 1) {
                    if let agent {
                        Text("\(agent) asks to run")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        Text("Run")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Text(card.toolName)
                        .font(.system(.footnote, design: .monospaced).weight(.bold))
                        .foregroundStyle(WatchTheme.amberWarm)
                        .lineLimit(2)
                }
            }

            if !card.arguments.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(card.arguments, id: \.key) { argument in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(argument.key)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(argument.value)
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.white.opacity(0.88))
                        }
                    }
                }
                .padding(7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(Color.black.opacity(0.38))
                        .overlay(
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.6)
                        )
                )
            }

            if card.argumentsTruncated {
                Text("Some arguments are cut short. Open the thread on the iPhone to see them all.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            switch card.status {
            case .pending:
                if card.approvable {
                    HStack(spacing: 6) {
                        actionPill(title: "Deny", foreground: WatchTheme.coral, fill: WatchTheme.coral.opacity(0.20), border: WatchTheme.coral.opacity(0.42)) {
                            decide(false)
                        }
                        actionPill(title: "Approve", foreground: .green, fill: Color.green.opacity(0.22), border: Color.green.opacity(0.45)) {
                            decide(true)
                        }
                    }
                } else {
                    Text("Review it on the iPhone to approve.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    actionPill(title: "Deny", foreground: WatchTheme.coral, fill: WatchTheme.coral.opacity(0.20), border: WatchTheme.coral.opacity(0.42)) {
                        decide(false)
                    }
                }
            case .approved:
                StatusPill(text: "Approved", foreground: .green, background: Color.green.opacity(0.20), systemImage: "checkmark.circle.fill")
            case .denied:
                StatusPill(text: "Denied", foreground: WatchTheme.coral, background: WatchTheme.coral.opacity(0.20), systemImage: "xmark.circle.fill")
            case .expired:
                StatusPill(text: "Expired", foreground: .secondary, background: Color.white.opacity(0.10), systemImage: "clock")
            }
        }
        .padding(.leading, card.status == .pending ? 12 : 10)
        .padding(.trailing, 10)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GlassCardBackground(
                tint: WatchTheme.amber.opacity(0.11),
                border: WatchTheme.amber.opacity(0.42),
                accentBar: card.status == .pending ? WatchTheme.amber : nil,
                cornerRadius: 14
            )
        )
    }

    private func actionPill(title: LocalizedStringKey, foreground: Color, fill: Color, border: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(
                    Capsule()
                        .fill(fill)
                        .overlay(Capsule().strokeBorder(border, lineWidth: 0.75))
                )
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy ? 0.5 : 1)
    }
}

/// An agent's multiple-choice question: one button per option, answered with its reaction.
struct QuestionView: View {
    let question: Question
    let busy: Bool
    let answer: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if !question.text.isEmpty {
                Text(question.text)
                    .font(.headline)
                    .foregroundStyle(.white)
            }
            ForEach(question.options, id: \.key) { option in
                Button { answer(option.key) } label: {
                    HStack(spacing: 8) {
                        Text(option.key)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(WatchTheme.tealBright)
                            .frame(width: 22, height: 22)
                            .background(
                                Circle()
                                    .fill(WatchTheme.teal.opacity(0.24))
                                    .overlay(Circle().strokeBorder(WatchTheme.tealBright.opacity(0.4), lineWidth: 0.6))
                            )
                        Text(option.label)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 2)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(0.09))
                            .overlay(Capsule().strokeBorder(WatchTheme.tealBright.opacity(0.25), lineWidth: 0.75))
                    )
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .opacity(busy ? 0.5 : 1)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GlassCardBackground(
                tint: WatchTheme.amber.opacity(0.09),
                border: WatchTheme.amber.opacity(0.32),
                accentBar: WatchTheme.amber,
                cornerRadius: 14
            )
        )
    }
}
