import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { ItemRange, ScrollToItem } from './useVirtualPaginator';
import type { RoomTimelineFocusItem, ScrollToBottomState } from './roomFocusScrollController';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import type { ViewScopedFlag } from './roomTimelineViewScope';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { scrollToBottom } from '../lib/dom';

/**
 * The room timeline's scroll area: the element it publishes to the controllers, the request that
 * keeps the newest room row at the bottom, what the reader's gestures do to the bottom pins, and
 * the jumps to a row of the window.
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
  /** The bottom pins asked for: each new `count` that a commit sees asks for the newest row. */
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  committedView: string;
  focusItem: RoomTimelineFocusItem | undefined;
  /** Runs at each gesture or scroll that hands the position to the reader. */
  onReaderGesture: () => void;
};

/**
 * A request to show the newest row. Opening the room, Jump to Latest, a message the reader sends,
 * a live row they follow, and switching the view make one; it holds until the reader scrolls, so
 * rows measured or grown later still end at the bottom. A view switch that React renders but never
 * shows makes none.
 * The reader's gesture also ends the pins asked for before it that no commit has seen yet: a row
 * that arrived while they were at the bottom must not bring them back once they scroll away.
 */
const useLatestRowRequest = ({
  opensAtLatest,
  roomId,
  scrollElement,
  scrollToBottomRef,
  committedView,
  focusItem,
  onReaderGesture,
}: LatestRowRequestOptions) => {
  const requestRef = useRef(opensAtLatest);
  const seenCountRef = useRef(scrollToBottomRef.current.count);
  const viewRef = useRef(committedView);
  const roomRef = useRef(roomId);
  const onReaderGestureRef = useLatestRef(onReaderGesture);
  useLayoutEffect(() => {
    if (viewRef.current === committedView) return;
    viewRef.current = committedView;
    // Another room opens as the first one did; another view of the same room at its newest row.
    requestRef.current = roomRef.current === roomId || opensAtLatest;
    roomRef.current = roomId;
  }, [committedView, opensAtLatest, roomId]);
  // Every commit compares the count as it is then: a render that React bails out of keeps the
  // count it read without running its effects, so effect dependencies would miss that pin.
  useLayoutEffect(() => {
    const { count } = scrollToBottomRef.current;
    if (count === seenCountRef.current) return;
    seenCountRef.current = count;
    requestRef.current = true;
  });
  useLayoutEffect(() => {
    // A jump to an event owns the position from here.
    if (focusItem) requestRef.current = false;
  }, [focusItem]);
  useEffect(() => {
    if (!scrollElement) return undefined;
    const release = () => {
      requestRef.current = false;
      seenCountRef.current = scrollToBottomRef.current.count;
      onReaderGestureRef.current();
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
  }, [onReaderGestureRef, scrollElement, scrollToBottomRef]);
  return requestRef;
};

/**
 * Keeps the newest row at the bottom while a request for it holds: after every commit, the room's
 * virtual list scrolls to its last row, and an open thread to the end of its scroll area. A pin
 * applied once can be cut short (a smooth scroll stops at the next scroll the timeline writes, as
 * when the composer grows) or land before the rows below it measure, and then every later row
 * would find the reader above the bottom and leave them there.
 */
export const useLatestRowPin = ({
  surface,
  itemCount,
  virtualizer,
  onReaderGesture,
  ...request
}: LatestRowRequestOptions & {
  /**
   * The rows it keeps: the room's own, an open thread's once the reader has scrolled it (until
   * then the pin the thread opened with holds), or none (the Compact cards).
   */
  surface: 'room' | 'thread' | undefined;
  itemCount: number;
  virtualizer: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex'>;
}) => {
  const surfaceRef = useLatestRef(surface);
  // A thread's gestures have their own rule (useGestureBottomPins' onThreadGesture).
  const onRoomGesture = useCallback(() => {
    if (surfaceRef.current === 'room') onReaderGesture();
  }, [onReaderGesture, surfaceRef]);
  const latestRowRequestRef = useLatestRowRequest({ ...request, onReaderGesture: onRoomGesture });
  // A thread's request starts with the reader's own scrolling: what was asked before belongs to
  // the pin the thread opened with.
  const surfaceAtLastCommitRef = useRef(surface);
  useLayoutEffect(() => {
    if (surfaceAtLastCommitRef.current === surface) return;
    surfaceAtLastCommitRef.current = surface;
    if (surface === 'thread') latestRowRequestRef.current = false;
  });
  const { scrollElement } = request;
  useLayoutEffect(() => {
    if (!surface || !latestRowRequestRef.current || itemCount === 0) return;
    if (surface === 'room') virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
    else if (scrollElement) scrollToBottom(scrollElement, 'instant');
  });
};

/**
 * What the reader's gestures do to the bottom pins. A pin is a request the next commit applies
 * (the count in `scrollToBottomRef`); a gesture drops every request made before it that no commit
 * has applied yet, and in an open thread it also ends the opening pin for the view. A row that
 * arrives while the reader is at the bottom asks to follow it, and the commit can come after the
 * reader started to scroll away: applied there, it would put them back at the bottom.
 */
export const useGestureBottomPins = ({
  backController,
  scrollToBottomRef,
  readerScrolledRef,
  onFirstGesture,
}: {
  backController: ThreadBackPaginationController;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  /** Whether the reader has scrolled the view shown now. */
  readerScrolledRef: MutableRefObject<ViewScopedFlag>;
  /** Runs once per view, at the reader's first gesture. */
  onFirstGesture: () => void;
}) => {
  // The request count when the reader last touched, scrolled or pressed a key.
  const countAtGestureRef = useRef<number | undefined>(undefined);
  const onThreadGesture = useCallback(() => {
    const { count } = scrollToBottomRef.current;
    backController.cancelOpenBottomPin(count);
    countAtGestureRef.current = count;
    if (readerScrolledRef.current.value) return;
    readerScrolledRef.current.value = true;
    onFirstGesture();
  }, [backController, onFirstGesture, readerScrolledRef, scrollToBottomRef]);
  /** The room rows' gestures (`useLatestRowPin`), which have no opening pin to end. */
  const onRoomGesture = useCallback(() => {
    countAtGestureRef.current = scrollToBottomRef.current.count;
  }, [scrollToBottomRef]);
  const shouldApplyBottomPin = useCallback(
    (count: number) =>
      count !== countAtGestureRef.current && backController.shouldApplyBottomPin(count),
    [backController]
  );
  return { onThreadGesture, onRoomGesture, shouldApplyBottomPin };
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
