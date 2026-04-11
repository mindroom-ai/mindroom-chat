import { MatrixEventEvent } from 'matrix-js-sdk';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { useEffect, useState } from 'react';
import { getLatestThreadSummaryInfoFromEventSources } from '../../components/message/mindroomThreadSummary';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useRoomName } from '../../hooks/useRoomMeta';
import { getCompactThreadRootBodyPreviewText } from '../room/compactThreadRootData';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { loadCachedThreadSummaries } from '../room/threadSummaryCache';

const RECENT_THREAD_SUMMARY_LIMIT = 120;
const ROOM_SUMMARY_CACHE_LIMIT = 32;

const truncateText = (value: string): string =>
  value.length <= RECENT_THREAD_SUMMARY_LIMIT
    ? value
    : `${value.slice(0, RECENT_THREAD_SUMMARY_LIMIT - 3).trimEnd()}...`;

type RoomSummaryListener = () => void;

type RoomSummarySubscription = {
  listeners: Set<RoomSummaryListener>;
  dispose: () => void;
};

const roomSummaryCache = new Map<string, Promise<Map<string, MindroomThreadSummaryInfo>>>();
const roomSummarySubscriptions = new Map<Room, RoomSummarySubscription>();

const getResolvedThreadRootId = (room: Room, threadId: string): string => {
  if (room.getThread(threadId)) return threadId;

  const event = room.findEventById(threadId);
  const rootId = event?.threadRootId;
  if (rootId && rootId !== threadId) return rootId;

  return threadId;
};

const getFallbackSummary = (room: Room, roomName: string): string => {
  if (room.hasEncryptionStateEvent()) return 'Encrypted thread';
  if (roomName.trim().length > 0) return `Thread in ${roomName}`;
  return 'Thread';
};

const getRootPreviewText = (
  room: Room,
  threadRootId: string,
  rootEvent: MatrixEvent | undefined
): string | undefined => {
  const previewText = getCompactThreadRootBodyPreviewText(rootEvent, {
    eventId: threadRootId,
    room,
  });

  return previewText ? truncateText(previewText) : undefined;
};

const getRoomSummaryCacheKey = (sessionId: string, roomId: string) => `${sessionId}|${roomId}`;

const touchRoomSummaryCache = (
  cacheKey: string,
  promise: Promise<Map<string, MindroomThreadSummaryInfo>>
) => {
  if (roomSummaryCache.has(cacheKey)) {
    roomSummaryCache.delete(cacheKey);
  }

  roomSummaryCache.set(cacheKey, promise);

  while (roomSummaryCache.size > ROOM_SUMMARY_CACHE_LIMIT) {
    const oldestKey = roomSummaryCache.keys().next().value;
    if (!oldestKey) return;
    roomSummaryCache.delete(oldestKey);
  }
};

const loadSharedCachedThreadSummaries = (
  sessionId: string,
  roomId: string
): Promise<Map<string, MindroomThreadSummaryInfo>> => {
  const cacheKey = getRoomSummaryCacheKey(sessionId, roomId);
  const cachedPromise = roomSummaryCache.get(cacheKey);
  if (cachedPromise) {
    touchRoomSummaryCache(cacheKey, cachedPromise);
    return cachedPromise;
  }

  const promise = loadCachedThreadSummaries(sessionId, roomId).catch((error) => {
    roomSummaryCache.delete(cacheKey);
    throw error;
  });
  touchRoomSummaryCache(cacheKey, promise);
  return promise;
};

const subscribeToRoomThreadSummaryEvents = (room: Room, listener: RoomSummaryListener) => {
  const currentSubscription = roomSummarySubscriptions.get(room);
  if (currentSubscription) {
    currentSubscription.listeners.add(listener);
    return () => {
      currentSubscription.listeners.delete(listener);
      if (currentSubscription.listeners.size > 0) return;

      currentSubscription.dispose();
      roomSummarySubscriptions.delete(room);
    };
  }

  const listeners = new Set<RoomSummaryListener>([listener]);
  const notifyListeners = () => {
    listeners.forEach((currentListener) => currentListener());
  };

  room.on(ThreadEvent.New, notifyListeners);
  room.on(ThreadEvent.Update, notifyListeners);
  room.on(ThreadEvent.NewReply, notifyListeners);
  room.on(ThreadEvent.Delete, notifyListeners);

  const subscription: RoomSummarySubscription = {
    listeners,
    dispose: () => {
      room.removeListener(ThreadEvent.New, notifyListeners);
      room.removeListener(ThreadEvent.Update, notifyListeners);
      room.removeListener(ThreadEvent.NewReply, notifyListeners);
      room.removeListener(ThreadEvent.Delete, notifyListeners);
    },
  };

  roomSummarySubscriptions.set(room, subscription);

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;

    subscription.dispose();
    roomSummarySubscriptions.delete(room);
  };
};

export const clearRecentThreadSummarySharedState = () => {
  roomSummaryCache.clear();
  roomSummarySubscriptions.forEach((subscription) => {
    subscription.dispose();
  });
  roomSummarySubscriptions.clear();
};

export const useRecentThreadSummary = (room: Room, threadId: string) => {
  const activeSession = useActiveSession();
  const roomName = useRoomName(room);
  const [cachedSummary, setCachedSummary] = useState<string>();
  const [, setRefreshVersion] = useState(0);

  const resolvedThreadId = getResolvedThreadRootId(room, threadId);
  const thread = room.getThread(resolvedThreadId);
  const rootEvent = thread?.rootEvent ?? room.findEventById(resolvedThreadId);

  useEffect(() => {
    const refresh = () => {
      setRefreshVersion((current) => current + 1);
    };

    return subscribeToRoomThreadSummaryEvents(room, refresh);
  }, [room]);

  useEffect(() => {
    const refresh = () => {
      setRefreshVersion((current) => current + 1);
    };

    rootEvent?.on(MatrixEventEvent.Replaced, refresh);

    return () => {
      rootEvent?.removeListener(MatrixEventEvent.Replaced, refresh);
    };
  }, [room, rootEvent]);

  useEffect(() => {
    const sessionId = activeSession?.sessionId;
    setCachedSummary(undefined);
    if (!sessionId) {
      return;
    }

    let cancelled = false;

    loadSharedCachedThreadSummaries(sessionId, room.roomId)
      .then((summaryMap) => {
        if (cancelled) return;

        const summaryText = summaryMap.get(resolvedThreadId)?.summaryText;
        setCachedSummary(summaryText ? truncateText(summaryText) : undefined);
      })
      .catch(() => {
        if (!cancelled) {
          setCachedSummary(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession?.sessionId, resolvedThreadId, room.roomId]);

  const liveSummaryText = getLatestThreadSummaryInfoFromEventSources(
    thread?.events,
    thread?.timeline
  )?.summaryText;
  const summary =
    (liveSummaryText && truncateText(liveSummaryText)) ||
    getRootPreviewText(room, resolvedThreadId, rootEvent) ||
    cachedSummary ||
    getFallbackSummary(room, roomName);

  return {
    summary,
    resolvedThreadId,
  };
};
