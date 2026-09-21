import { Room, ThreadEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRoomThreadsUnread,
  loadRoomThreads,
  roomThreadListIsComplete,
  sortThreadsByActivity,
} from './roomThreadList';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMindroomSyncEngine } from '../engine/engineContext';
import {
  createPreferLiveEventMapper,
  loadCachedThreadRootsForRoom,
  serializeThreadCacheEvents,
} from './eventRepository';
import { restoreCachedRoomThreads } from './sdk/roomTimelineSdk';

export const useRoomThreadList = (room: Room, enabled = true) => {
  const mx = useMatrixClient();
  const engine = useMindroomSyncEngine();
  const [loading, setLoading] = useState(enabled);
  const [loadedSuccessfully, setLoadedSuccessfully] = useState(false);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);
  const lifecycleAbortControllerRef = useRef<AbortController>();

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    loadCachedThreadRootsForRoom(engine.sessionId, room.roomId)
      .then((roots) => {
        if (cancelled) return;
        const mapper = createPreferLiveEventMapper(room, mx.getEventMapper());
        restoreCachedRoomThreads(
          room,
          roots.map(({ rootEvent, latestReply }) => ({
            rootEvent: mapper(rootEvent),
            latestReply: latestReply && mapper(latestReply),
          }))
        );
        setVersion((current) => current + 1);
      })
      .catch(() => {
        // A cache miss/failure must not interrupt the independent server load.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, engine.sessionId, mx, room]);

  const handleThreadListProgress = useCallback(() => {
    setLoadedSuccessfully(true);
    setVersion((current) => current + 1);
  }, []);

  const loadThreads = useCallback(
    (signal: AbortSignal) => {
      const persist = engine.persist.forRoom(room);
      const saved = new Map<string, string>();
      return loadRoomThreads(
        room,
        () => {
          if (signal.aborted) return;
          room.getThreads().forEach((thread) => {
            if (!thread.rootEvent) return;
            // Later pages can update the same SDK object, including its edits.
            const revision = JSON.stringify(serializeThreadCacheEvents(room, [], thread.rootEvent));
            if (saved.get(thread.id) === revision) return;
            saved.set(thread.id, revision);
            // A listed root is enough for the overview, not proof of cached replies.
            persist.persistThreadEventCache(thread.id, [], thread.rootEvent);
          });
          handleThreadListProgress();
        },
        signal
      );
    },
    [engine.persist, handleThreadListProgress, room]
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
  }, [enabled, loadThreads]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleThreadUpdate = () => {
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
    };
  }, [enabled, room]);

  const rawThreads = useMemo(() => {
    void version;
    return room.getThreads();
  }, [room, version]);
  const userId = mx.getUserId() ?? '';
  const threadUnreads = useMemo(
    () => getRoomThreadsUnread(room, rawThreads, userId),
    [room, rawThreads, userId]
  );
  const threads = useMemo(
    () => sortThreadsByActivity(rawThreads, threadUnreads),
    [rawThreads, threadUnreads]
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
