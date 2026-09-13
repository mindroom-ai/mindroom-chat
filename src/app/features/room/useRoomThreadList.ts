import { Room, ThreadEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadRoomThreads, roomThreadListIsComplete, sortThreadsByActivity } from './roomThreadList';

export const useRoomThreadList = (room: Room) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);

  const handleThreadListProgress = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      await loadRoomThreads(room, handleThreadListProgress);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [handleThreadListProgress, room]);

  useEffect(() => {
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
  }, [handleThreadListProgress, room]);

  useEffect(() => {
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
  }, [room]);

  const threads = useMemo(() => sortThreadsByActivity(room.getThreads()), [room, version]);
  const fullyLoaded = useMemo(() => roomThreadListIsComplete(room), [room, version]);

  return {
    threads,
    loading,
    fullyLoaded,
    error,
    retry: refresh,
  };
};
