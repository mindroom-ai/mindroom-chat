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
 * One listener of the room marks its changes (`useThreadOverviewRefreshCounter`), from the mount
 * of its first list until the page lets go of the room. While a list shows, it also counts what
 * that list may show. While none shows it only marks, and only the threads of the records it
 * keeps and the whole room: it builds, renders and fetches nothing and updates no view. The list
 * keeps here the records of the build it committed, and only while Compact.
 */
export type ThreadRecordKeeper = {
  readonly room: Room;
  /** The marks of the room's list, from one mount of the list to the next. */
  readonly changes: ThreadRecordChanges;
  /** The records of the list's last committed build; undefined after one outside Compact. */
  maps: ThreadIndexRecordMaps | undefined;
  /** Counts a change the list that shows may show; undefined while no list shows. */
  count: (() => void) | undefined;
  /**
   * Stops the room's listener. Set while it listens: from the mount of a list until the page lets
   * go of the room, or until a list goes that leaves no records to keep. Without it the marks may
   * miss a change, and nothing kept is used.
   */
  stop: (() => void) | undefined;
};

export const createThreadRecordKeeper = (room: Room): ThreadRecordKeeper => ({
  room,
  changes: createThreadRecordChanges(),
  maps: undefined,
  count: undefined,
  stop: undefined,
});

/**
 * Stops the listener and lets go of the records. A list that mounts with it later starts over
 * from nothing (StrictMode mounts the page's effects twice).
 */
export const disposeThreadRecordKeeper = (keeper: ThreadRecordKeeper): void => {
  keeper.stop?.();
  keeper.stop = undefined;
  keeper.maps = undefined;
  keeper.count = undefined;
};

/** The keeper given for `room`: undefined for another room's. */
export const threadRecordKeeperOf = (
  keeper: ThreadRecordKeeper | undefined,
  room: Room
): ThreadRecordKeeper | undefined => (keeper?.room === room ? keeper : undefined);

/**
 * The records a list that mounts may start from: those the list of the same room left, while the
 * listener has marked every change since.
 */
export const keptThreadRecordMaps = (
  keeper: ThreadRecordKeeper | undefined,
  room: Room
): ThreadIndexRecordMaps | undefined => {
  const kept = threadRecordKeeperOf(keeper, room);
  return kept?.stop ? kept.maps : undefined;
};

/** Whether the room's listener hears every change for the records `keeper` keeps. */
export const threadRecordKeeperHears = (
  keeper: ThreadRecordKeeper | undefined,
  room: Room
): boolean => !!threadRecordKeeperOf(keeper, room)?.stop;

/** Whether a change of the thread may matter to what `keeper` keeps while no list shows. */
export const threadRecordKept = (
  keeper: Pick<ThreadRecordKeeper, 'maps'>,
  threadRootId: string
): boolean =>
  !!keeper.maps &&
  (keeper.maps.compactThreadRecordMap.has(threadRootId) ||
    keeper.maps.normalThreadRecordMap.has(threadRootId));

/** The page's keeper: a new one with each room, let go when the page leaves it. */
export const useThreadRecordKeeper = (room: Room): ThreadRecordKeeper => {
  const keeper = useMemo(() => createThreadRecordKeeper(room), [room]);
  useEffect(() => () => disposeThreadRecordKeeper(keeper), [keeper]);
  return keeper;
};
