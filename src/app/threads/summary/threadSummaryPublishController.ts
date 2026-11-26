import { useEffect, useMemo } from 'react';
import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import {
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryInfosFromEventSources,
  type ThreadSummaryInfo,
} from '../../matrix/protocol/threadSummary';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import type { ThreadSummaryWriter } from '../../event-store/threads/threadSummaryState';

export const getActiveThreadSummaryInfo = ({
  thread,
  threadEvents,
  threadId,
}: {
  thread: Pick<Thread, 'events' | 'timeline'> | null;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
}): ThreadSummaryInfo | undefined =>
  threadId
    ? getLatestThreadSummaryInfoFromEventSources(threadEvents, thread?.events, thread?.timeline)
    : undefined;

const EMPTY_EVENTS: MatrixEvent[] = [];
const EMPTY_SUMMARY_MAP = new Map<string, ThreadSummaryInfo>();

export const useThreadSummaryPublishController = ({
  onStoreThreadSummary,
  room,
  thread = null,
  threadEvents = EMPTY_EVENTS,
  threadId,
  threadSummaryInfoMap = EMPTY_SUMMARY_MAP,
}: {
  onStoreThreadSummary: ThreadSummaryWriter;
  room: Pick<Room, 'getThread'>;
  thread?: Pick<Thread, 'events' | 'timeline'> | null;
  threadEvents?: MatrixEvent[];
  threadId?: string;
  threadSummaryInfoMap?: Map<string, ThreadSummaryInfo>;
}) => {
  const activeThreadSummaryInfo = useMemo(
    () =>
      getActiveThreadSummaryInfo({
        thread,
        threadEvents,
        threadId,
      }),
    [thread, threadEvents, threadId]
  );

  useEffect(() => {
    if (threadId) return;
    threadSummaryInfoMap.forEach((info, threadRootId) => {
      const knownThread = room.getThread(threadRootId);
      onStoreThreadSummary(
        threadRootId,
        info,
        ...getThreadSummaryInfosFromEventSources(knownThread?.events, knownThread?.timeline)
      );
    });
  }, [onStoreThreadSummary, room, threadId, threadSummaryInfoMap]);

  useEffect(() => {
    if (!isConfirmedMatrixEventId(threadId)) return;
    onStoreThreadSummary(
      threadId,
      ...getThreadSummaryInfosFromEventSources(threadEvents, thread?.events, thread?.timeline)
    );
  }, [onStoreThreadSummary, thread, threadEvents, threadId]);

  return activeThreadSummaryInfo;
};
