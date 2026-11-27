import { useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { useMinuteClock } from '../lib/hooks/useMinuteClock';
import { useSnoozeNow } from '../threads/tags/useSnoozeNow';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import { buildActivityRows, type ActivityRow, type ActivityRowsResult } from './activityRows';
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
 * index or a room's unread counts change, every minute, and when a snooze ends; a thread's signals
 * come from the client's shared cache.
 */
const useComputedActivityRows = (): { result: ActivityRowsResult; now: number } => {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const inviteIds = useAtomValue(allInvitesAtom);
  const showAutomations = useAtomValue(activityShowAutomationsAtom);
  const minuteNow = useMinuteClock();
  // A snooze's end renews it too, so its thread comes back then, not up to a minute later.
  const snoozeNow = useSnoozeNow(
    useMemo(
      () => Array.from(index.entries.values(), (entry) => entry.snoozedUntilTs),
      [index.entries]
    )
  );
  const now = Math.max(minuteNow, snoozeNow);
  // Unread counts change with no index change: a read on another device, a sync after Mark all
  // read. The room counts move only when they do, not with every streamed edit.
  const roomUnreads = useAtomValue(roomToUnreadAtom);

  const result = useMemo(() => {
    const reader = getThreadSignalsReader(mx);
    reader.prune(new Set(index.entries.keys()));
    const signals = (entry: CrossRoomThreadIndexEntry): ThreadSignals => {
      const room = mx.getRoom(entry.roomId);
      return room ? reader.read(room, entry, userId, now) : QUIET;
    };
    const built = buildActivityRows({
      entries: index.entries.values(),
      signals,
      invites: readActivityInvites(mx, inviteIds),
      now,
      showAutomations,
    });
    // The list starts its window again with the rows of the loaded index and of the other mode.
    return { ...built, loading: !index.bootstrapped, showAutomations };
    // roomUnreads only triggers the rebuild; the signals read the counts themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, inviteIds, mx, now, roomUnreads, showAutomations, userId]);
  return { result, now };
};

const sameActivityRow = (a: ActivityRow, b: ActivityRow): boolean => {
  if (
    a.type !== b.type ||
    a.key !== b.key ||
    a.kind !== b.kind ||
    a.unread !== b.unread ||
    a.ts !== b.ts
  ) {
    return false;
  }
  if (a.type === 'invite' && b.type === 'invite') {
    return a.roomId === b.roomId && a.inviterId === b.inviterId;
  }
  return (
    a.type === 'thread' &&
    b.type === 'thread' &&
    a.entry === b.entry &&
    a.signals === b.signals &&
    a.actorIds.length === b.actorIds.length &&
    a.actorIds.every((id, index) => id === b.actorIds[index])
  );
};

const sameActivityRows = (a: ActivityRowsResult, b: ActivityRowsResult): boolean =>
  a.loading === b.loading &&
  a.showAutomations === b.showAutomations &&
  a.hiddenAutomations === b.hiddenAutomations &&
  a.rows.length === b.rows.length &&
  a.rows.every((row, index) => sameActivityRow(row, b.rows[index]!));

/** Keeps Activity's rows current for the whole session; `ClientNonUIFeatures` mounts it once. */
export function ActivityRowsFeature() {
  const { result, now } = useComputedActivityRows();
  const setRows = useSetAtom(activityRowsAtom);
  const lastNowRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const previousNow = lastNowRef.current;
    lastNowRef.current = now;
    const sameCalendarDay =
      previousNow === undefined ||
      new Date(previousNow).toDateString() === new Date(now).toDateString();
    setRows((previous) =>
      sameCalendarDay && sameActivityRows(previous, result) ? previous : result
    );
  }, [now, result, setRows]);
  return null;
}
