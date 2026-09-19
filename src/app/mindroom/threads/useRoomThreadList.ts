import { Room, ThreadEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRoomThreadsUnread,
  loadRoomThreads,
  roomThreadListIsComplete,
  sortThreadsByActivity,
} from './roomThreadList';
import { useMatrixClient } from '../../hooks/useMatrixClient';

export const useRoomThreadList = (room: Room, enabled = true) => {
  const mx = useMatrixClient();
  const [loading, setLoading] = useState(enabled);
  const [loadedSuccessfully, setLoadedSuccessfully] = useState(false);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);
  const lifecycleAbortControllerRef = useRef<AbortController>();

  const handleThreadListProgress = useCallback(() => {
    setLoadedSuccessfully(true);
    setVersion((current) => current + 1);
  }, []);

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
      await loadRoomThreads(
        room,
        () => {
          if (!signal.aborted) handleThreadListProgress();
        },
        signal
      );
    } catch (err) {
      if (signal.aborted) return;
      setError(err as Error);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [enabled, handleThreadListProgress, room]);

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

    loadRoomThreads(
      room,
      () => {
        if (abortController.signal.aborted) return;
        handleThreadListProgress();
      },
      abortController.signal
    )
      .then(() => {
        if (abortController.signal.aborted) return;
      })
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
  }, [enabled, handleThreadListProgress, room]);

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
