// @vitest-environment jsdom
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { buildMeasurementScrollCorrectionHook } from '../event-store/threads/threadRenderUtils';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

type CorrectionHook = ReturnType<typeof buildMeasurementScrollCorrectionHook>;

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  scrollOffset: 0,
  setOptions: () => {},
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItemForOffset: () => undefined,
}));
/** Ends the waits for the scroll to come to rest. */
const rest = vi.hoisted(() => ({ waits: [] as (() => void)[] }));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () =>
    new Promise<void>((resolve) => {
      rest.waits.push(resolve);
    }),
}));

it('restores the part rows brought to the ledger when a settle is discarded', async () => {
  const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = document.createElement('div');
  scrollElement.scrollTop = 400;
  // The room's leading content (its intro) lies above the reader's view.
  let leadingPx = 100;
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return { top: 0, bottom: this.hasAttribute('data-leading') ? -10 : 800 } as DOMRect;
    });
  const height = vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-leading') ? leadingPx : 0;
    });
  let readRowFoldPx = () => 0;
  function Harness() {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement,
      itemCount: 2,
      leadingKey: 'room',
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return (
      <>
        <div ref={controller.leadingRef} data-leading />
        <div ref={controller.virtualInnerRef} data-list />
      </>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = () => flushSync(() => root.render(<Harness />));
  // virtual-core listens for the scroll before the ledger does, and renders the rows at the
  // offset of the event.
  const marginAtRender: (string | undefined)[] = [];
  scrollElement.addEventListener('scroll', () => {
    marginAtRender.push(container.querySelector<HTMLElement>('[data-list]')?.style.marginTop);
  });
  try {
    render();
    render();
    const inner = container.querySelector<HTMLElement>('[data-list]');
    if (!inner) throw new Error('List missing');
    // jsdom keeps a margin that is set to '', as the settle sets it.
    Object.defineProperty(inner, 'style', { value: { marginTop: '' } });
    // The intro grows by 30 px: the ledger holds it, and no row brought that height.
    leadingPx = 130;
    render();
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '-30px',
      rowFoldPx: 0,
    });
    // A row above the reader grows by 62 px while they scroll up: the ledger takes that too.
    const hook = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as CorrectionHook;
    expect(
      hook({ end: 100, index: 0 }, 62, {
        scrollOffset: 400,
        scrollDirection: 'backward',
        scrollElement,
      })
    ).toBe(false);
    render();
    render();
    const held = { marginTop: '-92px', rowFoldPx: 62 };
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual(held);

    // The scroll comes to rest and the ledger settles: the margin goes into the position.
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect({ marginTop: inner.style.marginTop, scrollTop: scrollElement.scrollTop }).toEqual({
      marginTop: '',
      scrollTop: 492,
    });
    expect(readRowFoldPx()).toBe(0);

    // The compositor puts the position back where it was before the settle: the margin returns,
    // and with it the part the row brought, so the end clamp reads no shrink in it. It returns
    // in the scroll event itself, before the frame paints the rows without it.
    scrollElement.scrollTop = 400;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual(held);
    // virtual-core renders the rows of that offset with the margin back.
    expect(marginAtRender.at(-1)).toBe(held.marginTop);
    render();
    render();
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual(held);
  } finally {
    flushSync(() => root.unmount());
    rect.mockRestore();
    height.mockRestore();
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
});
