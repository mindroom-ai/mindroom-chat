type TimelineAtLiveEndOpts = {
  threadId?: string;
  liveTimelineLinked: boolean;
  rangeAtEnd: boolean;
  canPaginateThreadFront: boolean;
  threadTailLoaded?: boolean;
};

type ScrollNearBottomOpts = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  thresholdPx?: number;
};

type ThreadAutoScrollOpts = {
  relationType?: string;
  isNearBottom: boolean;
  isTimelineAtLiveEnd: boolean;
};

export const isTimelineAtLiveEnd = ({
  threadId,
  liveTimelineLinked,
  rangeAtEnd,
  canPaginateThreadFront,
  threadTailLoaded,
}: TimelineAtLiveEndOpts): boolean =>
  threadId ? !!threadTailLoaded || !canPaginateThreadFront : liveTimelineLinked && rangeAtEnd;

export const isScrollNearBottom = ({
  scrollHeight,
  scrollTop,
  clientHeight,
  thresholdPx = 24,
}: ScrollNearBottomOpts): boolean =>
  scrollHeight - scrollTop - clientHeight <= thresholdPx;

export const shouldAutoScrollThreadOnLiveEvent = ({
  relationType,
  isNearBottom,
  isTimelineAtLiveEnd: atLiveEnd,
}: ThreadAutoScrollOpts): boolean =>
  relationType === 'm.thread' && isNearBottom && atLiveEnd;
