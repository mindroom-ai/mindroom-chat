import { useMemo, useState } from 'react';
import { atom, useAtomValue, type Atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { Room } from 'matrix-js-sdk';
import type { ThreadRecord } from '../../event-store/threads/types';
import { useAgentRoomState } from '../../matrix/protocol/agentRoomState';
import {
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobThreadIds,
} from '../../matrix/protocol/backgroundJobsContract';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { getThreadSignalsReader } from '../cross-room/threadSignalsReader';
import { useSnoozeNow } from '../tags/useSnoozeNow';
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

type KeptSignals = { entry: CrossRoomThreadIndexEntry; version: string; signals: ThreadSignals };

/** What of a thread's own events its signals read, as the shared cache keys it. */
const threadVersion = (room: Room, rootId: string): string => {
  const thread = room.getThread(rootId);
  const events = thread?.events ?? [];
  return [events.length, events.at(-1)?.getId() ?? '', thread?.replyToEvent?.getId() ?? ''].join(
    ':'
  );
};

/**
 * The Compact room's listed cards in sections (`buildCompactThreadSections`) while `enabled`,
 * else undefined. It reads the room's background jobs from its agents' state, and the threads'
 * index entries and signals for when they started, finished and were resolved; while off it
 * reads none of them. Renewed when a snooze ends, so its thread moves to Idle then.
 */
export const useCompactThreadSections = ({
  room,
  enabled,
  threadRootIds,
  threadRecordMap,
  pinnedRootIds,
}: {
  room: Room;
  enabled: boolean;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  pinnedRootIds: readonly string[];
}): CompactThreadSection[] | undefined => {
  const jobThreadIds = useAgentRoomState(
    enabled ? room : null,
    MINDROOM_BACKGROUND_JOBS_EVENT,
    selectBackgroundJobThreadIds
  );
  const entries = useAtomValue(
    useMemo(() => (enabled ? roomEntriesAtom(room.roomId) : noEntriesAtom), [enabled, room.roomId])
  );
  const now = useSnoozeNow(
    useMemo(
      () =>
        enabled
          ? threadRootIds.map((rootId) => threadRecordMap.get(rootId)?.status.snoozedUntilTs)
          : [],
      [enabled, threadRecordMap, threadRootIds]
    )
  );
  // Each Idle thread's signals, read again only when that thread changed: its index entry, or the
  // events its thread holds (an edit of an older reply leaves the entry as it was). The shared
  // cache reads every thread of the room again on any event in it, so a stream chunk in one
  // thread would read them all.
  const [signalsByThread] = useState(() => new Map<string, KeptSignals>());
  return useMemo(() => {
    if (!enabled) return undefined;
    // The client's shared signals cache, which Activity and the sidebar keep filled.
    const reader = getThreadSignalsReader(room.client);
    return buildCompactThreadSections({
      threadRootIds,
      recordMap: threadRecordMap,
      jobThreadIds,
      entryOf: (rootId) => entries.get(rootId),
      signalsOf: (entry) => {
        const version = threadVersion(room, entry.threadRootId);
        const kept = signalsByThread.get(entry.key);
        if (kept?.entry === entry && kept.version === version) return kept.signals;
        const signals = reader.read(room, entry, room.myUserId, now);
        signalsByThread.set(entry.key, { entry, version, signals });
        return signals;
      },
      pinnedRootIds,
      now,
    });
  }, [
    enabled,
    entries,
    jobThreadIds,
    now,
    pinnedRootIds,
    room,
    signalsByThread,
    threadRecordMap,
    threadRootIds,
  ]);
};
