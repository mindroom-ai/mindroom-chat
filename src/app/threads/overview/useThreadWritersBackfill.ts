/**
 * Completes who wrote in each of the room's threads (`threadWriters`): first from the event
 * cache, then, once the People filter is in use, from the server's `/relations` for the threads
 * still missing replies. A thread known only from the server's thread list carries its root and
 * newest reply, so without this the People filter misses everyone who wrote only in the middle.
 */
import { useEffect, useRef } from 'react';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { loadLatestCachedThreadEventsBatch } from '../../event-store/cache/eventRepository';
import { useSyncEngine } from '../../event-store/engine';
import type { PersistThreadEventCache } from '../../event-store/engine/enginePersistFacade';
import { getPreferredVisibleThreadReplyEvents } from '../../event-store/threads/threadUtils';
import {
  getThreadWriters,
  recordThreadWriters,
  type ThreadWriters,
} from '../../event-store/threads/threadWriters';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { ThreadSummaryWriter } from '../../event-store/threads/threadSummaryState';
import { fetchAndPersistThreadContent } from '../open/threadContentPrefetch';
import type { FetchedRelationOverviewUpdateOptions } from './threadOverviewCacheHydration';

/** Threads per cache read, as the overview's own cache reads take them. */
const CACHE_BATCH_SIZE = 64;
/** The newest cached events read per thread: whole threads up to this size. */
const CACHE_EVENT_LIMIT = 200;

/** The visible replies of `rootId` among `events`. */
const countThreadReplies = (events: MatrixEvent[], rootId: string): number =>
  getPreferredVisibleThreadReplyEvents({ id: rootId, events }).length;

/**
 * The threads whose writers are not all known: replies the client has not read. A thread whose
 * replies the client holds, or whose replies were all read before, is complete.
 */
export const getThreadsMissingWriters = (
  room: Pick<Room, 'getThread'>,
  records: ReadonlyMap<string, ThreadRecord>,
  writers: ReadonlyMap<string, ThreadWriters>
): string[] => {
  const missing: string[] = [];
  records.forEach((record, rootId) => {
    const { replyCount } = record.status;
    if (replyCount <= 0 || writers.get(rootId)?.complete) return;
    if (getPreferredVisibleThreadReplyEvents(room.getThread(rootId)).length >= replyCount) return;
    missing.push(rootId);
  });
  return missing;
};

export type UseThreadWritersBackfillOptions = {
  room: Room;
  mx: MatrixClient;
  sessionId: string;
  /** The room's thread records before filtering. */
  records: ReadonlyMap<string, ThreadRecord>;
  /** Whether to ask the server for the threads the cache cannot complete (People in use). */
  fetchMissing: boolean;
  /** Takes every fetched page; the caller notes its writers. */
  onApplyThreadRelations: (options: FetchedRelationOverviewUpdateOptions) => void;
  onStoreThreadSummary: ThreadSummaryWriter;
  beginThreadCacheWrite: () => PersistThreadEventCache;
};

type BackfillState = {
  room: Room;
  /** The room is shown. */
  alive: boolean;
  /** People is in use: the server is asked. */
  fetching: boolean;
  /** Threads whose cached replies were (or are being) read. */
  cacheRead: Set<string>;
  /** Threads whose cached replies were read, and those the cache completed. */
  cacheDone: Set<string>;
  cacheComplete: Set<string>;
  /** Threads asked of the server, once each while the room is shown. */
  fetched: Set<string>;
};

export const useThreadWritersBackfill = (options: UseThreadWritersBackfillOptions): void => {
  const { room, records, fetchMissing } = options;
  const engine = useSyncEngine();
  const latestRef = useRef({ ...options, engine });
  latestRef.current = { ...options, engine };
  const stateRef = useRef<BackfillState>();
  if (stateRef.current?.room !== room) {
    stateRef.current = {
      room,
      alive: true,
      fetching: false,
      cacheRead: new Set(),
      cacheDone: new Set(),
      cacheComplete: new Set(),
      fetched: new Set(),
    };
  }
  const state = stateRef.current;

  /** Asks the server for each thread not asked yet, in the thread inventory band. */
  const fetchThreads = useRef((ids: string[]) => {
    const current = stateRef.current;
    if (!current?.alive || !current.fetching) return;
    const { mx, engine: syncEngine } = latestRef.current;
    const proceed = () => current.alive && current.fetching;
    ids.forEach((rootId) => {
      if (current.fetched.has(rootId)) return;
      current.fetched.add(rootId);
      void fetchAndPersistThreadContent({
        mx,
        scheduler: syncEngine.scheduler,
        room: current.room,
        threadId: rootId,
        priority: 3,
        shouldContinue: proceed,
        beginThreadCacheWrite: () => latestRef.current.beginThreadCacheWrite(),
        onApplyThreadRelations: (page) => latestRef.current.onApplyThreadRelations(page),
        onStoreThreadSummary: (...args) => latestRef.current.onStoreThreadSummary(...args),
      }).then(
        (result) => {
          // A fetch stopped by leaving the room or People is asked again next time.
          if (!result && !proceed()) current.fetched.delete(rootId);
        },
        () => undefined
      );
    });
  }).current;

  useEffect(() => {
    state.alive = true;
    return () => {
      state.alive = false;
    };
  }, [state]);

  // The cache first: every thread missing writers, once per room visit.
  useEffect(() => {
    const ids = getThreadsMissingWriters(room, records, getThreadWriters(room)).filter(
      (rootId) => !state.cacheRead.has(rootId)
    );
    if (ids.length === 0) return;
    ids.forEach((rootId) => state.cacheRead.add(rootId));
    const readCache = async () => {
      const { mx, sessionId } = latestRef.current;
      const mapper = mx.getEventMapper();
      for (let offset = 0; offset < ids.length && state.alive; offset += CACHE_BATCH_SIZE) {
        const batch = ids.slice(offset, offset + CACHE_BATCH_SIZE);
        // eslint-disable-next-line no-await-in-loop
        const pages = await loadLatestCachedThreadEventsBatch(
          sessionId,
          room.roomId,
          batch,
          CACHE_EVENT_LIMIT
        ).catch(() => undefined);
        if (!state.alive) break;
        pages?.forEach((page, rootId) => {
          if (page.events.length === 0) return;
          try {
            const events = page.events.map((raw) => mapper(raw as IEvent));
            const replyCount = latestRef.current.records.get(rootId)?.status.replyCount ?? 0;
            const complete =
              page.relationSnapshotComplete === true ||
              countThreadReplies(events, rootId) >= replyCount;
            recordThreadWriters(room, rootId, events, complete);
            if (complete) state.cacheComplete.add(rootId);
          } catch {
            // One unreadable page leaves only its thread to the server.
          }
        });
        batch.forEach((rootId) => state.cacheDone.add(rootId));
        fetchThreads(batch.filter((rootId) => !state.cacheComplete.has(rootId)));
      }
      // A thread not read before the room was left is read on the next visit.
      ids.forEach((rootId) => {
        if (!state.cacheDone.has(rootId)) state.cacheRead.delete(rootId);
      });
    };
    void readCache();
  }, [fetchThreads, records, room, state]);

  // Then the server, while People is in use, for the threads the cache could not complete.
  useEffect(() => {
    state.fetching = fetchMissing;
    if (!fetchMissing) return;
    fetchThreads(
      getThreadsMissingWriters(room, records, getThreadWriters(room)).filter(
        (rootId) => state.cacheDone.has(rootId) && !state.cacheComplete.has(rootId)
      )
    );
  }, [fetchMissing, fetchThreads, records, room, state]);
};
