import MindRoomWatchKit
import SwiftUI

/// A tool call waiting for the person's OK: the agent, the tool and every argument, then Approve or Deny.
struct ApprovalCardView: View {
    let card: ApprovalCard
    let agent: String?
    let busy: Bool
    let decide: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label {
                Text(title).font(.headline)
            } icon: {
                Image(systemName: "lock.shield").foregroundStyle(.orange)
            }
            ForEach(card.arguments, id: \.key) { argument in
                VStack(alignment: .leading, spacing: 1) {
                    Text(argument.key).font(.caption2).foregroundStyle(.secondary)
                    Text(argument.value).font(.footnote)
                }
            }
            if card.argumentsTruncated {
                Text("Some arguments are cut short. Open the thread on the iPhone to see them all.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            switch card.status {
            case .pending:
                if card.approvable {
                    Button { decide(true) } label: { Text("Approve").frame(maxWidth: .infinity) }
                        .tint(.green)
                        .disabled(busy)
                } else {
                    Text("Review it on the iPhone to approve.").font(.caption2).foregroundStyle(.secondary)
                }
                Button(role: .destructive) { decide(false) } label: { Text("Deny").frame(maxWidth: .infinity) }
                    .disabled(busy)
            case .approved:
                Text("Approved").font(.footnote.bold()).foregroundStyle(.green)
            case .denied:
                Text("Denied").font(.footnote.bold()).foregroundStyle(.red)
            case .expired:
                Text("Expired").font(.footnote.bold()).foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.gray.opacity(0.2)))
    }

    private var title: String {
        if let agent { return String(localized: "\(agent) asks to run \(card.toolName)") }
        return String(localized: "Run \(card.toolName)?")
    }
}

/// An agent's multiple-choice question: one button per option, answered with its reaction.
struct QuestionView: View {
    let question: Question
    let busy: Bool
    let answer: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !question.text.isEmpty { Text(question.text).font(.headline) }
            ForEach(question.options, id: \.key) { option in
                Button { answer(option.key) } label: {
                    Text("\(option.key) \(option.label)").frame(maxWidth: .infinity, alignment: .leading)
                }
                .disabled(busy)
            }
        }
    }
}
