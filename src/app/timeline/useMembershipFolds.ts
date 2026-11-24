import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { isRowlessTimelineEvent } from '../event-store/timeline/timelineRowTypes';
import type { TimelineEventEntry } from '../event-store/timeline/roomTimelineEvents';
import type { TimelineRange } from '../event-store/timeline/timelinePagination';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { readTopInset } from '../ui/styles/threadHeaderInset';
import {
  EMPTY_MEMBERSHIP_FOLD_VIEW,
  exposedFoldRowsPx,
  foldFormedOverRows,
  loadedRangeOfRows,
  planMembershipFolds,
  projectRoomRows,
  rowRangeOfLoaded,
  viewMembershipFolds,
  type MembershipFold,
  type MembershipFoldView,
  type RenderedListPlace,
  type RenderedRoomRows,
  type RoomRowProjection,
} from './membershipFolds';

type UseMembershipFoldsOptions = {
  mx: MatrixClient;
  roomId: string;
  /** Only the room timeline folds consecutive membership events (`!threadId`). */
  enabled: boolean;
  /** The room's loaded rows, in display order, and their places in the loaded timeline. */
  events: MatrixEvent[];
  entries: TimelineEventEntry[];
  /** Rows already hidden before membership folding. */
  isSkipped: (event: MatrixEvent) => boolean;
  /** Event IDs that must remain visible (route or jump targets). */
  pinnedIds: ReadonlySet<string>;
};

/**
 * Folds consecutive room membership events over the full loaded timeline, keeping opened runs
 * anchored by event ID across history prepends and live appends, and lists the room's rows with
 * each closed fold as one row (`RoomRowProjection`).
 */
export const useMembershipFolds = ({
  mx,
  roomId,
  enabled,
  events,
  entries,
  isSkipped,
  pinnedIds,
}: UseMembershipFoldsOptions): {
  view: MembershipFoldView;
  rows: RoomRowProjection;
  toggle: (fold: MembershipFold) => void;
} => {
  // An event that decrypts in place brings no new rows. One that then draws nothing (a call
  // invite, an edit) no longer parts the membership events around it, wherever it is loaded.
  const [decryptions, setDecryptions] = useState(0);
  const isSkippedRef = useLatestRef(isSkipped);
  useEffect(() => {
    if (!enabled) return undefined;
    const onDecrypted = (event: MatrixEvent) => {
      if (event.getRoomId() !== roomId) return;
      if (isRowlessTimelineEvent(event) || isSkippedRef.current(event)) {
        setDecryptions((count) => count + 1);
      }
    };
    mx.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      mx.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [enabled, isSkippedRef, mx, roomId]);

  const folds = useMemo(() => {
    void decryptions;
    return enabled ? planMembershipFolds(events, { isSkipped, pinnedIds }) : [];
  }, [decryptions, enabled, events, isSkipped, pinnedIds]);

  const [openAnchorIds, setOpenAnchorIds] = useState<ReadonlySet<string>>(() => new Set());

  const view = useMemo(
    () => viewMembershipFolds(folds, (fold) => fold.eventIds.some((id) => openAnchorIds.has(id))),
    [folds, openAnchorIds]
  );

  const rows = useMemo(() => projectRoomRows(events, entries, view), [events, entries, view]);

  const toggle = useCallback((fold: MembershipFold) => {
    setOpenAnchorIds((anchors) => {
      const next = new Set(anchors);
      const isOpen = fold.eventIds.some((id) => next.has(id));
      // Every event of the run holds it open: it stays open when its first one leaves the rows.
      for (const id of fold.eventIds) {
        if (isOpen) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  return { view, rows, toggle };
};

const sameRange = (a: TimelineRange, b: TimelineRange): boolean =>
  a.start === b.start && a.end === b.end;

/**
 * The window in the room's rows (`rowRange`) for the window the timeline's state counts in loaded
 * rows, and the loaded rows that window stands for (`loadedRange`): the state's window, or wider
 * by the closed folds it starts or ends inside. The row window stays the same object while it
 * names the same rows, as the state's window does.
 */
export const useRoomRowWindow = (
  projection: RoomRowProjection,
  stateRange: TimelineRange
): { rowRange: TimelineRange; loadedRange: TimelineRange } => {
  const mapped = useMemo(() => rowRangeOfLoaded(projection, stateRange), [projection, stateRange]);
  const rowRangeRef = useRef(mapped);
  if (!projection.loadedStarts || !sameRange(rowRangeRef.current, mapped)) {
    rowRangeRef.current = mapped;
  }
  const rowRange = rowRangeRef.current;
  const loadedRange = useMemo(() => {
    const loaded = loadedRangeOfRows(projection, rowRange);
    return sameRange(loaded, stateRange) ? stateRange : loaded;
  }, [projection, rowRange, stateRange]);
  return { rowRange, loadedRange };
};

export const NO_RENDERED_ROOM_ROWS: RenderedRoomRows = {
  sizes: new Map(),
  view: EMPTY_MEMBERSHIP_FOLD_VIEW,
};

type RoomList = Virtualizer<HTMLDivElement, Element>;
type RowSizeSource = Pick<
  RoomList,
  'elementsCache' | 'itemSizeCache' | 'measurementsCache' | 'measureElement' | 'scrollElement'
> & { options: Pick<RoomList['options'], 'measureElement'> };

/**
 * How far down the list the reader's view starts (`RenderedListPlace`), as the list is painted
 * now: the first row's top is the top of `inner`, the element that holds the rows, whatever leads
 * it in the scroll area and wherever the offset ledger has it, and the view starts below the bars
 * over the scroll area.
 */
export const readReaderTop = (
  scrollElement: Element | null | undefined,
  inner: Element | null
): number | undefined =>
  scrollElement && inner?.isConnected
    ? scrollElement.getBoundingClientRect().top +
      readTopInset(scrollElement) -
      inner.getBoundingClientRect().top
    : undefined;

/**
 * The room's list as it rendered: the height it gives each row of its window, and its folds.
 *
 * A closed fold the list has no measured height for starts at the height of the rows it took the
 * place of. A mounted one is measured here: its element can be the one that drew its first
 * event's row or another fold's break, which reports no new size when the break is as high. The
 * list notes a measured height only when it differs from the one the row had, so a fold as high
 * as the rows it replaced is noted here as measured.
 *
 * Each closed fold's row is noted with where it ends, for the day its rows come out of it above
 * the reader (`exposedFoldRowsPx`, which asks `readerTop` then).
 */
export const readRenderedRoomRows = (
  virtualizer: RowSizeSource,
  windowRows: readonly MatrixEvent[],
  view: MembershipFoldView,
  readerTop: RenderedListPlace['readerTop'] = () => undefined,
  leadingOffset = 0
): RenderedRoomRows => {
  const sizes = new Map<string, number>();
  const foldEnds = new Map<string, number>();
  const listStart = virtualizer.measurementsCache[0]?.start ?? 0;
  windowRows.forEach((event, index) => {
    const id = event.getId();
    if (!id) return;
    const itemIndex = index + leadingOffset;
    const end =
      view.breaks.get(id)?.open === false && virtualizer.measurementsCache[itemIndex]?.end;
    if (typeof end === 'number') foldEnds.set(id, end - listStart);
    let size = virtualizer.itemSizeCache.get(id);
    if (size === undefined) {
      size = virtualizer.measurementsCache[itemIndex]?.size;
      if (size === undefined) return;
      const element =
        view.breaks.get(id)?.open === false ? virtualizer.elementsCache.get(id) : undefined;
      if (element?.isConnected) {
        if (
          virtualizer.options.measureElement(element, undefined, virtualizer as RoomList) === size
        )
          virtualizer.itemSizeCache.set(id, size);
        // Another height: the list takes it as any row's new size, and holds the reader's rows.
        else virtualizer.measureElement(element);
        size = virtualizer.itemSizeCache.get(id) ?? size;
      }
    }
    sizes.set(id, size);
  });
  return { sizes, view, rows: windowRows, list: virtualizer, place: { foldEnds, readerTop } };
};

/**
 * A closed fold can form over rows the list holds while the list has a measured height for the
 * row of its first event: an event between two short runs decrypts into one that draws nothing,
 * and the runs are one fold at the first run's first row. The list would lay the fold out at the
 * height it measured for that row alone, and every row after it would move up by the height of
 * the rows that went into the fold. So before the list lays out its rows, it forgets that height:
 * the fold then starts at the height of the rows it holds (`heldFoldHeight`, the row estimate),
 * as a fold at a row the list never measured does, and takes its own height once it mounts.
 */
export const forgetFormedFoldHeights = (rendered: RenderedRoomRows, view: MembershipFoldView) => {
  const measured = rendered.list?.itemSizeCache;
  if (!measured || rendered.view === view || rendered.sizes.size === 0) return;
  view.breaks.forEach((state, key) => {
    if (measured.has(key) && foldFormedOverRows(rendered, state)) measured.delete(key);
  });
};

/**
 * A closed fold above the reader's view can come apart into rows of its own: the run it holds
 * joins an open run when the event between them decrypts into one without a row, and the joined
 * run stays open. Those rows would push the reader's rows down by their height
 * (`exposedFoldRowsPx`), which the offset ledger takes instead, as it takes the height of the rows
 * a page of history mounts above the reader. This is that height for a render of `now.view`,
 * until the list has rendered those folds. It is the render's own (the ledger's
 * `exposedRoomRowsPx`): nothing is kept of a render that React does not commit.
 */
export const exposedFoldRowsPxOfRender = (
  rendered: RenderedRoomRows,
  now: Parameters<typeof exposedFoldRowsPx>[1],
  /** As the list prices the row at a place of `now.windowRows` that it has no measured height for. */
  estimateSize: (index: number) => number
): number => {
  if (rendered.view === now.view) return 0;
  const measured = rendered.list?.itemSizeCache;
  return exposedFoldRowsPx(rendered, now, (id, index) => measured?.get(id) ?? estimateSize(index));
};

/**
 * A closed fold can take the place of rows the list already holds: a page of history brings
 * earlier events of the run the loaded rows start with, so its fold starts at another event, or
 * makes a fold of rows that stood alone, and an event that decrypts into one without a row joins
 * the runs around it. Such a fold starts at the height of the rows it holds (`heldFoldHeight`,
 * which the row estimate reads from `renderedRef`), so no row moves when it takes their place,
 * and its own height then reaches the list as any row's new size does. The list is read after
 * each commit that shows the room's rows (`windowRows`); in an open thread it lists the thread's.
 * `innerRef` is the element that holds the rows (`readReaderTop`).
 */
export const useMembershipFoldRowSizes = (
  virtualizer: RowSizeSource,
  windowRows: readonly MatrixEvent[] | undefined,
  view: MembershipFoldView,
  renderedRef: MutableRefObject<RenderedRoomRows>,
  innerRef: RefObject<Element | null>,
  leadingOffset = 0
) => {
  useLayoutEffect(() => {
    renderedRef.current = windowRows
      ? readRenderedRoomRows(
          virtualizer,
          windowRows,
          view,
          () => readReaderTop(virtualizer.scrollElement, innerRef.current),
          leadingOffset
        )
      : NO_RENDERED_ROOM_ROWS;
  });
};
