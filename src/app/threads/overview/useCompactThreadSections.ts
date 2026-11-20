import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import type { ThreadRecord } from '../../event-store/threads/types';
import { roomThreadIndexEntriesAtom } from '../cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../cross-room/threadSignalsReader';
import { buildCompactThreadSections, type CompactThreadSection } from './compactThreadSections';

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
  const entries = useAtomValue(roomThreadIndexEntriesAtom(enabled ? room.roomId : undefined));
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
