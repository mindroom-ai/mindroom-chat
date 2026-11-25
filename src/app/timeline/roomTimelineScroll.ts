import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { ItemRange, ScrollToElement, ScrollToItem } from './useVirtualPaginator';
import type { ScrollToBottomState } from './roomFocusScrollController';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import { useViewScopedFlag, type ViewScopedFlag } from './roomTimelineViewScope';
import {
  isScrollNearBottom,
  TIMELINE_BOTTOM_THRESHOLD_PX,
} from '../event-store/timeline/timelineScrollUtils';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { scrollToBottom } from '../lib/dom';
import { stopIOSFlick } from '../lib/iosFlickStop';
import { clearVirtualizerHoldOffset } from './timelineScrollLedgerController';
import { readScrollPadding } from '../ui/styles/threadHeaderInset';

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
 * Whether the latest-end anchor (the mark at the rows' latest end) is within `reach` (by default
 * the follow threshold) of the scroll area, so the reader counts as at the latest end: at most
 * that far below its lower edge or, with the newest row first, above its upper edge. Without a
 * scroll area, the window's.
 */
export const isLatestAnchorInReach = (
  anchor: Element,
  scrollArea: Element | null | undefined,
  latestAtTop: boolean,
  reach = TIMELINE_BOTTOM_THRESHOLD_PX
): boolean => {
  const anchorRect = anchor.getBoundingClientRect();
  const areaRect = scrollArea?.getBoundingClientRect();
  if (latestAtTop) return anchorRect.bottom >= (areaRect?.top ?? 0) - reach;
  const lowerEdge = areaRect?.bottom ?? window.innerHeight;
  return anchorRect.top <= lowerEdge + reach;
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
 * Asks iOS to stop a touch flick before the reader's own Jump to Latest writes: the button is
 * outside the scroll area, so its tap does not end the flick, and a write inside a scroll the
 * compositor still owns can be discarded. The area takes
 * `overflow-y: hidden` for the write and gets its own value back two frames later, so one frame
 * renders it hidden. iOS only; the timeline's own pins never call it.
 */
export const useFlickStop = (getScrollElement: () => HTMLElement | null): (() => void) => {
  const restoreRef = useRef<(() => void) | undefined>(undefined);
  const restore = useCallback(() => {
    const pendingRestore = restoreRef.current;
    if (!pendingRestore) return;
    restoreRef.current = undefined;
    pendingRestore();
  }, []);
  // Leaving the view gives the area its overflow back at once.
  useEffect(() => restore, [restore]);
  return useCallback(() => {
    restore();
    restoreRef.current = stopIOSFlick(getScrollElement());
  }, [getScrollElement, restore]);
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
  onThreadTakeover,
}: {
  backController?: ThreadBackPaginationController;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  /** Whether the reader has scrolled the view shown now. */
  readerScrolledRef: MutableRefObject<ViewScopedFlag>;
  /** Runs once per view, at the reader's first gesture. */
  onFirstGesture: () => void;
  /** Cancels any active programmatic scroll when the reader gestures in a thread. */
  onThreadTakeover?: () => void;
}) => {
  // The request count when the reader last touched, scrolled or pressed a key.
  const countAtGestureRef = useRef<number | undefined>(undefined);
  const onThreadTakeoverRef = useLatestRef(onThreadTakeover);
  const onThreadGesture = useCallback(() => {
    onThreadTakeoverRef.current?.();
    const { count } = scrollToBottomRef.current;
    backController?.cancelOpenBottomPin(count);
    countAtGestureRef.current = count;
    if (readerScrolledRef.current.value) return;
    readerScrolledRef.current.value = true;
    onFirstGesture();
  }, [backController, onFirstGesture, onThreadTakeoverRef, readerScrolledRef, scrollToBottomRef]);
  /** The room rows' gestures (`useTimelineLiveEnd`), which have no opening pin to end. */
  const onRoomGesture = useCallback(() => {
    countAtGestureRef.current = scrollToBottomRef.current.count;
    if (readerScrolledRef.current.value) return;
    readerScrolledRef.current.value = true;
    onFirstGesture();
  }, [onFirstGesture, readerScrolledRef, scrollToBottomRef]);
  const shouldApplyBottomPin = useCallback(
    (count: number) =>
      count !== countAtGestureRef.current && (backController?.shouldApplyBottomPin(count) ?? true),
    [backController]
  );
  return { onThreadGesture, onRoomGesture, shouldApplyBottomPin };
};

/**
 * Whether the open thread opened at its newest row, where its opening pin then holds it until the
 * reader scrolls (`useRoomFocusScrollController`), and whether that open is still pending
 * (`startOpen` names the view the session opens). A render that shows the open pending counts,
 * and so does the open's own request for the newest row (`pinnedAtLatest`): a switch to a thread
 * the client holds can end its open before any render shows it pending, and the newest rows that
 * measure taller after its pin then stayed below the view until the next pin request. The render
 * that switches views starts over.
 */
export const useThreadOpenedAtLatest = (viewKey: string, latestPending: boolean) => {
  const viewKeyRef = useLatestRef(viewKey);
  const openedViewKeyRef = useRef<string>(undefined);
  const openedAtLatestRef = useViewScopedFlag(viewKey);
  const startOpen = useCallback(() => {
    openedViewKeyRef.current = viewKeyRef.current;
  }, [viewKeyRef]);
  const pinnedAtLatest = useCallback(() => {
    openedAtLatestRef.current.value = true;
  }, [openedAtLatestRef]);
  const latestOpenPending = latestPending && openedViewKeyRef.current === viewKey;
  if (latestOpenPending) openedAtLatestRef.current.value = true;
  const openedAtLatest = openedAtLatestRef.current.value;
  return { latestOpenPending, openedAtLatest, startOpen, pinnedAtLatest };
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
 * short. The virtual list goes to its index, and then, frame by frame, the row is aligned again
 * where the jump asked (its alignment and offset) as it and its neighbours mount and measure, until
 * it keeps its place, the reader scrolls, or another jump starts. A thread's rows are all in the
 * list.
 * Each jump ends any scroll the virtual list still reconciles (`cancelScroll`) and clears any
 * held wheel/gesture offset (`clearVirtualizerHoldOffset`) so quiescence cannot shift the landed
 * position away from the target.
 */
export const useTimelineRowJumps = ({
  paginatorScrollToItem,
  paginatorScrollToElement,
  activeRangeRef,
  virtualizerRef,
  threadEventIndexMapRef,
  threadLeadingOffsetRef,
  roomLeadingOffsetRef,
  rows,
}: {
  paginatorScrollToItem: ScrollToItem;
  paginatorScrollToElement: ScrollToElement;
  activeRangeRef: MutableRefObject<ItemRange>;
  virtualizerRef: MutableRefObject<
    Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex' | 'cancelScroll'>
  >;
  threadEventIndexMapRef?: MutableRefObject<Map<string, number>>;
  threadLeadingOffsetRef?: MutableRefObject<number>;
  roomLeadingOffsetRef?: MutableRefObject<number>;
  rows: RoomRowLookup;
}) => {
  const jumpCountRef = useRef(0);
  const rowsRef = useLatestRef(rows);
  const jumped = useCallback(() => {
    const v = virtualizerRef.current;
    v.cancelScroll();
    clearVirtualizerHoldOffset(v);
  }, [virtualizerRef]);
  const scrollToElement = useCallback<ScrollToElement>(
    (element, opts) => {
      jumped();
      return paginatorScrollToElement(element, opts);
    },
    [jumped, paginatorScrollToElement]
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
          jumped();
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
            virtualizerRef.current.scrollToIndex(
              index - start + (roomLeadingOffsetRef?.current ?? 0),
              { align, behavior: 'auto' }
            );
          }
        }
        requestAnimationFrame(step);
      };
      if (afterSmoothScroll) requestAnimationFrame(step);
      else step();
    },
    [
      activeRangeRef,
      jumped,
      paginatorScrollToElement,
      roomLeadingOffsetRef,
      rowsRef,
      virtualizerRef,
    ]
  );

  const scrollToItem = useCallback<ScrollToItem>(
    (index, opts) => {
      jumped();
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
        virtualizerRef.current.scrollToIndex(index - start + (roomLeadingOffsetRef?.current ?? 0), {
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
    [
      activeRangeRef,
      followFarRow,
      jumped,
      paginatorScrollToItem,
      roomLeadingOffsetRef,
      rowsRef,
      virtualizerRef,
    ]
  );
  const scrollThreadEventIntoView = useCallback(
    (targetEventId: string) => {
      const index = threadEventIndexMapRef?.current.get(targetEventId);
      if (index === undefined) return false;
      jumped();
      virtualizerRef.current.scrollToIndex(index + (threadLeadingOffsetRef?.current ?? 0), {
        align: 'center',
      });
      return true;
    },
    [jumped, threadEventIndexMapRef, threadLeadingOffsetRef, virtualizerRef]
  );
  return { scrollToElement, scrollToItem, scrollThreadEventIntoView };
};

const atScrollBoundary = (scrollElement: HTMLElement, error: number): boolean => {
  const { scrollTop, scrollHeight, clientHeight } = scrollElement;
  if (typeof scrollTop !== 'number') return false;
  if (error < 0) return scrollTop <= 0;
  if (typeof scrollHeight !== 'number' || typeof clientHeight !== 'number') return false;
  return scrollTop >= scrollHeight - clientHeight;
};

/** Scrolls a mounted DOM element into its aligned place inside the scroll container. */
export const useElementScroll = (getScrollElement: () => HTMLElement | null): ScrollToElement => {
  const getScrollElementRef = useLatestRef(getScrollElement);
  const correctionFrameRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (correctionFrameRef.current !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(correctionFrameRef.current);
      }
      correctionFrameRef.current = undefined;
    },
    []
  );

  return useCallback<ScrollToElement>(
    (element, opts = {}) => {
      if (correctionFrameRef.current !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(correctionFrameRef.current);
      }
      correctionFrameRef.current = undefined;
      const scrollElement = getScrollElementRef.current();
      if (!scrollElement) return false;
      const { align = 'center', offset = 0, stopInView = false, behavior } = opts;
      const view = scrollElement.getBoundingClientRect();
      const padding = readScrollPadding(scrollElement);
      const viewTop = view.top + padding.top;
      const viewBottom = view.bottom - padding.bottom;

      const targetTop = (height: number): number => {
        const usableHeight = viewBottom - viewTop;
        // An element taller than the usable view shows its start.
        const effectiveAlign = height > usableHeight ? 'start' : align;
        if (effectiveAlign === 'end') return viewBottom - height + offset;
        if (effectiveAlign === 'center') return viewTop + (usableHeight - height) / 2 + offset;
        return viewTop + offset;
      };

      const rect = element.getBoundingClientRect();
      if (stopInView && rect.top >= viewTop && rect.bottom <= viewBottom) return false;

      const delta = rect.top - targetTop(rect.height);
      scrollElement.scrollBy({ top: delta, behavior });

      if (behavior !== 'smooth' && typeof requestAnimationFrame === 'function') {
        // Layout can still move the element during the scroll; correct once on the next frame.
        let ran = false;
        const frameId = requestAnimationFrame(() => {
          ran = true;
          correctionFrameRef.current = undefined;
          const corrected = element.getBoundingClientRect();
          const error = corrected.top - targetTop(corrected.height);
          if (Math.abs(error) < 1 || atScrollBoundary(scrollElement, error)) return;
          scrollElement.scrollBy({ top: error, behavior });
        });
        if (!ran) correctionFrameRef.current = frameId;
      }
      return true;
    },
    [getScrollElementRef]
  );
};

/** Thread jumps: scroll to a mounted row element or ask the virtualizer to mount an event by ID. */
export const useThreadRowJumps = ({
  getScrollElement,
  virtualizerRef,
  threadEventIndexMapRef,
  threadLeadingOffsetRef,
}: {
  getScrollElement: () => HTMLElement | null;
  virtualizerRef: MutableRefObject<
    Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex' | 'cancelScroll'>
  >;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadLeadingOffsetRef?: MutableRefObject<number>;
}) => {
  const baseScrollToElement = useElementScroll(getScrollElement);
  const jumped = useCallback(() => {
    const v = virtualizerRef.current;
    v.cancelScroll();
    clearVirtualizerHoldOffset(v);
  }, [virtualizerRef]);
  const scrollToElement = useCallback<ScrollToElement>(
    (element, opts) => {
      jumped();
      return baseScrollToElement(element, opts);
    },
    [baseScrollToElement, jumped]
  );
  const scrollThreadEventIntoView = useCallback(
    (targetEventId: string) => {
      const index = threadEventIndexMapRef.current.get(targetEventId);
      if (index === undefined) return false;
      jumped();
      virtualizerRef.current.scrollToIndex(index + (threadLeadingOffsetRef?.current ?? 0), {
        align: 'center',
      });
      return true;
    },
    [jumped, threadEventIndexMapRef, threadLeadingOffsetRef, virtualizerRef]
  );
  return { scrollToElement, scrollThreadEventIntoView };
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
