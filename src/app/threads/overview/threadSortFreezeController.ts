import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ThreadSortFreezeState } from '../../event-store/threads/roomThreadOverviewModel';

export const resolveThreadSortFreezeUpdate = ({
  activeLiveOverviewThreadRootIds,
  sortInputOf,
  currentState,
  threadSortControlSignature,
}: {
  activeLiveOverviewThreadRootIds: string[];
  sortInputOf?: (id: string) => string | undefined;
  currentState: ThreadSortFreezeState | null;
  threadSortControlSignature: string;
}): ThreadSortFreezeState | null => {
  if (!currentState) return currentState;
  if (currentState.controlSignature === threadSortControlSignature) {
    return currentState;
  }

  return {
    controlSignature: threadSortControlSignature,
    orderedRootIds: activeLiveOverviewThreadRootIds,
    ...(sortInputOf && {
      sortInputs: new Map(activeLiveOverviewThreadRootIds.map((id) => [id, sortInputOf(id)])),
    }),
  };
};

export const useThreadSortFreezeController = ({
  activeLiveOverviewThreadRootIds,
  sortInputOf,
  setThreadSortFreezeState,
  threadId,
  threadSortControlSignature,
  threadSortFreezeState,
}: {
  activeLiveOverviewThreadRootIds: string[];
  sortInputOf?: (id: string) => string | undefined;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  threadId: string | undefined;
  threadSortControlSignature: string;
  threadSortFreezeState: ThreadSortFreezeState | null;
}) => {
  useEffect(() => {
    if (threadId || !threadSortFreezeState) return;
    if (threadSortFreezeState.controlSignature === threadSortControlSignature) return;

    setThreadSortFreezeState((currentState) =>
      resolveThreadSortFreezeUpdate({
        activeLiveOverviewThreadRootIds,
        sortInputOf,
        currentState,
        threadSortControlSignature,
      })
    );
  }, [
    activeLiveOverviewThreadRootIds,
    sortInputOf,
    setThreadSortFreezeState,
    threadId,
    threadSortControlSignature,
    threadSortFreezeState,
  ]);
};
