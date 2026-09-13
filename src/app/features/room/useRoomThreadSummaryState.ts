import { useCallback } from 'react';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { storeThreadSummaryInState, useThreadSummaryStateMap } from './threadSummaryState';

type UseRoomThreadSummaryStateOptions = {
  roomId: string;
  sessionId: string;
};

export const useRoomThreadSummaryState = ({
  roomId,
  sessionId,
}: UseRoomThreadSummaryStateOptions) => {
  const summaryMap = useThreadSummaryStateMap({ roomId, sessionId });

  const storeThreadSummary = useCallback(
    (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => {
      storeThreadSummaryInState(sessionId, roomId, threadRootId, info);
    },
    [roomId, sessionId]
  );

  return {
    summaryMap,
    storeThreadSummary,
  };
};
