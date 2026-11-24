import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { desktopBridge } from '../lib/nativeShell';
import type { RoomToUnread } from '../matrix/types/room';
import { navigationRoomToUnreadAtom } from './navigationUnread';

/** Notifications across the rooms the navigation shows; Space entries only repeat their rooms. */
export const countRoomNotifications = (roomToUnread: RoomToUnread): number => {
  let total = 0;
  roomToUnread.forEach((unread) => {
    if (!unread.from) total += unread.total;
  });
  return total;
};

/** The page title with the notification count in front, as browser tabs show it. */
export const titleWithCount = (base: string, count: number): string =>
  count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;

/**
 * Puts the account's notification count in the page title, so a background tab shows that
 * messages wait. The title the page had when this mounted comes back on unmount.
 */
export function UnreadTitleFeature() {
  const count = countRoomNotifications(useAtomValue(navigationRoomToUnreadAtom));
  const base = useRef<string>(undefined);

  useEffect(() => {
    base.current = document.title;
    return () => {
      if (base.current !== undefined) document.title = base.current;
      desktopBridge()?.setBadge(0);
    };
  }, []);

  useEffect(() => {
    if (base.current !== undefined) document.title = titleWithCount(base.current, count);
    desktopBridge()?.setBadge(count);
  }, [count]);

  return null;
}
