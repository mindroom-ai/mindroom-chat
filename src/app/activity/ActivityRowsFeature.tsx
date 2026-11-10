import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { useMinuteClock } from '../lib/hooks/useMinuteClock';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import { buildActivityRows, type ActivityRowsResult } from './activityRows';
import { readActivityInvites } from './activityInvites';
import { activityRowsAtom, activityShowAutomationsAtom } from './activityState';

const QUIET: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

/**
 * Activity's rows from the cross-room thread index and the pending invites, rebuilt when the
 * index or a room's unread counts change, and every minute; a thread's signals come from the
 * client's shared cache.
 */
const useComputedActivityRows = (): ActivityRowsResult => {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const inviteIds = useAtomValue(allInvitesAtom);
  const showAutomations = useAtomValue(activityShowAutomationsAtom);
  const now = useMinuteClock();
  // Unread counts change with no index change: a read on another device, a sync after Mark all
  // read. The room counts move only when they do, not with every streamed edit.
  const roomUnreads = useAtomValue(roomToUnreadAtom);

  return useMemo(() => {
    const reader = getThreadSignalsReader(mx);
    reader.prune(new Set(index.entries.keys()));
    const signals = (entry: CrossRoomThreadIndexEntry): ThreadSignals => {
      const room = mx.getRoom(entry.roomId);
      return room ? reader.read(room, entry, userId, now) : QUIET;
    };
    return buildActivityRows({
      entries: index.entries.values(),
      signals,
      invites: readActivityInvites(mx, inviteIds),
      now,
      showAutomations,
    });
    // roomUnreads only triggers the rebuild; the signals read the counts themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, inviteIds, mx, now, roomUnreads, showAutomations, userId]);
};

/** Keeps Activity's rows current for the whole session; `ClientNonUIFeatures` mounts it once. */
export function ActivityRowsFeature() {
  const rows = useComputedActivityRows();
  const setRows = useSetAtom(activityRowsAtom);
  useEffect(() => setRows(rows), [rows, setRows]);
  return null;
}
