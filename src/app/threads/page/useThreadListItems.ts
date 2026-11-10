import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMinuteClock } from '../../lib/hooks/useMinuteClock';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { crossRoomThreadIndexAtom } from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { getThreadSignalsReader } from '../cross-room/threadSignalsReader';
import type { ThreadListItem } from './threadGroups';

const QUIET: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

/**
 * Every thread of the cross-room index with its signals, for the Threads page, from the client's
 * shared signals cache (which Activity fills too), checked again when a room's unread counts
 * change and every minute.
 */
export const useThreadListItems = (): ThreadListItem[] => {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const now = useMinuteClock();
  // Unread counts change with no index change (the sync after a read clears a mention count), and
  // move only when they do.
  const roomUnreads = useAtomValue(roomToUnreadAtom);

  return useMemo(() => {
    const reader = getThreadSignalsReader(mx);
    return Array.from(index.entries.values(), (entry) => {
      const room = mx.getRoom(entry.roomId);
      return { entry, signals: room ? reader.read(room, entry, userId, now) : QUIET };
    });
    // roomUnreads only triggers the rebuild; the signals read the counts themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mx, now, roomUnreads, userId]);
};
