import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { EventTimeline } from 'matrix-js-sdk';
import type { ItemRange, ScrollToElement, ScrollToItem } from './useVirtualPaginator';
import type { RoomTimelineFocusItem, ScrollToBottomState } from './roomFocusScrollController';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import type { ViewScopedFlag } from './roomTimelineViewScope';
import {
  isScrollNearBottom,
  TIMELINE_BOTTOM_THRESHOLD_PX,
} from '../event-store/timeline/timelineScrollUtils';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { scrollToBottom } from '../lib/dom';

/**
 * The room timeline's scroll area: the element it publishes to the controllers, the request that
 * keeps the newest room row at the bottom, what the reader's gestures do to the bottom pins, and
 * the jumps to a row of the window.
 */

/**
 * The list's height in a render that corrects the scroll position inside the browser's
 * ResizeObserver loop: the list keeps its bottom edge where the screen has it, so the scroll content
 * keeps its size until the next render. `rendered` is the list's style on screen; the ledger's
 * pixels set its top margin to `-ledgerPx` in that render, and the height takes the difference.
 */
export const heldListHeight = (
  rendered: { height: string; marginTop: string },
  ledgerPx: number
): number =>
  Number.parseFloat(rendered.height) + (Number.parseFloat(rendered.marginTop) || 0) + ledgerPx;

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

/**
 * The room's newest row ends its rows, except in a Threads view whose filter bar sorts by Last
 * Reply, newest first: there the newest thread comes first, and the top is the rows' latest end,
 * where the timeline opens, follows new rows and jumps to with Jump to Latest.
 */
export const scrollToLatestEnd = (
  element: HTMLElement,
  latestAtTop: boolean,
  behavior: ScrollBehavior = 'instant'
): void => {
  if (latestAtTop) element.scrollTo({ top: 0, behavior });
  else scrollToBottom(element, behavior);
};

/** Whether the view is within the follow threshold of the rows' latest end (`scrollToLatestEnd`). */
export const isNearLatestEnd = (element: HTMLElement, latestAtTop: boolean): boolean => {
  const { scrollHeight, scrollTop, clientHeight } = element;
  if (latestAtTop) return scrollTop <= TIMELINE_BOTTOM_THRESHOLD_PX;
  return isScrollNearBottom({ scrollHeight, scrollTop, clientHeight });
};

/**
 * Whether the latest-end anchor (the mark at the rows' latest end) is within the follow threshold
 * of the scroll area, so the reader counts as at the latest end: at most that far below its lower
 * edge or, with the newest row first, above its upper edge. Without a scroll area, the window's.
 */
export const isLatestAnchorInReach = (
  anchor: Element,
  scrollArea: Element | null | undefined,
  latestAtTop: boolean
): boolean => {
  const anchorRect = anchor.getBoundingClientRect();
  const areaRect = scrollArea?.getBoundingClientRect();
  if (latestAtTop) return anchorRect.bottom >= (areaRect?.top ?? 0) - TIMELINE_BOTTOM_THRESHOLD_PX;
  const lowerEdge = areaRect?.bottom ?? window.innerHeight;
  return anchorRect.top <= lowerEdge + TIMELINE_BOTTOM_THRESHOLD_PX;
};

/**
 * Whether the scroll area is at its bottom now, or with `latestAtTopRef` at the rows' latest end;
 * before it mounts, the last known answer.
 */
export const useViewportAtBottomNow = (
  scrollRef: MutableRefObject<HTMLElement | null>,
  atBottomRef: MutableRefObject<boolean>,
  latestAtTopRef?: MutableRefObject<boolean>
) =>
  useCallback(() => {
    const element = scrollRef.current;
    if (!element) return atBottomRef.current;
    return isNearLatestEnd(element, !!latestAtTopRef?.current);
  }, [atBottomRef, latestAtTopRef, scrollRef]);

/** Gestures and keys that hand the scroll position over to the reader. */
export const READER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
/** How much further from the newest row a scroll must leave the reader to count as theirs. */
const LEFT_LATEST_ROW_PX = 32;

const distanceBelowView = (element: HTMLElement): number =>
  element.scrollHeight - element.scrollTop - element.clientHeight;

type LatestRowRequestOptions = {
  /** Whether opening this room shows its newest row (not its unread marker or an event). */
  opensAtLatest: boolean;
  /** Whether the room's newest row is its first (`scrollToLatestEnd`). */
  latestAtTop?: boolean;
  roomId: string;
  scrollElement: HTMLElement | null;
  /** The bottom pins asked for: each new `count` that a commit sees asks for the newest row. */
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  committedView: string;
  focusItem: RoomTimelineFocusItem | undefined;
  /** Runs at each gesture or scroll that hands the position to the reader. */
  onReaderGesture: () => void;
  /**
   * The room that rows which shrank still take in the list until React renders it
   * (`listShrinkNotRendered`). The correction that keeps the end in place for them moves the
   * position up by as much, and that scroll is not the reader's.
   */
  pendingListShrinkPx?: () => number;
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
  latestAtTop,
  roomId,
  scrollElement,
  scrollToBottomRef,
  committedView,
  focusItem,
  onReaderGesture,
  pendingListShrinkPx,
}: LatestRowRequestOptions) => {
  const requestRef = useRef(opensAtLatest);
  const seenCountRef = useRef(scrollToBottomRef.current.count);
  const viewRef = useRef(committedView);
  const roomRef = useRef(roomId);
  const onReaderGestureRef = useLatestRef(onReaderGesture);
  const latestAtTopRef = useLatestRef(!!latestAtTop);
  const pendingListShrinkPxRef = useLatestRef(pendingListShrinkPx);
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
    // With the newest row first, the pins scroll up, and a scroll down away from the top is the
    // reader's. The room below the view that rows which shrank still take until React renders the
    // list does not count: the correction that keeps the end in place for them scrolls up as much.
    // The rows can still measure a shrink that React has already rendered: never less than none.
    // A scroll up no larger than the scroll area grew is the browser keeping the position inside
    // the taller area (a phone's keyboard band that widens while the rows measure again): the
    // view's lower edge stays where it was, and that scroll is not the reader's either.
    const roomBelow = () =>
      Math.max(0, distanceBelowView(scrollElement) - (pendingListShrinkPxRef.current?.() ?? 0));
    let lastTop = scrollElement.scrollTop;
    let lastBelow = roomBelow();
    let lastHeight = scrollElement.clientHeight;
    const followScroll = () => {
      const top = scrollElement.scrollTop;
      const below = roomBelow();
      const height = scrollElement.clientHeight;
      const lowerEdgeRose = top < lastTop && top + height < lastTop + lastHeight;
      const leftLatest = latestAtTopRef.current
        ? top > lastTop + LEFT_LATEST_ROW_PX
        : lowerEdgeRose && below > lastBelow + LEFT_LATEST_ROW_PX;
      if (leftLatest) release();
      lastTop = top;
      lastBelow = below;
      lastHeight = height;
    };
    READER_INTENT_EVENTS.forEach((name) =>
      scrollElement.addEventListener(name, release, { passive: true })
    );
    scrollElement.addEventListener('scroll', followScroll, { capture: true, passive: true });
    return () => {
      READER_INTENT_EVENTS.forEach((name) => scrollElement.removeEventListener(name, release));
      scrollElement.removeEventListener('scroll', followScroll, { capture: true });
    };
  }, [
    latestAtTopRef,
    onReaderGestureRef,
    pendingListShrinkPxRef,
    scrollElement,
    scrollToBottomRef,
  ]);
  return requestRef;
};

/**
 * A place in the room's rows: the row of `eventId` starts `offset` px below the scroll area's top.
 */
export type RoomRowsPlace = { roomId: string; eventId: string; offset: number };

/**
 * The room's row that starts highest among those in view. Measured from the scroll area's own top,
 * not the band its scroll padding keeps for the bars over the rows: those bars can change height
 * between the thread's opening and the way back (a phone's thread header).
 */
const readRoomRowsPlace = (
  scrollElement: HTMLElement,
  roomId: string
): RoomRowsPlace | undefined => {
  const viewTop = scrollElement.getBoundingClientRect().top;
  let place: RoomRowsPlace | undefined;
  scrollElement
    .querySelectorAll<HTMLElement>('[data-room-row-index] [data-message-id]')
    .forEach((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      const eventId = row.getAttribute('data-message-id');
      if (!eventId || bottom <= viewTop || (place && top - viewTop >= place.offset)) return;
      place = { roomId, eventId, offset: top - viewTop };
    });
  return place;
};

/**
 * The place of the room's rows while a thread opened over them is open, so the way back shows
 * them where the reader left them, as Compact's cards do, rather than at the newest row. Opening
 * or leaving a thread mounts the timeline anew (the approvals provider around it is keyed by the
 * thread), so the place lives in the room view's `memoryRef`: the rows save it as they unmount,
 * unless the reader was at their latest end, which they keep following. A thread of the same room
 * leaves it there; the rows of the same room, shown without a route to an event (which places them
 * itself), take it and come back there. Any other view forgets it.
 */
export const useThreadReturnPlace = ({
  memoryRef,
  roomId,
  threadId,
  eventId,
  roomRowsShown,
  latestAtTop,
  scrollRef,
}: {
  memoryRef: MutableRefObject<RoomRowsPlace | undefined>;
  roomId: string;
  threadId: string | undefined;
  eventId: string | undefined;
  /** Whether the view shows the room's rows (not a thread, not Compact's cards). */
  roomRowsShown: boolean;
  latestAtTop: boolean;
  scrollRef: MutableRefObject<HTMLElement | null>;
}): RoomRowsPlace | undefined => {
  const [place] = useState(() => {
    const saved = memoryRef.current;
    return saved?.roomId === roomId && !threadId && roomRowsShown && !eventId ? saved : undefined;
  });
  // A thread renders before the rows it replaces save their place, in its own commit.
  const forThreadRef = useRef(!!threadId);
  const shownRef = useRef({ roomId, roomRowsShown, latestAtTop, scrollRef });
  shownRef.current = { roomId, roomRowsShown, latestAtTop, scrollRef };
  useLayoutEffect(() => {
    if (!forThreadRef.current) memoryRef.current = undefined;
    return () => {
      // Unmounting, while the rows are still on screen.
      const shown = shownRef.current;
      const scrollElement = shown.scrollRef.current;
      if (!shown.roomRowsShown || !scrollElement) return;
      memoryRef.current = isNearLatestEnd(scrollElement, shown.latestAtTop)
        ? undefined
        : readRoomRowsPlace(scrollElement, shown.roomId);
    };
  }, [memoryRef]);
  return place;
};

/**
 * Ends the scroll the virtual list still reconciles. virtual-core (3.17.3) keeps the row or offset
 * it was last asked to scroll to (`scrollState`) and, until it lands there or 5 s pass, scrolls
 * there again whenever that target moves (`reconcileScroll`): a row that arrives or changes size
 * in that time would pull a reader who has scrolled away back to it. It has no public way to drop
 * that scroll; its `cleanup` clears the same field.
 */
const endVirtualListScroll = (virtualizer: object) => {
  (virtualizer as { scrollState?: unknown }).scrollState = null;
};

/**
 * Keeps the newest row at the bottom while a request for it holds: after every commit, the room's
 * virtual list scrolls to its last row (to its top when its newest row is first), and an open
 * thread to the end of its scroll area. A pin
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
  const virtualizerRef = useLatestRef(virtualizer);
  // The reader's gesture takes the position over: the virtual list stops scrolling to the row it
  // was last sent to. A thread's gestures have their own rule for the pins (useGestureBottomPins'
  // onThreadGesture).
  const onGesture = useCallback(() => {
    endVirtualListScroll(virtualizerRef.current);
    if (surfaceRef.current === 'room') onReaderGesture();
  }, [onReaderGesture, surfaceRef, virtualizerRef]);
  const latestRowRequestRef = useLatestRowRequest({ ...request, onReaderGesture: onGesture });
  // A thread's request starts with the reader's own scrolling: what was asked before belongs to
  // the pin the thread opened with.
  const surfaceAtLastCommitRef = useRef(surface);
  useLayoutEffect(() => {
    if (surfaceAtLastCommitRef.current === surface) return;
    surfaceAtLastCommitRef.current = surface;
    if (surface === 'thread') latestRowRequestRef.current = false;
  });
  const { scrollElement, latestAtTop } = request;
  useLayoutEffect(() => {
    if (!surface || !latestRowRequestRef.current || itemCount === 0) return;
    if (surface === 'room' && latestAtTop) scrollElement?.scrollTo({ top: 0 });
    else if (surface === 'room') virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
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

/** How many frames a far jump goes on aligning its row while the rows around it mount and measure. */
const FAR_JUMP_MAX_FRAMES = 45;
/** How many frames in a row the target must keep its place before a far jump is done. */
const FAR_JUMP_SETTLED_FRAMES = 3;

/** How many frames a smooth scroll to a row may run before the row is checked anyway. */
const SMOOTH_JUMP_MAX_FRAMES = 90;

/** Whether the start of a mounted row is inside the visible band. */
const rowStartInView = (row: HTMLElement, scrollElement: HTMLElement): boolean => {
  const band = scrollElement.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  return box.top >= band.top && box.top < band.bottom;
};

/** Whether a mounted row sits within one view height of the visible band. */
const rowNearView = (row: HTMLElement, scrollElement: HTMLElement): boolean => {
  const band = scrollElement.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  return box.bottom > band.top - band.height && box.top < band.bottom + band.height;
};

type RoomRowLookup = {
  getScrollElement: () => HTMLElement | null;
  /** The mounted element of a room row, by its index in the room's rows. */
  getRowElement: (index: number) => HTMLElement | undefined;
  /** The room's rows, so a far jump follows its event when rows load above it. */
  roomRowsRef: MutableRefObject<{ getId: () => string | undefined }[]>;
};

/**
 * Jumps to a row. The paginator scrolls to mounted rows near the view and moves the window; the
 * virtual list scrolls to the rows of the window it has not mounted. A row far from the view is
 * reached without animation: its heights are estimates until it mounts, so a smooth scroll stops
 * short. The view goes to where the virtual list places the row, so that it mounts, and then,
 * frame by frame, the row is aligned again where the jump asked (its alignment and offset) as it
 * and its neighbours mount and measure, until it keeps its place, the reader scrolls, or another
 * jump starts. Not through the list's `scrollToIndex`: for 5 s it scrolls back to its own place
 * for the row whenever a measurement moves it, a place without the offset ledger's shift, and so
 * undid the alignment once it was done. A thread's rows are all in the list.
 * `onJump` runs before each jump, so the offset ledger knows the move is the timeline's own.
 */
export const useTimelineRowJumps = ({
  paginatorScrollToItem,
  paginatorScrollToElement,
  activeRangeRef,
  virtualizerRef,
  threadEventIndexMapRef,
  onJump,
  rows,
}: {
  paginatorScrollToItem: ScrollToItem;
  paginatorScrollToElement: ScrollToElement;
  activeRangeRef: MutableRefObject<ItemRange>;
  virtualizerRef: MutableRefObject<
    Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex' | 'getOffsetForIndex'>
  >;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  onJump: () => void;
  rows: RoomRowLookup;
}) => {
  const jumpCountRef = useRef(0);
  const rowsRef = useLatestRef(rows);
  const scrollToElement = useCallback<ScrollToElement>(
    (element, opts) => {
      onJump();
      return paginatorScrollToElement(element, opts);
    },
    [onJump, paginatorScrollToElement]
  );

  /**
   * Brings the row of `eventId` from far away into its aligned place; see above. After a smooth
   * scroll it first waits for the scrolling to stop and checks that the row's start is in view:
   * a smooth scroll can stop short (WebKit on macOS cuts it off when rows measure), and only
   * then is the row aligned frame by frame.
   */
  const followFarRow = useCallback(
    (
      eventId: string | undefined,
      firstIndex: number,
      align: 'start' | 'center' | 'end',
      afterSmoothScroll = false,
      offset?: number
    ) => {
      const { getScrollElement, getRowElement, roomRowsRef } = rowsRef.current;
      const scrollElement = getScrollElement();
      if (!scrollElement) return;
      jumpCountRef.current += 1;
      const thisJump = jumpCountRef.current;
      let readerTookOver = false;
      const onReader = () => {
        readerTookOver = true;
      };
      READER_INTENT_EVENTS.forEach((name) =>
        scrollElement.addEventListener(name, onReader, { passive: true })
      );
      const end = () =>
        READER_INTENT_EVENTS.forEach((name) => scrollElement.removeEventListener(name, onReader));
      let frame = 0;
      let settledFrames = 0;
      let lastTop: number | undefined;
      let smoothFrames = afterSmoothScroll ? 0 : SMOOTH_JUMP_MAX_FRAMES;
      let stillFrames = 0;
      let lastScrollTop = scrollElement.scrollTop;
      const step = () => {
        if (readerTookOver || thisJump !== jumpCountRef.current || frame >= FAR_JUMP_MAX_FRAMES) {
          end();
          return;
        }
        const found = eventId
          ? roomRowsRef.current.findIndex((row) => row.getId() === eventId)
          : firstIndex;
        const index = found === -1 ? firstIndex : found;
        if (smoothFrames < SMOOTH_JUMP_MAX_FRAMES) {
          smoothFrames += 1;
          const scrollTop = scrollElement.scrollTop;
          stillFrames = Math.abs(scrollTop - lastScrollTop) < 1 ? stillFrames + 1 : 0;
          lastScrollTop = scrollTop;
          if (stillFrames < FAR_JUMP_SETTLED_FRAMES && smoothFrames < SMOOTH_JUMP_MAX_FRAMES) {
            requestAnimationFrame(step);
            return;
          }
          smoothFrames = SMOOTH_JUMP_MAX_FRAMES;
          const landed = getRowElement(index);
          if (landed && rowStartInView(landed, scrollElement)) {
            end();
            return;
          }
        }
        frame += 1;
        const { start, end: stop } = activeRangeRef.current;
        if (index >= start && index < stop) {
          const row = getRowElement(index);
          onJump();
          if (row) {
            paginatorScrollToElement(row, { align, offset, behavior: 'instant' });
            const top = row.getBoundingClientRect().top;
            settledFrames =
              lastTop !== undefined && Math.abs(top - lastTop) < 1 ? settledFrames + 1 : 0;
            lastTop = top;
            if (settledFrames >= FAR_JUMP_SETTLED_FRAMES) {
              end();
              return;
            }
          } else {
            const place = virtualizerRef.current.getOffsetForIndex(index - start, align);
            if (place) scrollElement.scrollTop = place[0];
          }
        }
        requestAnimationFrame(step);
      };
      if (afterSmoothScroll) requestAnimationFrame(step);
      else step();
    },
    [activeRangeRef, onJump, paginatorScrollToElement, rowsRef, virtualizerRef]
  );

  const scrollToItem = useCallback<ScrollToItem>(
    (index, opts) => {
      onJump();
      const { getScrollElement, getRowElement, roomRowsRef } = rowsRef.current;
      const scrollElement = getScrollElement();
      const mounted = getRowElement(index);
      const { start, end } = activeRangeRef.current;
      // Close by: the paginator's own scroll, smooth when asked; a row of the window it has not
      // mounted goes to the virtual list.
      if (!scrollElement || (mounted && rowNearView(mounted, scrollElement))) {
        if (paginatorScrollToItem(index, opts)) {
          if (scrollElement && opts?.behavior === 'smooth') {
            const eventId = roomRowsRef.current[index]?.getId();
            followFarRow(eventId, index, opts.align ?? 'center', true, opts.offset);
          }
          return true;
        }
        if (index < start || index >= end) return false;
        virtualizerRef.current.scrollToIndex(index - start, {
          align: opts?.align ?? 'center',
          behavior: opts?.behavior === 'smooth' ? 'smooth' : 'auto',
        });
        return true;
      }
      // Outside the window the paginator moves it there first; then the row is followed in.
      if ((index < start || index >= end) && !paginatorScrollToItem(index, opts)) return false;
      const eventId = roomRowsRef.current[index]?.getId();
      followFarRow(eventId, index, opts?.align ?? 'center', false, opts?.offset);
      return true;
    },
    [activeRangeRef, followFarRow, onJump, paginatorScrollToItem, rowsRef, virtualizerRef]
  );
  const scrollThreadEventIntoView = useCallback(
    (targetEventId: string) => {
      const index = threadEventIndexMapRef.current.get(targetEventId);
      if (index === undefined) return false;
      onJump();
      virtualizerRef.current.scrollToIndex(index, { align: 'center' });
      return true;
    },
    [onJump, threadEventIndexMapRef, virtualizerRef]
  );
  return { scrollToElement, scrollToItem, scrollThreadEventIntoView };
};

/**
 * Whether the render asks for the newest row anew: a bottom pin (Jump to Latest, a send) came after
 * the last commit. The rows of that render are the newest ones, which the reader asked to see, so
 * the place recorded in the rows before them holds nothing.
 */
export const useLatestPinAsked = (scrollToBottomRef: MutableRefObject<ScrollToBottomState>) => {
  const committedCountRef = useRef(scrollToBottomRef.current.count);
  useLayoutEffect(() => {
    committedCountRef.current = scrollToBottomRef.current.count;
  });
  return scrollToBottomRef.current.count !== committedCountRef.current;
};

/**
 * Counts the times the room's rows were replaced rather than added to: emptied for an event the
 * room has not loaded, then the history around it, or the newest rows again. A page of history or
 * a live row joins the chain on screen and replaces nothing. Counted during render, so the render
 * that shows new rows has the new count and the offset ledger starts over in it, before a fold or
 * a settle watch of the old rows can move the new ones.
 */
export const useRowsGeneration = (linkedTimelines: EventTimeline[]): number => {
  const seenRef = useRef({ chain: linkedTimelines, generation: 0 });
  const seen = seenRef.current;
  if (seen.chain !== linkedTimelines) {
    const replaced = !linkedTimelines.some((part) => seen.chain.includes(part));
    seenRef.current = { chain: linkedTimelines, generation: seen.generation + (replaced ? 1 : 0) };
  }
  return seenRef.current.generation;
};
