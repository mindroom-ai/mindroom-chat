import MindRoomWatchKit
import SwiftUI
import UserNotifications
import WatchKit

/// The long look of a MindRoom push forwarded from the iPhone (category `MINDROOM_EVENT`): the
/// approval card, the question or the answer, read with the watch's own client, with matching actions.
final class NotificationController: WKUserNotificationHostingController<NotificationView> {
    private let model = NotificationModel()

    override var body: NotificationView { NotificationView(model: model) }

    override func didReceive(_ notification: UNNotification) {
        let userInfo = notification.request.content.userInfo
        Task { @MainActor in
            guard let session = MatrixSession.shared else { return }
            let event = await PushedEvent.load(userInfo: userInfo, session: session)
            model.event = event
            notificationActions = NotificationActions.actions(for: event)
        }
    }
}

@MainActor
final class NotificationModel: ObservableObject {
    @Published var event: PushedEvent?
}

struct NotificationView: View {
    @ObservedObject var model: NotificationModel

    var body: some View {
        switch model.event {
        case let .approval(card, _):
            ApprovalCardView(card: card, agent: card.agentName, busy: true) { _ in }
        case let .question(question, _):
            VStack(alignment: .leading, spacing: 4) {
                Text(question.text).font(.headline)
                ForEach(question.options, id: \.key) { option in Text("\(option.key) \(option.label)") }
            }
        case let .message(sender, text, _, _):
            VStack(alignment: .leading, spacing: 4) {
                Text(agentName(sender)).font(.caption.bold()).foregroundStyle(.tint)
                Text(text)
            }
        case nil:
            Text("New message")
        }
    }
}

/// The buttons under a MindRoom notification and what they do.
enum NotificationActions {
    static func actions(for event: PushedEvent?) -> [UNNotificationAction] {
        switch event {
        case let .approval(card, _) where card.status == .pending:
            return [UNNotificationAction(identifier: "approve", title: String(localized: "Approve")),
                    UNNotificationAction(identifier: "deny", title: String(localized: "Deny"), options: [.destructive])]
        case let .question(question, _):
            return question.options.map { UNNotificationAction(identifier: "option:\($0.key)", title: "\($0.key) \($0.label)") }
        case .message:
            return [UNNotificationAction(identifier: "open", title: String(localized: "Reply"), options: [.foreground])]
        default:
            return []
        }
    }

    /// Runs the action the person picked on the notification, with the watch's own client.
    @MainActor
    static func perform(_ identifier: String, userInfo: [AnyHashable: Any]) async {
        guard let session = MatrixSession.shared, let event = await PushedEvent.load(userInfo: userInfo, session: session),
              let client = session.client else { return }
        switch event {
        case let .approval(card, roomId) where card.status == .pending && (identifier == "approve" || identifier == "deny"):
            let content = approvalResponseContent(cardId: card.eventId, threadId: card.threadId, approve: identifier == "approve")
            guard let room = try? client.getRoom(roomId: roomId),
                  let data = try? JSONSerialization.data(withJSONObject: content) else { return }
            try? await room.sendRaw(eventType: ApprovalCard.responseEventType, content: String(decoding: data, as: UTF8.self))
        case let .question(question, roomId) where identifier.hasPrefix("option:"):
            let key = String(identifier.dropFirst("option:".count))
            let content: [String: Any] = ["m.relates_to": ["rel_type": "m.annotation", "event_id": question.eventId, "key": key]]
            guard let room = try? client.getRoom(roomId: roomId),
                  let data = try? JSONSerialization.data(withJSONObject: content) else { return }
            try? await room.sendRaw(eventType: "m.reaction", content: String(decoding: data, as: UTF8.self))
        case let .message(_, _, roomId, threadId):
            OpenThreadRequest.shared.target = (roomId, threadId ?? "")
        default:
            if case let .approval(card, roomId) = event { OpenThreadRequest.shared.target = (roomId, card.threadId) }
            if case let .question(question, roomId) = event { OpenThreadRequest.shared.target = (roomId, question.eventId) }
        }
    }
}

/// A thread to open in the app (a tapped notification).
@MainActor
final class OpenThreadRequest: ObservableObject {
    static let shared = OpenThreadRequest()
    @Published var target: (roomId: String, threadId: String)?
}

/// Delivers the notification's actions to `NotificationActions`.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let identifier = response.actionIdentifier == UNNotificationDefaultActionIdentifier ? "open" : response.actionIdentifier
        let userInfo = response.notification.request.content.userInfo
        await NotificationActions.perform(identifier, userInfo: userInfo)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
