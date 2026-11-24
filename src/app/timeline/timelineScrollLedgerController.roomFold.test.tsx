// @vitest-environment jsdom
import { act, Suspense, startTransition, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MatrixEvent } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import {
  planMembershipFolds,
  projectRoomRows,
  viewMembershipFolds,
  type MembershipFoldView,
  type RenderedRoomRows,
} from './membershipFolds';
import { exposedFoldRowsPxOfRender } from './useMembershipFolds';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: () => {},
  shouldAdjustScrollPositionOnItemSizeChange: undefined,
  getVirtualItems: () => [],
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

it('keeps a room fold pending through a render that still shows the window it was priced for', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = { scrollTop: 0, addEventListener() {}, removeEventListener() {} };
  const pendingRoomFoldPxRef = { current: 0 };
  let readRowFoldPx = () => 0;
  function Harness({ held }: { held: boolean }) {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement as unknown as HTMLDivElement,
      itemCount: 13,
      pendingRoomFoldPxRef,
      roomFoldHeld: held,
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return <div ref={controller.virtualInnerRef} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const marginTop = () => (container.firstElementChild as HTMLDivElement | null)?.style.marginTop;
  flushSync(() => root.render(<Harness held={false} />));

  // The paginator widened the window over 130 older rows and priced them; a scroll renders the
  // list before the widened window's update, with the window the fold was priced for.
  pendingRoomFoldPxRef.current = 13_000;
  flushSync(() => root.render(<Harness held />));
  expect(marginTop()).toBe('');
  expect(pendingRoomFoldPxRef.current).toBe(13_000);

  // The render that mounts the rows takes the fold, once. The rows brought their own height: the
  // list will not end that much higher (`listShrinkNotRendered`), or the end clamp would throw a
  // reader at the newest row to the top.
  flushSync(() => root.render(<Harness held={false} />));
  expect(marginTop()).toBe('-13000px');
  expect(pendingRoomFoldPxRef.current).toBe(0);
  expect(readRowFoldPx()).toBe(13_000);
  flushSync(() => root.render(<Harness held={false} />));
  expect(marginTop()).toBe('-13000px');
  flushSync(() => root.unmount());
});

// The room timeline's wiring for a closed fold of membership events that comes apart above the
// reader's view: each render prices the rows that came out of it (`exposedFoldRowsPxOfRender`)
// against the list as it last committed, and hands the ledger that height.
const roomEvent = (id: string, type: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: `@${id.slice(1)}:example.org`,
    state_key: type === 'm.room.member' ? `@${id.slice(1)}:example.org` : undefined,
    type,
    origin_server_ts: new Date(2026, 10, 3, 12, 0).getTime(),
    content,
  });
const loaded = [
  ...['$m1', '$m2', '$m3', '$m4'].map((id) =>
    roomEvent(id, 'm.room.member', { membership: 'join' })
  ),
  ...['$msg0', '$msg1', '$msg2'].map((id) =>
    roomEvent(id, 'm.room.message', { body: id, msgtype: 'm.text' })
  ),
];
const closedFold = viewMembershipFolds(
  planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds: new Set() }),
  () => false
);
// The run is too short to fold (as when it lost events): its four events are rows, 30 px each.
const foldApart = viewMembershipFolds([], () => false);
const EXPOSED_PX = 4 * 30 - 42;
const NEVER = new Promise<never>(() => {});
function Suspended(): null {
  throw NEVER;
}

const mountFoldedRoom = () => {
  const scrollElement = { scrollTop: 0, addEventListener() {}, removeEventListener() {} };
  const pendingRoomFoldPxRef = { current: 0 };
  // The last commit: the closed fold's break, 42 px high, above the three messages in view.
  const renderedRef: { current: RenderedRoomRows } = {
    current: {
      sizes: new Map([['$m1', 42]]),
      view: closedFold,
      rows: [],
      list: { itemSizeCache: new Map() },
      place: { foldEnds: new Map([['$m1', 42]]), readerTop: () => 42 },
    },
  };
  const exposedPxOfRenders: number[] = [];
  let readRowFoldPx = () => 0;
  function FoldedRoom({
    view,
    held = false,
    suspend = false,
  }: {
    view: MembershipFoldView;
    held?: boolean;
    suspend?: boolean;
  }) {
    const rows = projectRoomRows(
      loaded,
      loaded.map((event, absoluteIndex) => ({ event, absoluteIndex })),
      view
    );
    const exposedRoomRowsPx = exposedFoldRowsPxOfRender(
      renderedRef.current,
      { view, foldedRows: rows.foldedRows, windowRows: rows.rows, pinnedIds: new Set() },
      () => 30
    );
    exposedPxOfRenders.push(exposedRoomRowsPx);
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 30,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement as unknown as HTMLDivElement,
      itemCount: rows.rows.length,
      pendingRoomFoldPxRef,
      exposedRoomRowsPx,
      roomFoldHeld: held,
      roomFoldPriceRef: useRef(() => 30),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    // The timeline reads the list after each commit.
    useLayoutEffect(() => {
      renderedRef.current = { ...renderedRef.current, view, rows: rows.rows };
    });
    return <div ref={controller.virtualInnerRef}>{suspend && <Suspended />}</div>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const room = (props: Parameters<typeof FoldedRoom>[0]) => (
    <Suspense fallback={null}>
      <FoldedRoom {...props} />
    </Suspense>
  );
  act(() => root.render(room({ view: closedFold })));
  return {
    pendingRoomFoldPxRef,
    exposedPxOfRenders,
    readRowFoldPx: () => readRowFoldPx(),
    marginTop: () => (container.firstElementChild as HTMLDivElement | null)?.style.marginTop,
    render: (props: Parameters<typeof FoldedRoom>[0]) => act(() => root.render(room(props))),
    /** A render React starts and does not commit: it waits for what suspended. */
    renderWithoutCommit: (props: Parameters<typeof FoldedRoom>[0]) =>
      act(() => startTransition(() => root.render(room({ ...props, suspend: true })))),
    unmount: () => act(() => root.unmount()),
  };
};

it('folds the rows a render lists above the reader when that render commits, once', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const room = mountFoldedRoom();
  expect(room.marginTop()).toBe('');

  room.render({ view: foldApart });
  expect(room.marginTop()).toBe(`${-EXPOSED_PX}px`);
  expect(room.pendingRoomFoldPxRef.current).toBe(0);
  // The rows brought their own height, as a page's rows do.
  expect(room.readRowFoldPx()).toBe(EXPOSED_PX);
  room.render({ view: foldApart });
  expect(room.marginTop()).toBe(`${-EXPOSED_PX}px`);
  expect(room.pendingRoomFoldPxRef.current).toBe(0);
  room.unmount();
});

it('takes nothing from a render of those rows that React does not commit', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const room = mountFoldedRoom();
  room.renderWithoutCommit({ view: foldApart });
  // The render ran and priced the rows, and left nothing behind.
  expect(room.exposedPxOfRenders).toContain(EXPOSED_PX);
  expect(room.pendingRoomFoldPxRef.current).toBe(0);
  expect(room.marginTop()).toBe('');

  // The next commit still shows the closed fold: no row came out of it.
  room.render({ view: closedFold });
  expect(room.pendingRoomFoldPxRef.current).toBe(0);
  expect(room.marginTop()).toBe('');
  expect(room.readRowFoldPx()).toBe(0);

  // The render that does commit the rows takes their height.
  room.render({ view: foldApart });
  expect(room.marginTop()).toBe(`${-EXPOSED_PX}px`);
  expect(room.pendingRoomFoldPxRef.current).toBe(0);
  room.unmount();
});

it('leaves those rows pending in a render that holds the room fold', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const room = mountFoldedRoom();
  room.render({ view: foldApart, held: true });
  expect(room.marginTop()).toBe('');
  expect(room.pendingRoomFoldPxRef.current).toBe(EXPOSED_PX);
  // Held again, the list has rendered the rows: they are not priced twice.
  room.render({ view: foldApart, held: true });
  expect(room.pendingRoomFoldPxRef.current).toBe(EXPOSED_PX);
  room.render({ view: foldApart });
  expect(room.marginTop()).toBe(`${-EXPOSED_PX}px`);
  expect(room.pendingRoomFoldPxRef.current).toBe(0);
  room.unmount();
});
