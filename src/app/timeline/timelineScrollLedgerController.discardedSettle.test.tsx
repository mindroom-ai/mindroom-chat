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

    // The ledger settles again, and a wheel turns 40 px up before WebKit's scrolling thread has
    // the write: the position comes back as it was plus the wheel's travel, and so does the margin.
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect({ marginTop: inner.style.marginTop, scrollTop: scrollElement.scrollTop }).toEqual({
      marginTop: '',
      scrollTop: 492,
    });
    const wheelUp = () => scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
    wheelUp();
    scrollElement.scrollTop = 360;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual(held);
    // WebKit applies the write after all, and the wheel turns once more: the position lands
    // where the settle asked plus that turn. The ledger takes the browser's move, 132 px of it,
    // so the rows stay where the two turns of the wheel put them, in the event itself.
    Object.defineProperty(scrollElement, 'scrollHeight', { value: 5000 });
    wheelUp();
    scrollElement.scrollTop = 452;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '40px',
      rowFoldPx: 0,
    });
    expect(marginAtRender.at(-1)).toBe('40px');
  } finally {
    flushSync(() => root.unmount());
    rect.mockRestore();
    height.mockRestore();
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
});

it('follows an unclamped WebKit replay past the restored end and tracks applied corrections in between', async () => {
  const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = document.createElement('div');
  scrollElement.scrollTop = 23602;
  let scrollHeight = 36006;
  Object.defineProperty(scrollElement, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(scrollElement, 'clientHeight', { configurable: true, value: 884 });
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({ top: 0, bottom: 884 } as DOMRect));
  let readRowFoldPx = () => 0;
  function Harness() {
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
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return <div ref={controller.virtualInnerRef} data-list />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = () => flushSync(() => root.render(<Harness />));
  try {
    render();
    render();
    const inner = container.querySelector<HTMLElement>('[data-list]');
    if (!inner) throw new Error('List missing');
    let clampOnNextMarginWrite = false;
    let marginTopValue = '';
    Object.defineProperty(inner, 'style', {
      value: {
        get marginTop() {
          return marginTopValue;
        },
        set marginTop(value: string) {
          marginTopValue = value;
          if (clampOnNextMarginWrite) {
            clampOnNextMarginWrite = false;
            scrollElement.scrollTop = 35122;
          }
        },
      },
    });
    const hook = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as CorrectionHook;
    // Fold 15846 px from rows above the reader.
    expect(
      hook({ end: 100, index: 0 }, 15846, {
        scrollOffset: 23602,
        scrollDirection: 'backward',
        scrollElement,
      })
    ).toBe(false);
    render();
    render();
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '-15846px',
      rowFoldPx: 15846,
    });

    // Quiescence settles: margin clears, scrollHeight grows, scrollTop becomes 39448.
    scrollHeight = 51852;
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect({ marginTop: inner.style.marginTop, scrollTop: scrollElement.scrollTop }).toEqual({
      marginTop: '',
      scrollTop: 39448,
    });

    // WebKit discards under a wheel notch (-240): restores margin (-15846px), shrinking end to 35122.
    const wheelUp = () => scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
    wheelUp();
    scrollElement.scrollTop = 23362;
    scrollElement.dispatchEvent(new Event('scroll'));
    scrollHeight = 36006;
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '-15846px',
      rowFoldPx: 15846,
    });

    // WebKit replays 39448 - 240 = 39208 UNCLAMPED past the restored end (35122), and
    // clamps scrollTop to 35122 during the commit layout before the margin resolves.
    clampOnNextMarginWrite = true;
    wheelUp();
    scrollElement.scrollTop = 39208;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({
      scrollTop: scrollElement.scrollTop,
      marginTop: inner.style.marginTop,
      rowFoldPx: readRowFoldPx(),
    }).toEqual({
      scrollTop: 35122,
      marginTop: '-3846px',
      rowFoldPx: 3846,
    });

    // If WebKit instead replays a settle write clamped to the restored end (35122), only the
    // moved part comes off rowFoldPx so the remaining negative margin does not read as shrink.
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    scrollHeight = 36006;
    scrollElement.scrollTop = 23602;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect(
      hook({ end: 100, index: 0 }, 15846, {
        scrollOffset: 23602,
        scrollDirection: 'backward',
        scrollElement,
      })
    ).toBe(false);
    render();
    render();
    scrollHeight = 51852;
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    wheelUp();
    scrollElement.scrollTop = 23362;
    scrollElement.dispatchEvent(new Event('scroll'));
    scrollHeight = 36006;
    wheelUp();
    scrollElement.scrollTop = 35122;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '-3846px',
      rowFoldPx: 3846,
    });

    // Settle the remaining -240 px, then test a negative fold settle discarded with an applied
    // correction landing before WebKit replays the settle write.
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    scrollHeight = 50954;
    scrollElement.scrollTop = 27030;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect(
      hook({ end: 100, index: 0 }, -1140, {
        scrollOffset: 27030,
        scrollDirection: 'backward',
        scrollElement,
      })
    ).toBe(false);
    render();
    render();
    expect(inner.style.marginTop).toBe('1140px');

    scrollHeight = 49814;
    rest.waits.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect({ marginTop: inner.style.marginTop, scrollTop: scrollElement.scrollTop }).toEqual({
      marginTop: '',
      scrollTop: 25890,
    });

    // Discarded under a wheel notch (-240): scrollTop returns to 26790.
    wheelUp();
    scrollElement.scrollTop = 26790;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect(inner.style.marginTop).toBe('1140px');

    // virtual-core applies a -256 px correction before WebKit replays the settle write.
    expect(
      hook({ end: 100, index: 0 }, -256, {
        scrollOffset: 26790,
        scrollDirection: null,
        scrollElement,
      })
    ).toBe(true);
    scrollElement.scrollTop = 26534;

    // WebKit replays 25890 - 240 = 25650: movedPx is (25650 - 26534) - (-240) = -644, not -900.
    wheelUp();
    scrollElement.scrollTop = 25650;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '496px',
      rowFoldPx: -496,
    });

    // WebKit then replays the applied correction (26534 - 240 = 26294): handled by landsAt, not
    // re-entering discarded (which would add -1140 instead of -884).
    wheelUp();
    scrollElement.scrollTop = 26294;
    scrollElement.dispatchEvent(new Event('scroll'));
    expect({ marginTop: inner.style.marginTop, rowFoldPx: readRowFoldPx() }).toEqual({
      marginTop: '1380px',
      rowFoldPx: -1380,
    });
  } finally {
    flushSync(() => root.unmount());
    rect.mockRestore();
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
});
