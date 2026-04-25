import { useEffect, useMemo } from 'react';
import type { MatrixEvent, Thread } from 'matrix-js-sdk';
import {
  getLatestThreadSummaryInfoFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';

export const getActiveThreadSummaryInfo = ({
  thread,
  threadEvents,
  threadId,
}: {
  thread: Pick<Thread, 'events' | 'timeline'> | null;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
}): MindroomThreadSummaryInfo | undefined =>
  threadId
    ? getLatestThreadSummaryInfoFromEventSources(threadEvents, thread?.events, thread?.timeline)
    : undefined;

export const useThreadSummaryPublishController = ({
  onStoreThreadSummary,
  thread,
  threadEvents,
  threadId,
  threadSummaryInfoMap,
}: {
  onStoreThreadSummary: (
    threadRootId: string,
    info: MindroomThreadSummaryInfo | undefined
  ) => void;
  thread: Pick<Thread, 'events' | 'timeline'> | null;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
  threadSummaryInfoMap: Map<string, MindroomThreadSummaryInfo>;
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
      onStoreThreadSummary(threadRootId, info);
    });
  }, [onStoreThreadSummary, threadId, threadSummaryInfoMap]);

  useEffect(() => {
    if (!threadId) return;
    onStoreThreadSummary(threadId, activeThreadSummaryInfo);
  }, [activeThreadSummaryInfo, onStoreThreadSummary, threadId]);

  return activeThreadSummaryInfo;
};
