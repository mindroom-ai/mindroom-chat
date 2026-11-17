import { useMemo } from 'react';
import { atom, useAtomValue, type Atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { Room } from 'matrix-js-sdk';
import type { ThreadRecord } from '../../event-store/threads/types';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../cross-room/threadSignalsReader';
import { buildCompactThreadSections, type CompactThreadSection } from './compactThreadSections';

type RoomEntries = ReadonlyMap<string, CrossRoomThreadIndexEntry>;

const NO_ENTRIES: RoomEntries = new Map();
// Read-only, so it holds nothing an account could leave behind.
const noEntriesAtom = atom(() => NO_ENTRIES);

const sameEntries = (left: RoomEntries, right: RoomEntries): boolean =>
  left.size === right.size && [...left].every(([rootId, entry]) => right.get(rootId) === entry);

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
 * thread the selected tab admits when its snooze ends is classified as the tab did. The records
 * carry what classifies them, background jobs included; it reads the threads' index entries and
 * signals for when they started, finished and were resolved, and while off it reads none of them.
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
  return useMemo(() => {
    if (now === undefined) return undefined;
    // The client's shared signals cache, which Activity and the sidebar keep filled.
    const reader = getThreadSignalsReader(room.client);
    return buildCompactThreadSections({
      threadRootIds,
      recordMap: threadRecordMap,
      entryOf: (rootId) => entries.get(rootId),
      signalsOf: (entry) => reader.read(room, entry, room.myUserId, now),
      pinnedRootIds,
      now,
    });
  }, [entries, now, pinnedRootIds, room, threadRecordMap, threadRootIds]);
};
