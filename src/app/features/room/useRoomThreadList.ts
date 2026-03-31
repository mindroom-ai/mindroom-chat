import { Room, ThreadEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadRoomThreads, roomThreadListIsComplete, sortThreadsByActivity, getRoomThreadsUnread } from './roomThreadList';
import { useMatrixClient } from '../../hooks/useMatrixClient';

export const useRoomThreadList = (room: Room, enabled = true) => {
  const mx = useMatrixClient();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);

  const handleThreadListProgress = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);

    try {
      await loadRoomThreads(room, handleThreadListProgress);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [enabled, handleThreadListProgress, room]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(undefined);
      return undefined;
    }

    let mounted = true;

    setLoading(true);
    setError(undefined);

    loadRoomThreads(room, () => {
      if (!mounted) return;
      handleThreadListProgress();
    })
      .then(() => {
        if (!mounted) return;
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err as Error);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
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

  const rawThreads = useMemo(() => room.getThreads(), [room, version]);
  const userId = mx.getUserId() ?? '';
  const threadUnreads = useMemo(
    () => getRoomThreadsUnread(room, rawThreads, userId),
    [room, rawThreads, userId]
  );
  const threads = useMemo(
    () => sortThreadsByActivity(rawThreads, threadUnreads),
    [rawThreads, threadUnreads]
  );
  const fullyLoaded = useMemo(() => roomThreadListIsComplete(room), [room, version]);

  return {
    threads,
    threadUnreads,
    loading,
    fullyLoaded,
    error,
    retry: refresh,
  };
};
