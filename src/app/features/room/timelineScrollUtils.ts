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

type RoomAutoScrollOpts = {
  scrollElement: HTMLElement | null;
  isTimelineAtLiveEnd: boolean;
  thresholdPx?: number;
};

/**
 * Determines whether the main room timeline should auto-scroll to bottom
 * on a live event by measuring the **current** scroll position instead of
 * relying on the debounced `atBottom` state.  This prevents streaming
 * `m.replace` edits from trapping the user at the bottom when they have
 * already scrolled away (CINNY-031).
 */
export const shouldAutoScrollRoomOnLiveEvent = ({
  scrollElement,
  isTimelineAtLiveEnd,
  thresholdPx = 100,
}: RoomAutoScrollOpts): boolean => {
  if (!isTimelineAtLiveEnd || !scrollElement) return false;
  return isScrollNearBottom({
    scrollHeight: scrollElement.scrollHeight,
    scrollTop: scrollElement.scrollTop,
    clientHeight: scrollElement.clientHeight,
    thresholdPx,
  });
};
