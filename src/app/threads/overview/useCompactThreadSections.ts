import { useEffect, useMemo, useState } from 'react';
import { atom, useAtomValue, type Atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { Room } from 'matrix-js-sdk';
import type { ThreadRecord } from '../../event-store/threads/types';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import type { Unread } from '../../matrix/types/room';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../cross-room/threadSignalsReader';
import { buildCompactThreadSections, type CompactThreadSection } from './compactThreadSections';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

type RoomEntries = ReadonlyMap<string, CrossRoomThreadIndexEntry>;

const NO_ENTRIES: RoomEntries = new Map();
// Read-only, so it holds nothing an account could leave behind.
const noEntriesAtom = atom(() => NO_ENTRIES);
const noUnreadAtom = atom<Unread | undefined>(() => undefined);

const sameEntries = (left: RoomEntries, right: RoomEntries): boolean =>
  left.size === right.size && [...left].every(([rootId, entry]) => right.get(rootId) === entry);

const sameUnread = (left: Unread | undefined, right: Unread | undefined): boolean =>
  left === right ||
  (!!left && !!right && left.total === right.total && left.highlight === right.highlight);

const roomEntriesAtoms = new Map<string, Atom<RoomEntries>>();

/** The index entries of one room's threads by root ID, new only when one of them changed. */
const roomEntriesAtom = (roomId: string): Atom<RoomEntries> => {
  let entriesAtom = roomEntriesAtoms.get(roomId);
  if (!entriesAtom) {
    entriesAtom = selectAtom(
      crossRoomThreadIndexAtom,
      (snapshot): RoomEntries => {
        const entries = new Map<string, CrossRoomThreadIndexEntry>();
        snapshot.entries.forEach((entry) => {
          if (entry.roomId === roomId) entries.set(entry.threadRootId, entry);
        });
        return entries;
      },
      sameEntries
    );
    roomEntriesAtoms.set(roomId, entriesAtom);
  }
  return entriesAtom;
};

/**
 * The Compact room's listed cards in sections (`buildCompactThreadSections`) while `now` is set,
 * else undefined. `now` is the snooze clock the list was filtered at (`useThreadIndex`), so a
 * thread the selected tab admits when its snooze ends is classified as the tab did; Quiet uses a
 * separate wall-clock timer so read, inactive threads fold automatically without shifting snooze
 * parity.
 */
export const useCompactThreadSections = ({
  room,
  now,
  threadRootIds,
  threadRecordMap,
  pinnedRootIds,
}: {
  room: Room;
  now: number | undefined;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  pinnedRootIds: readonly string[];
}): CompactThreadSection[] | undefined => {
  const enabled = now !== undefined;
  const entries = useAtomValue(
    useMemo(() => (enabled ? roomEntriesAtom(room.roomId) : noEntriesAtom), [enabled, room.roomId])
  );
  // Unread counts can change with no index change (e.g. read on another device clearing a mention).
  const roomUnread = useAtomValue(
    useMemo(
      () =>
        enabled
          ? selectAtom(roomToUnreadAtom, (unreads) => unreads.get(room.roomId), sameUnread)
          : noUnreadAtom,
      [enabled, room.roomId]
    )
  );
  const [quietClock, setQuietClock] = useState(() => ({ enabled, now: Date.now() }));
  if (quietClock.enabled !== enabled) {
    setQuietClock({ enabled, now: enabled ? Date.now() : quietClock.now });
  }
  const quietNow = now !== undefined ? Math.max(now, quietClock.now) : undefined;

  const result = useMemo(() => {
    if (now === undefined || quietNow === undefined) return undefined;
    // The client's shared signals cache, which Activity and the sidebar keep filled.
    const reader = getThreadSignalsReader(room.client);
    return buildCompactThreadSections({
      threadRootIds,
      recordMap: threadRecordMap,
      entryOf: (rootId) => entries.get(rootId),
      signalsOf: (entry) => reader.read(room, entry, room.myUserId, quietNow),
      pinnedRootIds,
      now,
      quietNow,
    });
    // roomUnread only triggers the rebuild; the signals read the counts themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, now, pinnedRootIds, quietNow, room, roomUnread, threadRecordMap, threadRootIds]);

  const nextQuietWakeTs = result?.nextQuietWakeTs;
  useEffect(() => {
    if (!enabled || nextQuietWakeTs === undefined) return undefined;
    const timer = setTimeout(
      () => setQuietClock({ enabled: true, now: Date.now() }),
      Math.max(0, Math.min(nextQuietWakeTs - Date.now(), MAX_TIMEOUT_MS))
    );
    return () => clearTimeout(timer);
    // quietClock.now is a dependency so a capped timer re-arms for the rest of a long wait.
  }, [enabled, nextQuietWakeTs, quietClock.now]);

  return result?.sections;
};
