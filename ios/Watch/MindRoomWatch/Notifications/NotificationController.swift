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
        let title = notification.request.content.title, text = notification.request.content.body
        Task { @MainActor in
            // Until the event is read, and when it cannot be (no account on the watch, a room it is not in),
            // the push's own text shows, as it would without this screen.
            model.title = title
            model.text = text
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
    /// The push's own title and text.
    @Published var title = ""
    @Published var text = ""
}

struct NotificationView: View {
    @ObservedObject var model: NotificationModel

    var body: some View {
        switch model.event {
        case let .approval(card, _, _):
            ApprovalCardView(card: card, agent: card.agentName, busy: true) { _ in }
        case let .question(question, _, _):
            VStack(alignment: .leading, spacing: 4) {
                Text(question.text).font(.headline)
                ForEach(question.options, id: \.key) { option in Text("\(option.key) \(option.label)") }
            }
        // A message whose text cannot be read (no key for it yet) keeps the push's own text, with Reply.
        case let .message(sender, text, _, _) where !text.isEmpty:
            VStack(alignment: .leading, spacing: 4) {
                Text(agentName(sender)).font(.caption.bold()).foregroundStyle(.tint)
                Text(text)
            }
        case .message, nil:
            VStack(alignment: .leading, spacing: 4) {
                if !model.title.isEmpty { Text(model.title).font(.caption.bold()) }
                Text(model.text.isEmpty ? String(localized: "New message") : model.text)
            }
        }
    }
}

/// The buttons under a MindRoom notification and what they do.
enum NotificationActions {
    static func actions(for event: PushedEvent?) -> [UNNotificationAction] {
        switch event {
        case let .approval(card, actionable, _) where actionable && card.status == .pending:
            let deny = UNNotificationAction(identifier: "deny", title: String(localized: "Deny"), options: [.destructive])
            return card.approvable ? [UNNotificationAction(identifier: "approve", title: String(localized: "Approve")), deny] : [deny]
        case let .question(question, _, _):
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
              let client = session.client else {
            // Offline, the event cannot be read: an answer is lost, a tap opens its thread once sync runs.
            if identifier == "open" { OpenThreadRequest.shared.unread = userInfo } else { notSent(userInfo) }
            return
        }
        switch event {
        case let .approval(card, actionable, roomId)
            where actionable && card.status == .pending && ((identifier == "approve" && card.approvable) || identifier == "deny"):
            let content = approvalResponseContent(cardId: card.eventId, threadId: card.threadId, approve: identifier == "approve")
            guard let room = try? client.getRoom(roomId: roomId),
                  let data = try? JSONSerialization.data(withJSONObject: content) else { return notSent(userInfo) }
            do {
                try await room.sendRaw(eventType: ApprovalCard.responseEventType, content: String(decoding: data, as: UTF8.self))
            } catch { notSent(userInfo) }
        case let .question(question, roomId, _) where identifier.hasPrefix("option:"):
            let key = String(identifier.dropFirst("option:".count))
            let content: [String: Any] = ["m.relates_to": ["rel_type": "m.annotation", "event_id": question.eventId, "key": key]]
            guard let room = try? client.getRoom(roomId: roomId),
                  let data = try? JSONSerialization.data(withJSONObject: content) else { return notSent(userInfo) }
            do {
                try await room.sendRaw(eventType: "m.reaction", content: String(decoding: data, as: UTF8.self))
            } catch { notSent(userInfo) }
        case let .message(_, _, roomId, threadId), let .question(_, roomId, threadId):
            OpenThreadRequest.shared.target = (roomId, threadId)
        case let .approval(card, _, roomId):
            OpenThreadRequest.shared.target = (roomId, card.threadId)
        }
    }

    /// Says that an answer picked on a notification did not go out; tapping it opens the thread.
    private static func notSent(_ userInfo: [AnyHashable: Any]) {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Not sent")
        content.userInfo = userInfo
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}

/// A thread to open in the app (a tapped notification).
@MainActor
final class OpenThreadRequest: ObservableObject {
    static let shared = OpenThreadRequest()
    @Published var target: (roomId: String, threadId: String)?
    /// A tapped notification whose event could not be read yet.
    var unread: [AnyHashable: Any]?
}

/// Delivers the notification's actions to `NotificationActions`.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    // On the main actor: the system's completion handler, which runs when this returns, must be called on the
    // main thread (it aborts the app otherwise).
    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let identifier = response.actionIdentifier == UNNotificationDefaultActionIdentifier ? "open" : response.actionIdentifier
        let userInfo = response.notification.request.content.userInfo
        await NotificationActions.perform(identifier, userInfo: userInfo)
    }

    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
