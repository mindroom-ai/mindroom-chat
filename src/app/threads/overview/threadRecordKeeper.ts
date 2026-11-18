import { useEffect, useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import {
  createThreadRecordChanges,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import type { ThreadIndexRecordMaps } from './threadIndexRecords';

/**
 * The thread records of a room's Compact list, and the marks of what changed since they were
 * built (`ThreadRecordChanges`), kept by the room's page while a thread fills it: the list goes
 * then (`ConversationLayout`), and the one that comes back builds only the records of the threads
 * that changed. The page has one for its room, which goes with the room.
 *
 * While the list is gone a listener of the room only marks what changes: it builds, renders and
 * fetches nothing and updates no view (`useThreadOverviewRefreshCounter`). The list keeps its
 * records here only while Compact, and only those of its last build.
 */
export type ThreadRecordKeeper = {
  readonly room: Room;
  /** The marks of the room's list, from one mount of the list to the next. */
  readonly changes: ThreadRecordChanges;
  /** The records of the list's last build; undefined after a build outside Compact. */
  maps: ThreadIndexRecordMaps | undefined;
  /**
   * Stops the listener that marks the room's changes while no list shows. Set only while it
   * listens, from the list's unmount: without it the marks may miss a change, and nothing kept
   * is used.
   */
  stopAway: (() => void) | undefined;
  /** The page left the room (or unmounted): nothing more is kept. */
  disposed: boolean;
};

export const createThreadRecordKeeper = (room: Room): ThreadRecordKeeper => ({
  room,
  changes: createThreadRecordChanges(),
  maps: undefined,
  stopAway: undefined,
  disposed: false,
});

/** Stops the listener, lets go of the records, and keeps nothing more. */
export const disposeThreadRecordKeeper = (keeper: ThreadRecordKeeper): void => {
  keeper.disposed = true;
  keeper.stopAway?.();
  keeper.stopAway = undefined;
  keeper.maps = undefined;
};

/** The keeper given for `room`: undefined for another room's or one let go. */
export const threadRecordKeeperOf = (
  keeper: ThreadRecordKeeper | undefined,
  room: Room
): ThreadRecordKeeper | undefined =>
  keeper?.room === room && !keeper.disposed ? keeper : undefined;

/**
 * The records a list that mounts may start from: those the list of the same room left, while the
 * listener has marked every change since.
 */
export const keptThreadRecordMaps = (
  keeper: ThreadRecordKeeper | undefined,
  room: Room
): ThreadIndexRecordMaps | undefined => {
  const kept = threadRecordKeeperOf(keeper, room);
  return kept?.stopAway ? kept.maps : undefined;
};

/** The room page's keeper: a new one with each room, let go when the page leaves it. */
export const useThreadRecordKeeper = (room: Room): ThreadRecordKeeper => {
  const keeper = useMemo(() => createThreadRecordKeeper(room), [room]);
  useEffect(() => {
    // Mounted again (StrictMode): keeps from here on, from nothing.
    keeper.disposed = false;
    return () => disposeThreadRecordKeeper(keeper);
  }, [keeper]);
  return keeper;
};
