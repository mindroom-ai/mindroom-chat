import { MatrixEventEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { useEffect, useState } from 'react';
import {
  getRecentThreadFallbackSummary,
  getResolvedRecentThreadRootId,
  shouldPersistRecentThreadSummaryText,
  truncateRecentThreadSummaryText,
} from '../recent-threads/recentThreadSummaryUtils';
import {
  clearThreadSummarySharedState,
  useThreadSummaryStateMap,
} from './threadSummaryStore';
import { useRoomName } from '../../hooks/useRoomMeta';
import { useActiveSession } from '../../hooks/useSessionStore';
import { buildThreadRecord } from './threadRecord';
import type { RecentThreadViewModel, ThreadRecord } from './types';

type BuildRecentThreadViewModelFromRecordOptions = {
  record: ThreadRecord;
  room: Room;
  roomName: string;
  storedThreadId: string;
  openedAt: number;
  fallbackSummaryText?: string;
};

const getRecordRecentSummaryText = (record: ThreadRecord): string | undefined =>
  record.presentation.recentThreadSummaryText ??
  record.presentation.summaryText ??
  record.presentation.primarySummaryText ??
  record.presentation.rootPreviewText;

export const buildRecentThreadViewModelFromRecord = ({
  record,
  room,
  roomName,
  storedThreadId,
  openedAt,
  fallbackSummaryText,
}: BuildRecentThreadViewModelFromRecordOptions): RecentThreadViewModel => {
  const rawSummaryText =
    getRecordRecentSummaryText(record) ??
    fallbackSummaryText ??
    getRecentThreadFallbackSummary(room, roomName);
  const summaryText = truncateRecentThreadSummaryText(rawSummaryText);
  const persistableSummaryText = shouldPersistRecentThreadSummaryText(room, roomName, summaryText)
    ? summaryText
    : undefined;

  return {
    id: {
      roomId: record.roomId,
      threadRootId: record.threadRootId,
    },
    storedThreadId,
    openedAt,
    roomName,
    summaryText,
    persistableSummaryText,
    shouldRekey: storedThreadId !== record.threadRootId,
  };
};

type RoomSummaryListener = () => void;

type RoomSummarySubscription = {
  listeners: Set<RoomSummaryListener>;
  dispose: () => void;
};

const roomSummarySubscriptions = new Map<Room, RoomSummarySubscription>();

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

export const clearRecentThreadViewModelSharedState = () => {
  clearThreadSummarySharedState();
  roomSummarySubscriptions.forEach((subscription) => {
    subscription.dispose();
  });
  roomSummarySubscriptions.clear();
};

export const useRecentThreadViewModel = (
  room: Room,
  threadId: string,
  openedAt: number,
  fallbackSummaryText?: string
): RecentThreadViewModel => {
  const activeSession = useActiveSession();
  const roomName = useRoomName(room);
  const [, setRefreshVersion] = useState(0);
  const sharedSummaryMap = useThreadSummaryStateMap({
    roomId: room.roomId,
    sessionId: activeSession?.sessionId,
  });

  const resolvedThreadId = getResolvedRecentThreadRootId(room, threadId);
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
  }, [rootEvent]);

  const record = buildThreadRecord({
    room,
    threadRootId: resolvedThreadId,
    threadRootEvent: rootEvent,
    summaryInfo: sharedSummaryMap.get(resolvedThreadId),
  });

  return buildRecentThreadViewModelFromRecord({
    record,
    room,
    roomName,
    storedThreadId: threadId,
    openedAt,
    fallbackSummaryText,
  });
};
