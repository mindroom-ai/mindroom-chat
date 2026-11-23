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
  type MembershipFoldView,
  type RenderedRoomRows,
  type RoomRowProjection,
} from './membershipFolds';
import { timelineRowSizing } from './roomTimelineRows';
import {
  NO_RENDERED_ROOM_ROWS,
  forgetFormedFoldHeights,
  readRenderedRoomRows,
  takeExposedFoldRowsPx,
} from './useMembershipFolds';

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

/** A message the client has no key for: a row that says so. */
const undecrypted = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.room.encrypted',
    origin_server_ts: START_TS,
    content: { algorithm: 'm.megolm.v1.aes-sha2' },
  });

/** What it was, once its key arrives: a call invite, which the timeline draws nothing for. */
const callInvite = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.call.invite',
    origin_server_ts: START_TS,
    content: { call_id: 'call', version: 1 },
  });

const messages = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => message(`$${prefix}${index}`));
const joins = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => join(`$${prefix}${index}`));

/**
 * The room's list as the timeline renders it. `render` lists the loaded rows with each closed
 * fold as one row, takes the state's window in those rows, has the list forget the height of a
 * row a fold formed at, and hands the list its sizes and keys; `commit` mounts the list's rows,
 * which measure, and reads the list as it rendered, as the timeline does after each commit. The
 * offset ledger is the scroll position here: the height it takes moves the reader with the rows.
 */
const roomList = (initial: {
  loaded: MatrixEvent[];
  stateRange: TimelineRange;
  compact?: boolean;
}) => {
  let { loaded, stateRange } = initial;
  const openIds = new Set<string>();
  const pinnedIds = new Set<string>();
  /** The height the ledger took for rows that came out of a closed fold above the view. */
  let ledgerPx = 0;
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
  const renderedRoomRowsRef: { current: RenderedRoomRows } = { current: NO_RENDERED_ROOM_ROWS };
  let projection: RoomRowProjection;
  let windowRows: MatrixEvent[] = [];
  // The folds are the same object from render to render until the loaded rows, an opened fold
  // or a pin changes, as the timeline memoizes them.
  let view: MembershipFoldView | undefined;
  const pricedRef: { current: MembershipFoldView } = { current: { breaks: new Map() } };

  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: 0,
    overscan: 10,
    estimateSize: () => 0,
    measureElement: (row) => tilePx(windowRows[Number(row.getAttribute('data-index'))]),
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
    view ??= viewMembershipFolds(
      planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds }),
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
    forgetFormedFoldHeights(renderedRoomRowsRef.current, view);
    const { estimateSize, getItemKey } = timelineRowSizing({
      threadId: undefined,
      compactLayout: !!initial.compact,
      showThreadRepliesInRoom: false,
      threadEvents: [],
      roomWindowRows: windowRows,
      windowStart: range.start,
      roomRowsRef,
      activeRangeRef,
      threadRecordMapRef: { current: new Map() },
      membershipFoldsRef,
      renderedRoomRowsRef,
    });
    const exposedPx = takeExposedFoldRowsPx(
      pricedRef,
      renderedRoomRowsRef.current,
      { view, foldedRows: projection.foldedRows, windowRows, pinnedIds },
      estimateSize
    );
    if (exposedPx !== 0) {
      ledgerPx += exposedPx;
      element.scrollTop += exposedPx;
      reportOffset(element.scrollTop, false);
    }
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
  function tilePx(event: MatrixEvent | undefined): number {
    if (!event) return 0;
    const fold = membershipFoldsRef.current.breaks.get(event.getId() ?? '');
    if (fold?.open === false) return breakPx;
    const rowPx = event.getType() === 'm.room.member' ? MEMBER_PX : MESSAGE_PX;
    return fold ? rowPx + breakPx : rowPx;
  }

  const commit = () => {
    const mountedIds = new Set(render().map((item) => String(item.key)));
    virtualizer.elementsCache.clear();
    windowRows.forEach((event, index) => {
      const id = event.getId() ?? '';
      if (!mountedIds.has(id)) return;
      const row = { isConnected: true, getAttribute: () => String(index) };
      virtualizer.elementsCache.set(id, row as unknown as Element);
      virtualizer.resizeItem(index, tilePx(event));
    });
    render();
    renderedRoomRowsRef.current = readRenderedRoomRows(
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
      view = undefined;
    },
    /** An event that decrypts in place: the same event of the loaded rows, as another type. */
    decrypt: (id: string, clear: MatrixEvent) => {
      loaded = loaded.map((event) => (event.getId() === id ? clear : event));
      view = undefined;
    },
    open: (id: string) => {
      openIds.add(id);
      view = undefined;
    },
    close: (id: string) => {
      openIds.delete(id);
      view = undefined;
    },
    /** A jump to the event: its run stays unfolded. */
    pin: (id: string) => {
      pinnedIds.add(id);
      view = undefined;
    },
    ledgerPx: () => ledgerPx,
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

  // An event between two runs decrypts, off screen, into one that draws nothing: the runs are one
  // run, folded at its first event, whose row the list has measured.
  it('keeps them still when a decrypted event joins two short runs into a fold', () => {
    const loaded = [
      join('$m1'),
      join('$m2'),
      undecrypted('$enc'),
      join('$m3'),
      join('$m4'),
      ...below,
    ];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    readDownTo(list, readingAt);
    expect(list.windowIds().slice(0, 6)).toEqual(['$m1', '$m2', '$enc', '$m3', '$m4', '$b0']);
    expect(list.sizes().slice(0, 5)).toEqual([
      MEMBER_PX,
      MEMBER_PX,
      MESSAGE_PX,
      MEMBER_PX,
      MEMBER_PX,
    ]);
    expect(list.isMeasured('$m1')).toBe(true);
    expect(list.mountedIds()).not.toContain('$m1');
    const before = list.screenTop(readingAt);
    expect(before).toBe(-10);

    list.decrypt('$enc', callInvite('$enc'));
    list.render();
    // Five rows are one. It takes their place at their height, not at the height the list
    // measured for `$m1` alone, which would move the reader's rows by 140 px.
    expect(list.windowIds().slice(0, 2)).toEqual(['$m1', '$b0']);
    expect(list.sizes()[0]).toBe(4 * MEMBER_PX + MESSAGE_PX);
    expect(list.screenTop(readingAt)).toBe(before);
    list.commit();
    expect(list.screenTop(readingAt)).toBe(before);
    expect(list.scrollWrites).toEqual([]);

    // Its break is measured once it mounts above the view: the correction keeps the reader's
    // rows where they are.
    list.scrollToRow('$b6');
    const nearTop = list.screenTop('$b8');
    list.commit();
    expect(list.mountedIds()).toContain('$m1');
    expect(list.sizes()[0]).toBe(BREAK_PX);
    expect(list.screenTop('$b8')).toBe(nearTop);
  });

  it('keeps them still when a decrypted event joins two closed folds into one', () => {
    const loaded = [...joins('j', 3), undecrypted('$enc'), ...joins('k', 3), ...below];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    readDownTo(list, readingAt);
    expect(list.windowIds().slice(0, 4)).toEqual(['$j0', '$enc', '$k0', '$b0']);
    expect(list.sizes().slice(0, 3)).toEqual([BREAK_PX, MESSAGE_PX, BREAK_PX]);
    const before = list.screenTop(readingAt);

    list.decrypt('$enc', callInvite('$enc'));
    list.render();
    // The first fold's row now holds both folds and the row between them.
    expect(list.windowIds().slice(0, 2)).toEqual(['$j0', '$b0']);
    expect(list.sizes()[0]).toBe(2 * BREAK_PX + MESSAGE_PX);
    expect(list.screenTop(readingAt)).toBe(before);
    list.commit();
    expect(list.screenTop(readingAt)).toBe(before);
    expect(list.scrollWrites).toEqual([]);
  });

  it('leaves a fold the reader closes at the height its row has, to measure itself', () => {
    const loaded = [...joins('j', 4), ...below];
    const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length } });
    list.open('$j0');
    list.commit();
    expect(list.sizes()[0]).toBe(MEMBER_PX + BREAK_PX);
    // On screen, its row measures as soon as it draws the break alone: it does not take the
    // height of the rows that close with it meanwhile.
    list.close('$j0');
    list.render();
    expect(list.windowIds().slice(0, 2)).toEqual(['$j0', '$b0']);
    expect(list.sizes()[0]).toBe(MEMBER_PX + BREAK_PX);
    list.commit();
    expect(list.sizes()[0]).toBe(BREAK_PX);
  });

  // An open run and a closed one with an undecrypted event between them: once it decrypts into an
  // event that draws nothing, they are one run, which stays open as the reader left its first
  // part. The closed run's events become rows above the reader.
  describe.each([
    ['comfortable', false],
    ['compact', true],
  ] as const)('with a closed fold that joins an open one, in the %s layout', (_layout, compact) => {
    const loaded = [...joins('j', 3), undecrypted('$enc'), ...joins('k', 18), ...below];
    const joined = [
      ...['$j0', '$j1', '$j2', '$enc'],
      ...Array.from({ length: 18 }, (_, index) => `$k${index}`),
      '$b0',
    ];
    const mount = () => {
      const list = roomList({ loaded, stateRange: { start: 0, end: loaded.length }, compact });
      list.open('$j0');
      readDownTo(list, readingAt);
      expect(list.windowIds().slice(0, 6)).toEqual(['$j0', '$j1', '$j2', '$enc', '$k0', '$b0']);
      expect(list.screenTop(readingAt)).toBe(-10);
      return list;
    };

    it("keeps them still: the ledger takes the height of the fold's rows", () => {
      const list = mount();
      list.decrypt('$enc', callInvite('$enc'));
      list.render();
      expect(list.windowIds().slice(0, joined.length)).toEqual(joined);
      // Seventeen rows the list has not measured are new above the reader: `$k0` keeps the
      // height its row had as the break until it mounts.
      const sizes = list.sizes();
      const exposedPx = sizes.slice(5, 22).reduce<number>((px, size) => px + (size ?? 0), 0);
      expect(sizes[4]).toBe(BREAK_PX);
      expect(exposedPx).toBe(17 * (compact ? 96 : 28.5));
      expect(list.ledgerPx()).toBe(exposedPx);
      expect(list.screenTop(readingAt)).toBe(-10);
      // Rendered again before it commits, the height is taken once.
      list.render();
      expect(list.ledgerPx()).toBe(exposedPx);
      list.commit();
      expect(list.screenTop(readingAt)).toBe(-10);
      expect(list.ledgerPx()).toBe(exposedPx);
      expect(list.scrollWrites).toEqual([]);

      // The rows measure once they mount above the view: the correction keeps the reader's rows
      // where they are.
      list.scrollToRow('$b6');
      const nearTop = list.screenTop('$b8');
      list.commit();
      expect(list.mountedIds()).toContain('$k17');
      expect(list.isMeasured('$k17')).toBe(true);
      expect(list.screenTop('$b8')).toBe(nearTop);
    });

    it('keeps them still when the closed fold comes first and the open one after it', () => {
      const mirrored = [...joins('k', 18), undecrypted('$enc'), ...joins('j', 3), ...below];
      const list = roomList({
        loaded: mirrored,
        stateRange: { start: 0, end: mirrored.length },
        compact,
      });
      list.open('$j0');
      readDownTo(list, readingAt);
      expect(list.windowIds().slice(0, 6)).toEqual(['$k0', '$enc', '$j0', '$j1', '$j2', '$b0']);
      expect(list.screenTop(readingAt)).toBe(-10);

      // The joined run is open, as its second part was, and its break is at `$k0`, the row
      // that drew the closed fold's break.
      list.decrypt('$enc', callInvite('$enc'));
      list.render();
      expect(list.windowIds().slice(0, 3)).toEqual(['$k0', '$k1', '$k2']);
      expect(list.ledgerPx()).toBe(17 * (compact ? 96 : 28.5));
      expect(list.screenTop(readingAt)).toBe(-10);
      list.commit();
      expect(list.screenTop(readingAt)).toBe(-10);
      expect(list.scrollWrites).toEqual([]);
    });

    it('takes nothing for a fold that a jump to one of its events unfolds', () => {
      const list = mount();
      // The jump scrolls to the event's row.
      list.pin('$k9');
      list.render();
      expect(list.windowIds().slice(4, 7)).toEqual(['$k0', '$k1', '$k2']);
      expect(list.ledgerPx()).toBe(0);
    });

    it('takes nothing for a fold the reader opens', () => {
      const list = mount();
      list.open('$k0');
      list.render();
      expect(list.windowIds().slice(4, 7)).toEqual(['$k0', '$k1', '$k2']);
      expect(list.ledgerPx()).toBe(0);
    });
  });
});
