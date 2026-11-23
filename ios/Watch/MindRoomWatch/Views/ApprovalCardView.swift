import MindRoomWatchKit
import SwiftUI

/// A tool call waiting for the person's OK: the agent, the tool and every argument, then Approve or Deny.
struct ApprovalCardView: View {
    let card: ApprovalCard
    let agent: String?
    let busy: Bool
    let decide: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "lock.shield.fill")
                    .font(.footnote)
                    .foregroundStyle(WatchTheme.amber)
                    .padding(.top, 1)
                    .accessibilityHidden(true)
                Text(styledTitle)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !card.arguments.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(card.arguments, id: \.key) { argument in
                        if argument.key.contains(where: \.isNewline) || argument.value.contains(where: \.isNewline) {
                            stackedArgumentRow(argument)
                        } else {
                            ViewThatFits(in: .horizontal) {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text(argument.key)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(argument.value)
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(.white.opacity(0.90))
                                        .lineLimit(1)
                                }
                                stackedArgumentRow(argument)
                            }
                        }
                    }
                }
                .padding(5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.black.opacity(0.38))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.6)
                        )
                )
            }

            if card.argumentsTruncated {
                Text("Some arguments are cut short. Open the thread on the iPhone to see them all.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            switch card.status {
            case .pending:
                if card.approvable {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 6) {
                            denyButton(singleLine: true)
                            approveButton(singleLine: true)
                        }
                        VStack(spacing: 6) {
                            approveButton(singleLine: false)
                            denyButton(singleLine: false)
                        }
                    }
                } else {
                    Text("Review it on the iPhone to approve.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    denyButton(singleLine: false)
                }
            case .approved:
                StatusPill(text: "Approved", foreground: .green, background: Color.green.opacity(0.20), systemImage: "checkmark.circle.fill")
            case .denied:
                StatusPill(text: "Denied", foreground: WatchTheme.coral, background: WatchTheme.coral.opacity(0.20), systemImage: "xmark.circle.fill")
            case .expired:
                StatusPill(text: "Expired", foreground: .secondary, background: Color.white.opacity(0.10), systemImage: "clock")
            }
        }
        .padding(.leading, card.status == .pending ? 10 : 8)
        .padding(.trailing, 8)
        .padding(.vertical, 7)
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

    private func stackedArgumentRow(_ argument: ApprovalCard.Argument) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(argument.key)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(argument.value)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.white.opacity(0.90))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var styledTitle: AttributedString {
        let raw: String = if let agent {
            String(localized: "\(agent) asks to run \(card.toolName)")
        } else {
            String(localized: "Run \(card.toolName)?")
        }
        var attributed = AttributedString(raw)
        attributed.font = .footnote.weight(.medium)
        attributed.foregroundColor = .white.opacity(0.86)
        if let range = attributed.range(of: card.toolName, options: .backwards) {
            attributed[range].font = .system(.footnote, design: .monospaced).weight(.bold)
            attributed[range].foregroundColor = WatchTheme.amberWarm
        }
        return attributed
    }

    private func approveButton(singleLine: Bool) -> some View {
        actionPill(
            title: "Approve",
            foreground: .green,
            fill: Color.green.opacity(0.22),
            border: Color.green.opacity(0.45),
            singleLine: singleLine
        ) {
            decide(true)
        }
    }

    private func denyButton(singleLine: Bool) -> some View {
        actionPill(
            title: "Deny",
            foreground: WatchTheme.coral,
            fill: WatchTheme.coral.opacity(0.20),
            border: WatchTheme.coral.opacity(0.42),
            singleLine: singleLine
        ) {
            decide(false)
        }
    }

    private func actionPill(
        title: LocalizedStringKey,
        foreground: Color,
        fill: Color,
        border: Color,
        singleLine: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if singleLine {
                    Text(title)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                } else {
                    Text(title)
                        .multilineTextAlignment(.center)
                }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity)
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
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(question.options, id: \.key) { option in
                Button { answer(option.key) } label: {
                    HStack(spacing: 8) {
                        Text(option.key)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(WatchTheme.tealBright)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(
                                Capsule()
                                    .fill(WatchTheme.teal.opacity(0.24))
                                    .overlay(Capsule().strokeBorder(WatchTheme.tealBright.opacity(0.4), lineWidth: 0.6))
                            )
                        Text(option.label)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 2)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.white.opacity(0.09))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(WatchTheme.tealBright.opacity(0.25), lineWidth: 0.75)
                            )
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
