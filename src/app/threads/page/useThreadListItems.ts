import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMinuteClock } from '../../lib/hooks/useMinuteClock';
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
 * shared signals cache (which Activity fills too), checked again every minute.
 */
export const useThreadListItems = (): ThreadListItem[] => {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const now = useMinuteClock();

  return useMemo(() => {
    const reader = getThreadSignalsReader(mx);
    return Array.from(index.entries.values(), (entry) => {
      const room = mx.getRoom(entry.roomId);
      return { entry, signals: room ? reader.read(room, entry, userId, now) : QUIET };
    });
  }, [index, mx, now, userId]);
};
