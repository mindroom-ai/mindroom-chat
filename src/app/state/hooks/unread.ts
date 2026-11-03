import { useMemo } from 'react';
import { type Atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { RoomToUnread, Unread } from '../../../types/matrix/room';

const sameUnread = (a: Unread | undefined, b: Unread | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.total !== b.total || a.highlight !== b.highlight) return false;
  if (a.from === b.from) return true;
  if (!a.from || !b.from || a.from.size !== b.from.size) return false;
  return Array.from(a.from).every((roomId) => b.from?.has(roomId));
};

/** The unread entry of one room or Space; re-renders only when that entry changes. */
export const useRoomUnread = (
  roomId: string,
  roomToUnreadAtom: Atom<RoomToUnread>
): Unread | undefined => {
  const unreadAtom = useMemo(
    () => selectAtom(roomToUnreadAtom, (roomToUnread) => roomToUnread.get(roomId), sameUnread),
    [roomToUnreadAtom, roomId]
  );
  return useAtomValue(unreadAtom);
};

/**
 * The combined unread state of several rooms, counting each room once. Callers may pass a new
 * array on every render: the selector is rebuilt only when the room IDs themselves change.
 */
export const useRoomsUnread = (
  roomIds: string[],
  roomToUnreadAtom: Atom<RoomToUnread>
): Unread | undefined => {
  // A fresh selector per render would resubscribe forever, so key it by the IDs' content.
  const roomIdsKey = JSON.stringify(roomIds);
  const unreadAtom = useMemo(() => {
    const ids = JSON.parse(roomIdsKey) as string[];
    return selectAtom(
      roomToUnreadAtom,
      (roomToUnread): Unread | undefined => {
        const from = new Set<string>();
        let total = 0;
        let highlight = 0;
        ids.forEach((roomId) => {
          const unread = roomToUnread.get(roomId);
          if (!unread) return;
          // A Space entry already sums its rooms; add only rooms not counted yet.
          const rooms = unread.from ?? new Set([roomId]);
          rooms.forEach((leafId) => {
            if (from.has(leafId)) return;
            const leaf = unread.from ? roomToUnread.get(leafId) : unread;
            if (!leaf) return;
            from.add(leafId);
            total += leaf.total;
            highlight += leaf.highlight;
          });
        });
        return from.size > 0 ? { total, highlight, from } : undefined;
      },
      sameUnread
    );
  }, [roomToUnreadAtom, roomIdsKey]);
  return useAtomValue(unreadAtom);
};
