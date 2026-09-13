import type { EventTimelineSet, MatrixClient, Room } from 'matrix-js-sdk';
import type { Dispatch, SetStateAction } from 'react';
import to from 'await-to-js';

export type PendingThreadOpen = {
  attempts: number;
  eventId: string;
  highlight: boolean;
  onScroll?: (success: boolean) => void;
  threadId: string;
};

type RunThreadOpenTargetEventOptions = {
  eventId?: string;
  forceTimelineUpdate: () => void;
  isCurrentThreadOpen: () => boolean;
  mx: MatrixClient;
  room: Room;
  setPendingThreadOpen: (pending: PendingThreadOpen) => void;
  setPendingThreadOpenTick: Dispatch<SetStateAction<number>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
};

export const runThreadOpenTargetEvent = async ({
  eventId,
  forceTimelineUpdate,
  isCurrentThreadOpen,
  mx,
  room,
  setPendingThreadOpen,
  setPendingThreadOpenTick,
  setThreadTimelineTick,
  shouldScrollToLatestOnOpen,
  threadId,
}: RunThreadOpenTargetEventOptions): Promise<boolean> => {
  if (shouldScrollToLatestOnOpen || !eventId || eventId === threadId) {
    return true;
  }

  const evtThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet() as
    | EventTimelineSet
    | undefined;
  if (evtThreadTimelineSet) {
    const [evtErr] = await to(mx.getEventTimeline(evtThreadTimelineSet, eventId));
    if (!isCurrentThreadOpen()) return false;
    if (!evtErr) {
      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
    }
  }

  setPendingThreadOpen({
    threadId,
    eventId,
    highlight: true,
    onScroll: undefined,
    attempts: 0,
  });
  setPendingThreadOpenTick((val) => val + 1);
  return true;
};
