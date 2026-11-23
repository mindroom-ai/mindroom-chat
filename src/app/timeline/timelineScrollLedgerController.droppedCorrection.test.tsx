// @vitest-environment jsdom
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { buildMeasurementScrollCorrectionHook } from '../event-store/threads/threadRenderUtils';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import { listShrinkNotRendered } from './useListEndClamp';

type CorrectionHook = ReturnType<typeof buildMeasurementScrollCorrectionHook>;

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItemForOffset: () => undefined,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

/**
 * The ledger after a row above the reader grew by 62 px while the reader scrolled up, so it took
 * the correction into its margin, and the end clamp's reading of the list once it rendered the
 * row's new height: the list ends at its newest row. The two renders after the drop show
 * `nextThreadId`: the first paints the margin, and the second moves a correction still waiting.
 */
const afterDroppedCorrection = (threadId: string | undefined, nextThreadId = threadId) => {
  const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = document.createElement('div');
  scrollElement.scrollTop = 400;
  // The list is scrolled 400 px up out of the scroller, whose top is at 0.
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return { top: this.hasAttribute('data-list') ? -400 : 0 } as DOMRect;
    });
  let readRowFoldPx = () => 0;
  function Harness({ shown }: { shown: string | undefined }) {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement,
      itemCount: 2,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadId: shown,
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return (
      <div ref={controller.virtualInnerRef} data-list>
        <div data-index="0" />
        <div data-index="1" />
      </div>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<Harness shown={threadId} />));
    const inner = container.firstElementChild as HTMLElement;

    const hook = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as CorrectionHook;
    expect(
      hook({ end: 100, index: 0 }, 62, {
        scrollOffset: 400,
        scrollDirection: 'backward',
        scrollElement,
      })
    ).toBe(false);
    // The margin and the part of it the rows bring change in the same render.
    expect(inner.style.marginTop).toBe('');
    expect(readRowFoldPx()).toBe(0);
    flushSync(() => root.render(<Harness shown={nextThreadId} />));
    // The render that paints the margin also counts its part.
    const painted = { marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() };
    flushSync(() => root.render(<Harness shown={nextThreadId} />));
    const { marginTop } = inner.style;

    // The newest row ends where the list ends.
    const box = (bottom: number, height: number) => () => ({ bottom, height } as DOMRect);
    inner.getBoundingClientRect = box(800, 400);
    inner.querySelectorAll<HTMLElement>('[data-index]').forEach((tile, index) => {
      Object.defineProperty(tile, 'offsetHeight', { value: 200 });
      tile.getBoundingClientRect = box(600 + index * 200, 200);
    });
    const rows = [
      { index: 0, size: 200 },
      { index: 1, size: 200 },
    ];
    return {
      painted,
      marginTop,
      rowFoldPx: readRowFoldPx(),
      shrink: listShrinkNotRendered(inner, rows, readRowFoldPx()),
    };
  } finally {
    flushSync(() => root.unmount());
    rect.mockRestore();
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
};

it('reads no shrink in a thread whose row above the reader grew and moved into the ledger', () => {
  // The thread's list holds all its rows: it rendered the grown row, so the margin lifts it
  // without the list giving up any room, and the end clamp must not pull the reader up.
  expect(afterDroppedCorrection('$thread')).toMatchObject({
    painted: { marginTop: '-62px', rowFoldPx: 62 },
    marginTop: '-62px',
    shrink: 0,
  });
});

it('reads no shrink in the room view either', () => {
  // The room's list rendered the grown row as well: a reader at its newest row stays there.
  expect(afterDroppedCorrection(undefined)).toMatchObject({
    painted: { marginTop: '-62px', rowFoldPx: 62 },
    marginTop: '-62px',
    shrink: 0,
  });
});

it('drops a waiting correction with the thread it was taken for', () => {
  // Another thread opened before the render that paints the correction's margin.
  expect(afterDroppedCorrection('$thread', '$other')).toMatchObject({
    marginTop: '',
    rowFoldPx: 0,
  });
});

it('reads no shrink when leading content (e.g. Load older messages) mounts above a thread list', () => {
  const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = document.createElement('div');
  scrollElement.scrollTop = 400;
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-list')) return { top: -400, bottom: 800, height: 400 } as DOMRect;
      if (this.dataset.index === '0') return { top: 400, bottom: 600, height: 200 } as DOMRect;
      if (this.dataset.index === '1') return { top: 600, bottom: 800, height: 200 } as DOMRect;
      return { top: 0, bottom: 400, height: 400 } as DOMRect;
    });
  let readRowFoldPx = () => 0;
  let leadingHeight = 0;
  function Harness({ leadingKey }: { leadingKey: string }) {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 200,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement,
      itemCount: 2,
      leadingKey,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 200),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map([
        ['$e0', 0],
        ['$e1', 1],
      ]),
      threadEvents: [{ getId: () => '$e0' }, { getId: () => '$e1' }],
      threadId: '$thread',
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return (
      <>
        <div
          ref={(node) => {
            (controller.leadingRef as { current: HTMLDivElement | null }).current = node;
            if (node) {
              Object.defineProperty(node, 'offsetHeight', {
                configurable: true,
                get: () => leadingHeight,
              });
            }
          }}
        />
        <div ref={controller.virtualInnerRef} data-list style={{ marginTop: controller.ledgerPxAtRender ? `${-controller.ledgerPxAtRender}px` : '' }}>
          <div data-index="0" />
          <div data-index="1" />
        </div>
      </>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<Harness leadingKey="" />));
    // Mount "Load older messages" (40 px) above the list after the thread is already anchored.
    leadingHeight = 40;
    flushSync(() => root.render(<Harness leadingKey="|older|" />));
    const inner = container.querySelector<HTMLElement>('[data-list]')!;
    inner.querySelectorAll<HTMLElement>('[data-index]').forEach((tile) => {
      Object.defineProperty(tile, 'offsetHeight', { configurable: true, value: 200 });
    });
    const rows = [
      { index: 0, size: 200 },
      { index: 1, size: 200 },
    ];
    // Leading content added 40 px above the list and marginTop pulled the list up by 40 px:
    // total scroll content height did not shrink, so useListEndClamp must read 0 px pending shrink.
    expect(inner.style.marginTop).toBe('-40px');
    expect(listShrinkNotRendered(inner, rows, readRowFoldPx())).toBe(0);
  } finally {
    flushSync(() => root.unmount());
    rect.mockRestore();
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
});
