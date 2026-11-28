import { MatrixEvent, Room, ThreadEvent, type IEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  loadRoomThreads,
  roomThreadListIsComplete,
  sortThreadsByActivity,
} from '../../event-store/threads/roomThreadList';
import {
  buildThreadUnreadMap,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import { usePaneCollapsed } from '../../lib/hooks/usePaneCollapsed';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { measureDeepTracePhase } from '../../diagnostics/deepTrace';
import { useSyncEngine } from '../../event-store/engine/engineContext';
import {
  createPreferLiveEventMapper,
  loadCachedThreadRootsForRoom,
  serializeThreadCacheEvents,
} from '../../event-store/cache/eventRepository';
import { restoreCachedRoomThreads } from '../../event-store/sdk/roomTimelineSdk';
import {
  keepHeldThreadSummaries,
  readOnlyEventMapper,
} from '../../event-store/sdk/readOnlyEventMapper';
import { getSummaryLatestEvent } from '../../event-store/cache/cachedThreadSummary';
import { isVisibleThreadReplyEvent } from '../../event-store/threads/threadUtils';

/**
 * Per page, not per mount: returning to a room's overview must not read every
 * cached root again or rewrite every unchanged one. In a room with hundreds of
 * threads each mount cost hundreds of IndexedDB transactions and megabytes of
 * reads, all through WebKit's networking process.
 */
const restoredRooms = new WeakSet<Room>();
const savedRootRevisions = new WeakMap<
  Room,
  { isCurrent: () => boolean; revisions: Map<string, number> }
>();

/** Root revisions saved under the room's cache write lease; a cleared room cache starts over. */
const getSavedRootRevisions = (room: Room, isCurrent: () => boolean): Map<string, number> => {
  const saved = savedRootRevisions.get(room);
  if (saved?.isCurrent()) return saved.revisions;
  const revisions = new Map<string, number>();
  savedRootRevisions.set(room, { isCurrent, revisions });
  return revisions;
};

/** 53-bit string hash (cyrb53): the page keeps a number per root, not its JSON. */
const hashRevision = (value: string): number => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const getRootRevision = (room: Room, rootEvent: MatrixEvent): number => {
  const edit = rootEvent.replacingEvent();
  return hashRevision(
    JSON.stringify([
      // Encrypted events serialize as their ciphertext; decrypting one is a new revision.
      rootEvent.getType(),
      rootEvent.isDecryptionFailure(),
      edit?.getType(),
      edit?.isDecryptionFailure(),
      serializeThreadCacheEvents(room, [], rootEvent, { clone: false }),
    ])
  );
};

/**
 * The room's threads, unread first and then by activity, and their unread marks.
 * `overviewChanges` and `overviewRefreshCounter` are the room's (`useThreadOverviewRefreshCounter`):
 * each count checks the marks of the threads it may have changed (`buildThreadUnreadMap`).
 */
export const useRoomThreadList = (
  room: Room,
  enabled: boolean,
  overviewChanges: ThreadRecordChanges,
  overviewRefreshCounter: number
) => {
  const mx = useMatrixClient();
  const engine = useSyncEngine();
  const collapsed = usePaneCollapsed();
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const dirtyVersionRef = useRef(false);
  const [loading, setLoading] = useState(enabled && !collapsed);
  const [loadedSuccessfully, setLoadedSuccessfully] = useState(false);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);
  const lifecycleAbortControllerRef = useRef<AbortController>(undefined);

  useEffect(() => {
    // The SDK keeps the threads restored by the first mount; later ones come from the server list.
    if (!enabled || collapsed || restoredRooms.has(room)) return undefined;
    let cancelled = false;
    loadCachedThreadRootsForRoom(engine.sessionId, room.roomId)
      .then((roots) => {
        if (cancelled) return;
        restoredRooms.add(room);
        const mapper = keepHeldThreadSummaries(
          room,
          createPreferLiveEventMapper(room, mx.getEventMapper())
        );
        const restored = roots.map(({ rootEvent, latestReply }) => ({
          cached: rootEvent,
          rootEvent: mapper(rootEvent),
          latestReply: latestReply && mapper(latestReply),
        }));
        restoreCachedRoomThreads(room, restored);
        // A root the SDK now holds as the cache had it is saved already: the server's list saves
        // the roots it adds or changes, not these again. A new Room (after an account switch)
        // knew of none, and the first page saved every restored root in a transaction of its own,
        // 791 of them at once, which held up every other read of the cache for seconds.
        const saved = getSavedRootRevisions(room, engine.persist.forRoom(room).isCurrent);
        restored.forEach(({ cached, rootEvent }) => {
          const id = rootEvent.getId();
          if (id && rootEvent.event === cached && room.getThread(id)?.rootEvent === rootEvent) {
            saved.set(id, getRootRevision(room, rootEvent));
          }
        });
        setVersion((current) => current + 1);
      })
      .catch(() => {
        // A cache miss/failure must not interrupt the independent server load.
      });
    return () => {
      cancelled = true;
    };
  }, [collapsed, enabled, engine.persist, engine.sessionId, mx, room]);

  const handleThreadListProgress = useCallback(() => {
    setLoadedSuccessfully(true);
    setVersion((current) => current + 1);
  }, []);

  const loadThreads = useCallback(
    (signal: AbortSignal) => {
      const persist = engine.persist.forRoom(room);
      const saved = getSavedRootRevisions(room, persist.isCurrent);
      const mapper = readOnlyEventMapper(
        room,
        createPreferLiveEventMapper(room, mx.getEventMapper())
      );
      const saveRoot = (threadId: string, rootEvent: MatrixEvent) => {
        // Later pages can update the same SDK object, including its edits.
        const revision = getRootRevision(room, rootEvent);
        if (saved.get(threadId) === revision) return;
        saved.set(threadId, revision);
        // Keep the listed reply as an edit target when sync did not include its original event.
        // One bundled reply does not prove the thread's history or tail was downloaded.
        const latest = getSummaryLatestEvent(rootEvent.event);
        const reply =
          latest && (!latest.room_id || latest.room_id === room.roomId)
            ? mapper({ ...latest, room_id: room.roomId } as IEvent)
            : undefined;
        const replies =
          reply && isVisibleThreadReplyEvent(reply) && reply.threadRootId === threadId
            ? [reply]
            : [];
        persist.persistThreadEventCache(threadId, replies, rootEvent);
      };
      // A page checks the roots this load has not checked yet, not every listed root again; once a
      // list of several pages ends or is left, every root is checked once more for changes made
      // meanwhile, such as a root a later page listed again.
      const checked = new Set<string>();
      let pages = 0;
      const saveRoots = () =>
        room.getThreads().forEach(({ id, rootEvent }) => {
          if (!rootEvent || checked.has(id)) return;
          checked.add(id);
          // Save a root that is being decrypted with its clear content and attachments.
          const decryption = rootEvent.isBeingDecrypted() && rootEvent.getDecryptionPromise();
          const save = () => saveRoot(id, rootEvent);
          if (!decryption) {
            save();
            return;
          }
          decryption.then(save, save).catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[threadList] saving a decrypted root failed:', err);
          });
        });
      const checkAll = () => {
        signal.removeEventListener('abort', checkAll);
        try {
          if (pages > 1) {
            checked.clear();
            measureDeepTracePhase('roomOverview.saveRoots', saveRoots);
          }
        } catch (err) {
          // The list loaded; a root that cannot be saved must not turn it into an error.
          // eslint-disable-next-line no-console
          console.warn('[threadList] checking listed roots failed:', err);
        }
        pages = 0;
      };
      signal.addEventListener('abort', checkAll);
      return loadRoomThreads(
        room,
        () => {
          if (signal.aborted) return;
          pages += 1;
          measureDeepTracePhase('roomOverview.saveRoots', saveRoots);
          handleThreadListProgress();
        },
        signal
      ).finally(checkAll);
    },
    [engine.persist, handleThreadListProgress, mx, room]
  );

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setLoadedSuccessfully(false);
      return;
    }
    const signal = lifecycleAbortControllerRef.current?.signal;
    if (!signal || signal.aborted) return;

    setLoading(true);
    setLoadedSuccessfully(false);
    setError(undefined);

    try {
      await loadThreads(signal);
    } catch (err) {
      if (signal.aborted) return;
      setError(err as Error);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [enabled, loadThreads]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setLoadedSuccessfully(false);
      setError(undefined);
      return undefined;
    }
    if (collapsed) return undefined;

    const abortController = new AbortController();
    lifecycleAbortControllerRef.current = abortController;

    setLoading(true);
    setLoadedSuccessfully(false);
    setError(undefined);

    loadThreads(abortController.signal)
      .catch((err: unknown) => {
        if (abortController.signal.aborted) return;
        setError(err as Error);
      })
      .finally(() => {
        if (abortController.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      abortController.abort();
      if (lifecycleAbortControllerRef.current === abortController) {
        lifecycleAbortControllerRef.current = undefined;
      }
    };
  }, [collapsed, enabled, loadThreads]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleThreadUpdate = () => {
      if (collapsedRef.current) {
        dirtyVersionRef.current = true;
        return;
      }
      setVersion((current) => current + 1);
    };

    room.on(ThreadEvent.New, handleThreadUpdate);
    room.on(ThreadEvent.Update, handleThreadUpdate);
    room.on(ThreadEvent.NewReply, handleThreadUpdate);
    room.on(ThreadEvent.Delete, handleThreadUpdate);

    return () => {
      room.removeListener(ThreadEvent.New, handleThreadUpdate);
      room.removeListener(ThreadEvent.Update, handleThreadUpdate);
      room.removeListener(ThreadEvent.NewReply, handleThreadUpdate);
      room.removeListener(ThreadEvent.Delete, handleThreadUpdate);
      if (collapsedRef.current) dirtyVersionRef.current = true;
    };
  }, [enabled, room]);

  useLayoutEffect(() => {
    if (!collapsed && dirtyVersionRef.current) {
      dirtyVersionRef.current = false;
      setVersion((current) => current + 1);
    }
  }, [collapsed]);

  const rawThreads = useMemo(() => {
    void version;
    return room.getThreads();
  }, [room, version]);
  const userId = mx.getUserId() ?? '';
  // The marks of the last build. A count checks the threads it marked (a reply, the reader's
  // receipt in a thread), not every thread of the room, and keeps the map while no mark changed.
  const builtUnreadsRef = useRef<ReadonlyMap<string, boolean>>(undefined);
  const threadUnreads = useMemo(() => {
    // A receipt raises the count and leaves the list as it was.
    void overviewRefreshCounter;
    if (!enabled) return new Map<string, boolean>();
    const built = buildThreadUnreadMap(room, rawThreads, userId, {
      previous: builtUnreadsRef.current,
      changes: overviewChanges,
    });
    builtUnreadsRef.current = built;
    return built;
  }, [enabled, room, rawThreads, userId, overviewRefreshCounter, overviewChanges]);
  const threads = useMemo(
    // Non-compact surfaces still use known roots for deep links, but not this ordering.
    () => (enabled ? sortThreadsByActivity(rawThreads, threadUnreads) : rawThreads),
    [enabled, rawThreads, threadUnreads]
  );
  const fullyLoaded = useMemo(() => {
    void version;
    return roomThreadListIsComplete(room);
  }, [room, version]);

  return {
    threads,
    threadUnreads,
    loading,
    loadedSuccessfully,
    fullyLoaded,
    error,
    retry: refresh,
  };
};
