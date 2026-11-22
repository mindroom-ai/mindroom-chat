// @vitest-environment jsdom
import { Virtualizer } from '@tanstack/react-virtual';
import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { buildMeasurementScrollCorrectionHook } from '../event-store/threads/threadRenderUtils';
import type { TimelineRange } from '../event-store/timeline/timelinePagination';
import {
  planMembershipFolds,
  projectRoomRows,
  rowRangeOfLoaded,
  viewMembershipFolds,
  type FoldedRowSizes,
  type MembershipFoldView,
  type RoomRowProjection,
} from './membershipFolds';
import { timelineRowSizing } from './roomTimelineRows';
import { readMembershipRowSizes } from './useMembershipFolds';

// The room's virtual list with folded membership runs, against the real virtual-core, its
// overscan of ten rows and the timeline's own measurement correction: what the list mounts, and
// where the reader's rows are on screen as history pages land around a fold.

const VIEW_PX = 600;
const MESSAGE_PX = 50;
const MEMBER_PX = 30;
const BREAK_PX = 42;
const START_TS = new Date(2026, 10, 3, 12, 0).getTime();

const message = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: START_TS,
    content: { body: id, msgtype: 'm.text' },
  });

const join = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: `@${id.slice(1)}:example.org`,
    state_key: `@${id.slice(1)}:example.org`,
    type: 'm.room.member',
    origin_server_ts: START_TS,
    content: { membership: 'join', displayname: id.slice(1) },
  });

const messages = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => message(`$${prefix}${index}`));
const joins = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => join(`$${prefix}${index}`));

/**
 * The room's list as the timeline renders it. `render` lists the loaded rows with each closed
 * fold as one row, takes the state's window in those rows and hands the list its sizes and keys;
 * `commit` mounts the list's rows, which measure, and reads the membership rows' heights, as the
 * timeline does after each commit.
 */
const roomList = (initial: { loaded: MatrixEvent[]; stateRange: TimelineRange }) => {
  let { loaded, stateRange } = initial;
  const openIds = new Set<string>();
  /** A fold's break as it measures: taller once its label wraps. */
  let breakPx = BREAK_PX;
  const element = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 100_000,
    clientHeight: VIEW_PX,
    offsetHeight: VIEW_PX,
  };
  let reportOffset: (offset: number, isScrolling: boolean) => void = () => {};
  const scrollWrites: number[] = [];
  const roomRowsRef = { current: [] as MatrixEvent[] };
  const activeRangeRef = { current: { start: 0, end: 0 } };
  const membershipFoldsRef: { current: MembershipFoldView } = { current: { breaks: new Map() } };
  const foldedRowSizesRef: { current: FoldedRowSizes } = { current: new Map() };
  let projection: RoomRowProjection;
  let windowRows: MatrixEvent[] = [];

  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: 0,
    overscan: 10,
    estimateSize: () => 0,
    getScrollElement: () => element as unknown as HTMLDivElement,
    scrollToFn: (offset, options) => {
      element.scrollTop = offset + (options.adjustments ?? 0);
      scrollWrites.push(element.scrollTop);
      reportOffset(element.scrollTop, false);
    },
    observeElementRect: (_instance, onRect) => {
      onRect({ width: 400, height: VIEW_PX });
      return () => {};
    },
    observeElementOffset: (_instance, onOffset) => {
      reportOffset = onOffset;
      onOffset(element.scrollTop, false);
      return () => {};
    },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
    isIOSWebKitDevice: () => false,
    onDroppedCorrection: () => {
      throw new Error('a correction above the top of the list');
    },
  });

  const render = () => {
    const view = viewMembershipFolds(
      planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds: new Set() }),
      (fold) => fold.eventIds.some((id) => openIds.has(id))
    );
    projection = projectRoomRows(
      loaded,
      loaded.map((event, absoluteIndex) => ({ event, absoluteIndex })),
      view
    );
    const range = rowRangeOfLoaded(projection, stateRange);
    windowRows = projection.rows.slice(range.start, range.end);
    roomRowsRef.current = projection.rows;
    activeRangeRef.current = range;
    membershipFoldsRef.current = view;
    const { estimateSize, getItemKey } = timelineRowSizing({
      threadId: undefined,
      compactLayout: false,
      showThreadRepliesInRoom: false,
      threadEvents: [],
      roomWindowRows: windowRows,
      windowStart: range.start,
      roomRowsRef,
      activeRangeRef,
      threadRecordMapRef: { current: new Map() },
      membershipFoldsRef,
      foldedRowSizesRef,
    });
    virtualizer.setOptions({
      ...virtualizer.options,
      count: windowRows.length,
      estimateSize,
      getItemKey,
    });
    virtualizer._willUpdate();
    return virtualizer.getVirtualItems();
  };

  /** A row's height as its tile measures: a closed fold's is its break, an open one's adds it. */
  const tilePx = (event: MatrixEvent) => {
    const fold = membershipFoldsRef.current.breaks.get(event.getId() ?? '');
    if (fold?.open === false) return breakPx;
    const rowPx = event.getType() === 'm.room.member' ? MEMBER_PX : MESSAGE_PX;
    return fold ? rowPx + breakPx : rowPx;
  };

  const commit = () => {
    const mountedIds = new Set(render().map((item) => String(item.key)));
    virtualizer.elementsCache.clear();
    windowRows.forEach((event, index) => {
      const id = event.getId() ?? '';
      if (!mountedIds.has(id)) return;
      virtualizer.elementsCache.set(id, { isConnected: true } as Element);
      virtualizer.resizeItem(index, tilePx(event));
    });
    render();
    foldedRowSizesRef.current = readMembershipRowSizes(
      virtualizer,
      windowRows,
      membershipFoldsRef.current
    );
  };

  const indexOf = (id: string) => windowRows.findIndex((event) => event.getId() === id);

  return {
    virtualizer,
    scrollWrites,
    render,
    commit,
    windowIds: () => windowRows.map((event) => event.getId()),
    mountedIds: () => render().map((item) => String(item.key)),
    sizes: () =>
      render() && windowRows.map((_, index) => virtualizer.measurementsCache[index]?.size),
    isMeasured: (id: string) => virtualizer.itemSizeCache.has(id),
    /** Where the row of `id` is painted, from the top of the view. */
    screenTop: (id: string) => {
      render();
      const item = virtualizer.measurementsCache[indexOf(id)];
      if (!item) throw new Error(`${id} is no row of the window`);
      return item.start - element.scrollTop;
    },
    scrollTo: (scrollTop: number) => {
      element.scrollTop = scrollTop;
      reportOffset(scrollTop, false);
    },
    scrollToRow: (id: string, offset = 0) => {
      render();
      const item = virtualizer.measurementsCache[indexOf(id)];
      if (!item) throw new Error(`${id} is no row of the window`);
      element.scrollTop = item.start + offset;
      reportOffset(element.scrollTop, false);
    },
    /** A page of history: its rows before the loaded ones, the state's window on the same rows. */
    prependHistory: (older: MatrixEvent[]) => {
      loaded = [...older, ...loaded];
      stateRange = { start: stateRange.start + older.length, end: stateRange.end + older.length };
    },
    open: (id: string) => openIds.add(id),
    wrapBreak: (px: number) => {
      breakPx = px;
    },
  };
};

describe('a closed fold of many events in the virtual list', () => {
  // Twenty messages, a run of thirty-five joins and forty messages, all in the window.
  const loaded = [...messages('a', 20), ...joins('j', 35), ...messages('b', 40)];

  it('is one row of the list, with no row sized as nothing', () => {
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    list.commit();
    expect(list.windowIds()).toHaveLength(61);
    expect(list.windowIds().slice(19, 22)).toEqual(['$a19', '$j0', '$b0']);
    expect(list.sizes().every((size) => (size ?? 0) > 0)).toBe(true);
  });

  it('stays mounted while any of it shows, and for the ten rows of overscan after', () => {
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    // Measure the rows down to the reader's place, as scrolling there does.
    for (let step = 0; step < 6; step += 1) {
      list.commit();
      list.scrollTo(step * 400);
    }
    list.commit();
    // 20 px of the break still show under the top of the view.
    list.scrollToRow('$j0', BREAK_PX - 20);
    list.commit();
    expect(list.screenTop('$j0')).toBe(20 - BREAK_PX);
    expect(list.mountedIds()).toContain('$j0');
    // Scrolled out of view, it stays for the ten rows of overscan: thirty-four hidden rows after
    // it would have used those up while it still showed.
    list.scrollToRow('$b9', MESSAGE_PX - 1);
    list.commit();
    expect(list.mountedIds()).toContain('$j0');
    list.scrollToRow('$b10', MESSAGE_PX - 1);
    list.commit();
    expect(list.mountedIds()).not.toContain('$j0');
    expect(list.mountedIds()[0]).toBe('$b0');
  });
});

describe("the reader's rows as a page of history lands at a fold", () => {
  // The reader is forty rows down, the fold at the top of the loaded rows above the view.
  const below = messages('b', 60);
  const readingAt = '$b40';

  /** Measures the rows from the top down to the reader's place, and stops there. */
  const readDownTo = (list: ReturnType<typeof roomList>, id: string) => {
    for (let step = 0; step < 8; step += 1) {
      list.commit();
      list.scrollTo(step * 300);
    }
    list.commit();
    list.scrollToRow(id, 10);
    list.commit();
    list.scrollWrites.length = 0;
  };

  it("keeps them still when the page brings earlier events of a closed fold's run", () => {
    const loaded = [...joins('m', 3).map((_, index) => join(`$m${index + 3}`)), ...below];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    // The break wraps to two lines on a phone: taller than its estimate.
    list.wrapBreak(60);
    readDownTo(list, readingAt);
    expect(list.windowIds()[0]).toBe('$m3');
    expect(list.isMeasured('$m3')).toBe(true);
    const before = list.screenTop(readingAt);

    // The run now starts at `$m1`: the fold's row is another event's. The state's window starts
    // at `$m3`, inside the fold, which the window shows whole.
    list.prependHistory([join('$m1'), join('$m2')]);
    list.render();
    expect(list.windowIds()[0]).toBe('$m1');
    expect(list.windowIds()).toHaveLength(61);
    // It takes the place of the break it replaces, at its height: no row moves.
    expect(list.screenTop(readingAt)).toBe(before);
    list.commit();
    expect(list.screenTop(readingAt)).toBe(before);
    expect(list.scrollWrites).toEqual([]);

    // Mounted above the view, it measures the height it took over: nothing to correct.
    list.scrollToRow('$b6');
    const nearTop = list.screenTop('$b8');
    list.commit();
    expect(list.mountedIds()).toContain('$m1');
    expect(list.isMeasured('$m1')).toBe(true);
    expect(list.screenTop('$b8')).toBe(nearTop);
    expect(list.scrollWrites).toEqual([]);
    // A longer label wraps it to a third line: its new height reaches the list as any row's.
    list.wrapBreak(78);
    list.commit();
    expect(list.sizes()[0]).toBe(78);
    expect(list.screenTop('$b8')).toBe(nearTop);
  });

  it('keeps them still when the page makes a fold of rows that stood alone', () => {
    // Two joins are too few to fold: they are rows of their own, measured.
    const loaded = [join('$m4'), join('$m5'), ...below];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    readDownTo(list, readingAt);
    expect(list.windowIds().slice(0, 3)).toEqual(['$m4', '$m5', '$b0']);
    const before = list.screenTop(readingAt);

    list.prependHistory([message('$older'), join('$m3')]);
    list.render();
    // The window, on the same loaded rows, starts inside the new fold and shows it whole: one
    // row at the two rows' height.
    expect(list.windowIds().slice(0, 2)).toEqual(['$m3', '$b0']);
    expect(list.sizes()[0]).toBe(2 * MEMBER_PX);
    expect(list.screenTop(readingAt)).toBe(before);
    list.commit();
    expect(list.screenTop(readingAt)).toBe(before);
    expect(list.scrollWrites).toEqual([]);

    // Its break, shorter than the two rows, is measured once it mounts above the view: the
    // correction keeps the reader's rows where they are.
    list.scrollToRow('$b6');
    const nearTop = list.screenTop('$b8');
    list.commit();
    expect(list.mountedIds()).toContain('$m3');
    expect(list.sizes()[0]).toBe(BREAK_PX);
    expect(list.screenTop('$b8')).toBe(nearTop);
  });

  it("keeps them still when the page brings earlier events of an open fold's run", () => {
    const loaded = [join('$m3'), join('$m4'), join('$m5'), ...below];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    list.open('$m3');
    readDownTo(list, readingAt);
    expect(list.windowIds().slice(0, 4)).toEqual(['$m3', '$m4', '$m5', '$b0']);
    const before = list.screenTop(readingAt);

    // The fold stays open and its break goes to `$m1`, which the window does not hold yet: the
    // window keeps its rows, and no break crosses its edge.
    list.prependHistory([join('$m1'), join('$m2')]);
    list.render();
    expect(list.windowIds().slice(0, 4)).toEqual(['$m3', '$m4', '$m5', '$b0']);
    expect(list.screenTop(readingAt)).toBe(before);
    list.commit();
    expect(list.screenTop(readingAt)).toBe(before);

    // `$m3` gives up the break once it mounts again, above the view: an ordinary new size.
    list.scrollToRow('$b6');
    const nearTop = list.screenTop('$b8');
    list.commit();
    expect(list.mountedIds()).toContain('$m3');
    expect(list.sizes()[0]).toBe(MEMBER_PX);
    expect(list.screenTop('$b8')).toBe(nearTop);
  });

  it('keeps them still when the page lands above a closed fold it leaves alone', () => {
    const loaded = [message('$first'), ...joins('j', 30), ...below];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    readDownTo(list, readingAt);
    const windowBefore = list.windowIds();
    const before = list.screenTop(readingAt);
    list.prependHistory(messages('older', 20));
    list.commit();
    expect(list.windowIds()).toEqual(windowBefore);
    expect(list.screenTop(readingAt)).toBe(before);
    expect(list.scrollWrites).toEqual([]);
  });
});
