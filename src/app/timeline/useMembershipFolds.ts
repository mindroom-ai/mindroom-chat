import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { MatrixEventEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { isRowlessTimelineEvent } from '../event-store/timeline/timelineRowTypes';
import type { TimelineEventEntry } from '../event-store/timeline/roomTimelineEvents';
import type { TimelineRange } from '../event-store/timeline/timelinePagination';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import {
  isFoldableMembershipEvent,
  loadedRangeOfRows,
  planMembershipFolds,
  projectRoomRows,
  rowRangeOfLoaded,
  viewMembershipFolds,
  type FoldedRowSizes,
  type MembershipFold,
  type MembershipFoldView,
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
      if (isOpen) {
        for (const id of fold.eventIds) next.delete(id);
      } else {
        next.add(fold.key);
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

const NO_SIZES: FoldedRowSizes = new Map();

type RowSizeSource = Pick<
  Virtualizer<HTMLDivElement, Element>,
  'elementsCache' | 'itemSizeCache' | 'measurementsCache'
>;

/**
 * The height the list gives each membership row of the window it rendered. It also notes a
 * mounted closed fold's height as measured: the list notes a measured height only when it differs
 * from the one the row had, and a fold that took the place of another fold's break has that
 * break's height.
 */
export const readMembershipRowSizes = (
  virtualizer: RowSizeSource,
  windowRows: readonly MatrixEvent[],
  view: MembershipFoldView
): FoldedRowSizes => {
  let sizes: Map<string, number> | undefined;
  windowRows.forEach((event, index) => {
    if (!isFoldableMembershipEvent(event)) return;
    const id = event.getId();
    if (!id) return;
    let size = virtualizer.itemSizeCache.get(id);
    if (size === undefined) {
      size = virtualizer.measurementsCache[index]?.size;
      if (size === undefined) return;
      if (view.breaks.get(id)?.open === false && virtualizer.elementsCache.get(id)?.isConnected) {
        virtualizer.itemSizeCache.set(id, size);
      }
    }
    sizes ??= new Map();
    sizes.set(id, size);
  });
  return sizes ?? NO_SIZES;
};

/**
 * A closed fold can take the place of rows the list already holds: a page of history brings
 * earlier events of the run the loaded rows start with, so its fold starts at another event, or
 * makes a fold of rows that stood alone. Such a fold starts at the height of the rows it holds
 * (`heldFoldHeight`, which the row estimate reads from `sizesRef`), so no row moves when it takes
 * their place, and its own height then reaches the list as any row's new size does. The heights
 * are read after each commit.
 */
export const useMembershipFoldRowSizes = (
  virtualizer: RowSizeSource,
  windowRows: readonly MatrixEvent[],
  view: MembershipFoldView,
  sizesRef: MutableRefObject<FoldedRowSizes>
) => {
  useLayoutEffect(() => {
    sizesRef.current = readMembershipRowSizes(virtualizer, windowRows, view);
  });
};
