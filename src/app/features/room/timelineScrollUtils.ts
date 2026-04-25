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

export type ThreadPrependScrollAnchor = {
  eventId: string;
  top: number;
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

export const getEventElementById = (
  container: ParentNode | null | undefined,
  eventId: string
): HTMLElement | null => {
  if (!container) return null;
  const messageItems = container.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const item of messageItems) {
    if (item.getAttribute('data-message-id') === eventId) {
      return item;
    }
  }
  return null;
};

const resolveThreadScrollContainer = (
  scrollRoot: HTMLElement,
  seedElement?: HTMLElement | null
): HTMLElement => {
  let current: HTMLElement | null =
    seedElement ??
    scrollRoot.querySelector<HTMLElement>('[data-message-id]')?.parentElement ??
    null;

  while (current && current !== scrollRoot) {
    if (current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }

  return scrollRoot;
};

export const captureThreadPrependScrollAnchor = (
  scrollRoot: HTMLElement | null | undefined
): ThreadPrependScrollAnchor | undefined => {
  if (!scrollRoot) return undefined;

  const scrollContainer = resolveThreadScrollContainer(scrollRoot);
  const scrollRect = scrollContainer.getBoundingClientRect();
  const messageItems = scrollRoot.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const item of messageItems) {
    const eventId = item.getAttribute('data-message-id');
    if (!eventId) continue;

    const itemRect = item.getBoundingClientRect();
    if (itemRect.bottom <= scrollRect.top || itemRect.top >= scrollRect.bottom) {
      continue;
    }

    return {
      eventId,
      top: itemRect.top,
    };
  }

  return undefined;
};

export const restoreThreadPrependScrollAnchor = (
  scrollRoot: HTMLElement | null | undefined,
  anchor: ThreadPrependScrollAnchor | null | undefined
): boolean => {
  if (!scrollRoot || !anchor) return false;

  const target = getEventElementById(scrollRoot, anchor.eventId);
  if (!target) return false;

  const scrollContainer = resolveThreadScrollContainer(scrollRoot, target);
  const delta = target.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) <= 1) return true;

  scrollContainer.scrollTop += delta;

  return true;
};
