import { useCallback, useEffect, useRef, useState } from 'react';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { loadCachedThreadSummaries, saveCachedThreadSummary } from './threadSummaryCache';
import { shouldWriteThreadSummaryToCache } from './threadSummarySelection';

type UseRoomThreadSummaryStateOptions = {
  roomId: string;
  sessionId: string;
};

export const useRoomThreadSummaryState = ({
  roomId,
  sessionId,
}: UseRoomThreadSummaryStateOptions) => {
  const [summaryMap, setSummaryMap] = useState<Map<string, MindroomThreadSummaryInfo>>(
    () => new Map()
  );
  const summaryMapRef = useRef(summaryMap);
  summaryMapRef.current = summaryMap;

  useEffect(() => {
    let cancelled = false;

    loadCachedThreadSummaries(sessionId, roomId)
      .then((cached) => {
        if (cancelled || cached.size === 0) return;
        summaryMapRef.current = cached;
        setSummaryMap(cached);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [roomId, sessionId]);

  const storeThreadSummary = useCallback(
    (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => {
      if (!threadRootId) return;
      if (!shouldWriteThreadSummaryToCache(summaryMapRef.current.get(threadRootId), info)) return;
      const next = new Map(summaryMapRef.current);
      next.set(threadRootId, info);
      summaryMapRef.current = next;
      setSummaryMap(next);
      saveCachedThreadSummary(sessionId, roomId, threadRootId, info).catch(() => {});
    },
    [roomId, sessionId]
  );

  return {
    summaryMap,
    storeThreadSummary,
  };
};
