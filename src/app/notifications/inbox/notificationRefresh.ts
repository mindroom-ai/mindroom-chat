import type { INotification } from 'matrix-js-sdk';

/** Notifications loaded so far, newest first, and where the next, older page starts. */
export type NotificationList = { notifications: INotification[]; nextToken?: string };

/**
 * The list after the server was asked again for its newest notifications: its answer (`fresh`,
 * which goes on at `freshNextToken`), then the rows loaded past it, which keep the list's own
 * next page. A notification already listed keeps its object, with the read flag the server gives
 * it now, so its row renders again only when that changed; one the server no longer lists goes.
 * An answer that does not reach the rows loaded (more notifications arrived than it holds)
 * replaces them.
 */
export const mergeRefreshedNotifications = (
  held: NotificationList,
  fresh: INotification[],
  freshNextToken: string | undefined
): NotificationList => {
  const heldById = new Map(
    held.notifications.map((notification) => [notification.event.event_id, notification])
  );
  const notifications = fresh.map((notification) => {
    const kept = heldById.get(notification.event.event_id);
    if (!kept) return notification;
    return kept.read === notification.read ? kept : { ...kept, read: notification.read };
  });
  const lastId = fresh.at(-1)?.event.event_id;
  const end = held.notifications.findIndex(({ event }) => event.event_id === lastId);
  if (end === -1) return { notifications, nextToken: freshNextToken };
  return {
    notifications: [...notifications, ...held.notifications.slice(end + 1)],
    nextToken: held.nextToken,
  };
};
