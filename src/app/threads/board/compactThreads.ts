import { useEffect } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import type { ThreadRecord } from '../../event-store/threads/types';

/** The threads a room's page lists in its Compact view with no filter chosen. */
export type CompactThreads = {
  rootIds: readonly string[];
  records: ReadonlyMap<string, ThreadRecord>;
  /** While the page waits to know whether the room has a thread, as the Compact view waits. */
  loading: boolean;
};

/** Each room page's Compact threads, by room ID, while the page shows the Compact view. */
const compactThreadsAtom = atom<ReadonlyMap<string, CompactThreads>>(new Map());

/**
 * Shares the threads the room's page lists in Compact, so a board beside the page reads the
 * records the page builds instead of building its own; undefined shares nothing. What it shared
 * goes as the page leaves Compact or the room.
 */
export const useShareCompactThreads = (roomId: string, threads: CompactThreads | undefined) => {
  const setAll = useSetAtom(compactThreadsAtom);
  useEffect(() => {
    if (!threads) return undefined;
    setAll((all) => new Map(all).set(roomId, threads));
    return () =>
      setAll((all) => {
        if (all.get(roomId) !== threads) return all;
        const next = new Map(all);
        next.delete(roomId);
        return next;
      });
  }, [roomId, setAll, threads]);
};

/** The threads the page of `roomId` lists in Compact, or undefined while it shows no Compact view. */
export const useCompactThreads = (roomId: string): CompactThreads | undefined =>
  useAtomValue(compactThreadsAtom).get(roomId);
