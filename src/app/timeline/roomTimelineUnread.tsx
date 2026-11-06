import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icons, config } from 'folds';
import * as css from './RoomTimeline.css';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { getRoomUnreadInfo } from '../event-store/timeline/timelinePagination';
import { useViewScopedState } from './roomTimelineViewScope';
import { EXPAND_ALL_START_COLUMN, FloatingAction } from './RoomTimelineOverlays';

/**
 * The room's read marker as the timeline shows it: the "New messages" line, and the Jump to
 * Unread and Mark as Read pills while that line is out of view.
 */

export type RoomUnread = ReturnType<typeof getRoomUnreadInfo>;

/**
 * The read marker of the room on screen, read when the room opens: the timeline stays mounted
 * across rooms, so another room reads its own marker in that render. `skip` (a thread or an
 * event the room opens at) leaves it empty. Updates meant for a room no longer shown are dropped.
 */
export const useRoomUnreadInfo = (
  room: Room,
  skip: boolean
): [RoomUnread, Dispatch<SetStateAction<RoomUnread>>] =>
  useViewScopedState<RoomUnread>(room.roomId, () =>
    skip ? undefined : getRoomUnreadInfo(room, true)
  );

/** Whether `element` is (partly) inside the visible area of the scroll container `area`. */
export const useShownInScrollArea = (element: Element | null, area: Element | null): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!element || !area || typeof IntersectionObserver === 'undefined') {
      setShown(false);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        if (latest) setShown(latest.isIntersecting);
      },
      { root: area }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, area]);
  return shown;
};

/**
 * Jump to Unread is offered in the room (not a thread) while it has a marker, the marker is older
 * than the live rows or the room still counts as unread, and the "New messages" line it jumps to
 * is out of view.
 */
export const offersJumpToUnread = ({
  threadId,
  unreadInfo,
  roomUnread,
  unreadMarkerShown,
}: {
  threadId: string | undefined;
  unreadInfo: RoomUnread;
  roomUnread: boolean;
  unreadMarkerShown: boolean;
}): boolean =>
  !threadId &&
  !!unreadInfo?.readUptoEventId &&
  (!unreadInfo.inLiveTimeline || roomUnread) &&
  !unreadMarkerShown;

/**
 * Mark as Read sends the receipt; in the room nothing is unread afterwards, so the line and the
 * pill go, also for a marker older than the rows.
 */
export const useMarkRoomAsRead = (
  handleMarkAsRead: () => void,
  setUnreadInfo: Dispatch<SetStateAction<RoomUnread>>,
  threadId: string | undefined
) =>
  useCallback(() => {
    handleMarkAsRead();
    if (!threadId) setUnreadInfo(undefined);
  }, [handleMarkAsRead, setUnreadInfo, threadId]);

/**
 * The Jump to Unread and Mark as Read pills, under the room header, centered; `clearStart` centers
 * them past the start column where "[+all]" sits meanwhile, at the same height (a phone).
 */
export function UnreadActions({
  onJumpToUnread,
  onMarkAsRead,
  clearStart = false,
}: {
  onJumpToUnread: () => void;
  onMarkAsRead: () => void;
  clearStart?: boolean;
}) {
  const { t } = useTranslation();
  // The float keeps a margin of S400 on each side of the area it is centered in.
  const startInset = `calc(${EXPAND_ALL_START_COLUMN} - ${config.space.S400})`;
  return (
    <div
      className={css.TimelineFloat({ position: 'Top' })}
      style={{
        top: `calc(${overlay.controlsTopInset} + ${config.space.S300})`,
        ...(clearStart
          ? {
              insetInlineStart: startInset,
              maxWidth: `calc(100% - ${startInset} - ${config.space.S400} * 2)`,
            }
          : {}),
      }}
    >
      <FloatingAction
        primary
        icon={Icons.MessageUnread}
        label={t('mindroomUi.threads.mindroomRoomTimeline.jumpToUnread')}
        onSelect={onJumpToUnread}
      />
      <FloatingAction
        icon={Icons.CheckTwice}
        label={t('mindroomUi.threads.mindroomRoomTimeline.markAsRead')}
        onSelect={onMarkAsRead}
      />
    </div>
  );
}
