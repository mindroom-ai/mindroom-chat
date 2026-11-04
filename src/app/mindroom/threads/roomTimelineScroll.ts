import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { ItemRange, ScrollToItem } from '../../hooks/useVirtualPaginator';
import type { RoomTimelineFocusItem } from './roomFocusScrollController';
import { isScrollNearBottom } from './timelineScrollUtils';

/**
 * The room timeline's scroll area: the element it publishes to the controllers, the request that
 * keeps the newest room row at the bottom, and the jumps to a row of the window.
 */

/**
 * The timeline's scroll element, as a ref for reads during events and as state for effects that
 * attach to it. folds' Scroll hands React a new ref callback on every render, so each commit
 * detaches the element (null) and attaches it again. Only a different element, or none left after
 * the commit, changes the state. Even an equal update re-renders the timeline while slower updates
 * wait on it, and that render attaches the element again, without end.
 */
export const useTimelineScrollElement = () => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const publishedScrollRef = useRef<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    const publishAttached = () => {
      const attached = scrollRef.current;
      if (attached === publishedScrollRef.current) return;
      publishedScrollRef.current = attached;
      setScrollElement(attached);
    };
    if (element) publishAttached();
    else queueMicrotask(publishAttached);
  }, []);
  // A new identity once the scroll area mounts, so observers built on it start over (the
  // compact view has none, and switching to the timeline mounts it later).
  const getScrollElement = useCallback(() => scrollRef.current ?? scrollElement, [scrollElement]);
  return { scrollRef, scrollElement, attachScroll, getScrollElement };
};

/** Whether the scroll area is at its bottom now; before it mounts, the last known answer. */
export const useViewportAtBottomNow = (
  scrollRef: MutableRefObject<HTMLElement | null>,
  atBottomRef: MutableRefObject<boolean>
) =>
  useCallback(() => {
    const element = scrollRef.current;
    if (!element) return atBottomRef.current;
    const { scrollHeight, scrollTop, clientHeight } = element;
    return isScrollNearBottom({ scrollHeight, scrollTop, clientHeight });
  }, [atBottomRef, scrollRef]);

/** Gestures and keys that hand the scroll position over to the reader. */
const READER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
/** How much further from the newest row a scroll must leave the reader to count as theirs. */
const LEFT_LATEST_ROW_PX = 32;

const distanceBelowView = (element: HTMLElement): number =>
  element.scrollHeight - element.scrollTop - element.clientHeight;

type LatestRowRequestOptions = {
  /** Whether opening this room shows its newest row (not its unread marker or an event). */
  opensAtLatest: boolean;
  roomId: string;
  scrollElement: HTMLElement | null;
  scrollToBottomCount: number;
  committedView: string;
  focusItem: RoomTimelineFocusItem | undefined;
};

/**
 * A request to show the newest room row. Opening the room, Jump to Latest, a live row the reader
 * follows, and switching the view make one; it holds until the reader scrolls, so rows measured
 * later still end at the bottom. A view switch that React renders but never shows makes none.
 */
const useLatestRowRequest = ({
  opensAtLatest,
  roomId,
  scrollElement,
  scrollToBottomCount,
  committedView,
  focusItem,
}: LatestRowRequestOptions) => {
  const requestRef = useRef(opensAtLatest);
  const seenCountRef = useRef(scrollToBottomCount);
  const viewRef = useRef(committedView);
  const roomRef = useRef(roomId);
  useLayoutEffect(() => {
    if (viewRef.current === committedView) return;
    viewRef.current = committedView;
    // Another room opens as the first one did; another view of the same room at its newest row.
    requestRef.current = roomRef.current === roomId || opensAtLatest;
    roomRef.current = roomId;
  }, [committedView, opensAtLatest, roomId]);
  useLayoutEffect(() => {
    if (scrollToBottomCount === seenCountRef.current) return;
    seenCountRef.current = scrollToBottomCount;
    requestRef.current = true;
  }, [scrollToBottomCount]);
  useLayoutEffect(() => {
    // A jump to an event owns the position from here.
    if (focusItem) requestRef.current = false;
  }, [focusItem]);
  useEffect(() => {
    if (!scrollElement) return undefined;
    const release = () => {
      requestRef.current = false;
    };
    // A scroll up that also leaves more rows below the view is the reader's too (the scrollbar,
    // a script or assistive technology): the timeline's own pins scroll down, and a row above
    // the view that changes size moves the position and the content by the same amount. It
    // listens in the capture phase, ahead of the virtualizer, whose scroll handler renders
    // synchronously and so would pin the newest row again before this saw the reader's position.
    let lastTop = scrollElement.scrollTop;
    let lastBelow = distanceBelowView(scrollElement);
    const followScroll = () => {
      const top = scrollElement.scrollTop;
      const below = distanceBelowView(scrollElement);
      if (top < lastTop && below > lastBelow + LEFT_LATEST_ROW_PX) release();
      lastTop = top;
      lastBelow = below;
    };
    READER_INTENT_EVENTS.forEach((name) =>
      scrollElement.addEventListener(name, release, { passive: true })
    );
    scrollElement.addEventListener('scroll', followScroll, { capture: true, passive: true });
    return () => {
      READER_INTENT_EVENTS.forEach((name) => scrollElement.removeEventListener(name, release));
      scrollElement.removeEventListener('scroll', followScroll, { capture: true });
    };
  }, [scrollElement]);
  return requestRef;
};

/**
 * Keeps the newest room row at the bottom while a request for it holds: after every commit of a
 * shown room surface, the virtual list scrolls to its last row.
 */
export const useLatestRowPin = ({
  shown,
  itemCount,
  virtualizer,
  ...request
}: LatestRowRequestOptions & {
  /** The room's own rows are on screen (not a thread, not the Compact cards). */
  shown: boolean;
  itemCount: number;
  virtualizer: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex'>;
}) => {
  const latestRowRequestRef = useLatestRowRequest(request);
  useLayoutEffect(() => {
    if (!shown || !latestRowRequestRef.current || itemCount === 0) return;
    virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
  });
};

/**
 * Jumps to a row. The paginator scrolls to mounted rows and moves the window; the virtual list
 * scrolls to the rows of the window it has not mounted. A thread's rows are all in the list.
 */
export const useTimelineRowJumps = ({
  paginatorScrollToItem,
  activeRangeRef,
  virtualizerRef,
  threadEventIndexMapRef,
}: {
  paginatorScrollToItem: ScrollToItem;
  activeRangeRef: MutableRefObject<ItemRange>;
  virtualizerRef: MutableRefObject<Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex'>>;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
}) => {
  const scrollToItem = useCallback<ScrollToItem>(
    (index, opts) => {
      if (paginatorScrollToItem(index, opts)) return true;
      const { start, end } = activeRangeRef.current;
      if (index < start || index >= end) return false;
      virtualizerRef.current.scrollToIndex(index - start, {
        align: opts?.align ?? 'center',
        behavior: opts?.behavior === 'smooth' ? 'smooth' : 'auto',
      });
      return true;
    },
    [activeRangeRef, paginatorScrollToItem, virtualizerRef]
  );
  const scrollThreadEventIntoView = useCallback(
    (targetEventId: string) => {
      const index = threadEventIndexMapRef.current.get(targetEventId);
      if (index === undefined) return false;
      virtualizerRef.current.scrollToIndex(index, { align: 'center' });
      return true;
    },
    [threadEventIndexMapRef, virtualizerRef]
  );
  return { scrollToItem, scrollThreadEventIntoView };
};
