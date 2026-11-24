// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCLOSURE_REVEAL_TOP_MARGIN_PX,
  computeDisclosureRevealDelta,
  findScrollContainer,
  isDisclosureRevealActive,
  measureExpandedBottom,
  scheduleDisclosureReveal,
} from './disclosureReveal';
import { HEADER_OUT_OF_PADDING } from './styles/threadHeaderInset';

const rect = (top: number, height: number): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 400,
  width: 400,
  height,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

describe('computeDisclosureRevealDelta', () => {
  const base = { containerTop: 0, containerBottom: 600, insetTop: 56, insetBottom: 96 };

  it('returns 0 when the expanded disclosure already fits above the bottom inset', () => {
    expect(computeDisclosureRevealDelta({ ...base, toggleTop: 220, expandedBottom: 504 })).toBe(0);
    expect(computeDisclosureRevealDelta({ ...base, toggleTop: 220, expandedBottom: 420 })).toBe(0);
  });

  it('returns exact overflow for a short disclosure extending behind the composer', () => {
    expect(computeDisclosureRevealDelta({ ...base, toggleTop: 380, expandedBottom: 610 })).toBe(
      106
    );
  });

  it('clamps a huge disclosure so the toggle stops at visibleTop + topMargin', () => {
    const delta = computeDisclosureRevealDelta({ ...base, toggleTop: 380, expandedBottom: 2400 });
    expect(delta).toBe(380 - (base.containerTop + base.insetTop) - DISCLOSURE_REVEAL_TOP_MARGIN_PX);
  });

  it('returns 0 and never scrolls upward when the toggle is already at or above top clamp', () => {
    expect(computeDisclosureRevealDelta({ ...base, toggleTop: 64, expandedBottom: 900 })).toBe(0);
    expect(computeDisclosureRevealDelta({ ...base, toggleTop: 20, expandedBottom: 900 })).toBe(0);
  });
});

describe('scheduleDisclosureReveal', () => {
  let frames: FrameRequestCallback[];
  let observers: Array<{ cb: ResizeObserverCallback; targets: Set<Element> }>;

  const flushFrame = () => frames.splice(0).forEach((cb) => cb(16));
  const triggerResize = (el: Element) =>
    observers.forEach(({ cb, targets }) => {
      if (targets.has(el)) cb([] as ResizeObserverEntry[], {} as ResizeObserver);
    });

  const createFixture = (
    opts: {
      initialScrollTop?: number;
      maxScrollTop?: number;
      bannerHeight?: number;
      targetTop?: number;
      targetHeight?: number;
    } = {}
  ) => {
    let scrollTopValue = opts.initialScrollTop ?? 200;
    const state = {
      maxScrollTop: opts.maxScrollTop ?? 800,
      targetHeight: opts.targetHeight ?? 180,
    };
    const column = document.createElement('div');
    if (opts.bannerHeight) {
      column.style.setProperty('--room-thread-header-height', `${opts.bannerHeight}px`);
    }
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.style.scrollPaddingTop = '54px';
    scroller.style.scrollPaddingBottom = '96px';
    if (opts.bannerHeight) scroller.style.setProperty(HEADER_OUT_OF_PADDING, '1');
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = Math.max(0, Math.min(state.maxScrollTop, next));
      },
    });
    scroller.getBoundingClientRect = () => rect(0, 600);

    const rows = document.createElement('div');
    rows.setAttribute('data-timeline-rows', '');
    const toggle = document.createElement('button');
    toggle.getBoundingClientRect = () => rect(560 - scrollTopValue, 28);
    const target = document.createElement('div');
    target.getBoundingClientRect = () =>
      rect((opts.targetTop ?? 590) - scrollTopValue, state.targetHeight);

    rows.append(toggle, target);
    scroller.append(rows);
    column.append(scroller);
    document.body.append(column);
    return { scroller, rows, toggle, target, state };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    observers = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      if (id > 0 && id <= frames.length) frames[id - 1] = () => {};
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private entry: { cb: ResizeObserverCallback; targets: Set<Element> };
        constructor(cb: ResizeObserverCallback) {
          this.entry = { cb, targets: new Set() };
          observers.push(this.entry);
        }
        observe = (el: Element) => this.entry.targets.add(el);
        disconnect = () => this.entry.targets.clear();
      }
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('scrolls immediately and respects readTopInset banner plus scrollPaddingBottom', () => {
    // visibleTop = 54 + 88 = 142; toggle starts at 360 -> tall target clamps at 360 - 142 - 8 = 210.
    const { scroller, toggle, target } = createFixture({ bannerHeight: 88, targetHeight: 2000 });
    scheduleDisclosureReveal({ toggle, getTargets: () => [target] });
    expect(isDisclosureRevealActive(scroller)).toBe(true);

    flushFrame();
    expect(scroller.scrollTop).toBe(410);
    expect(toggle.getBoundingClientRect().top).toBe(150);
    expect(isDisclosureRevealActive(scroller)).toBe(false);
  });

  it('waits for virtualizer rows to grow when frame 1 scrollTop is clamped', () => {
    const { scroller, rows, toggle, target, state } = createFixture({ maxScrollTop: 200 });
    scheduleDisclosureReveal({ toggle, getTargets: () => [target] });
    flushFrame();
    expect(scroller.scrollTop).toBe(200);
    expect(isDisclosureRevealActive(scroller)).toBe(true);

    state.maxScrollTop = 320;
    triggerResize(rows);
    flushFrame();
    expect(scroller.scrollTop).toBe(266);
    expect(target.getBoundingClientRect().bottom).toBe(504);
    expect(isDisclosureRevealActive(scroller)).toBe(false);
  });

  it('tracks animated growth across ResizeObserver ticks until animationend on the element', () => {
    const { scroller, toggle, target, state } = createFixture({ targetHeight: 0 });
    scheduleDisclosureReveal({ toggle, getTargets: () => [target], animatedElement: target });
    flushFrame();
    expect(scroller.scrollTop).toBe(200);
    expect(isDisclosureRevealActive(scroller)).toBe(true);

    state.targetHeight = 180;
    triggerResize(target);
    flushFrame();
    expect(scroller.scrollTop).toBe(266);

    const child = document.createElement('span');
    target.append(child);
    child.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(isDisclosureRevealActive(scroller)).toBe(true);

    state.targetHeight = 900;
    target.dispatchEvent(new Event('animationend'));
    flushFrame();
    expect(toggle.getBoundingClientRect().top).toBe(62);
    expect(isDisclosureRevealActive(scroller)).toBe(false);
  });

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'] as const)(
    'cancels immediately on user %s intent',
    (eventName) => {
      const { scroller, toggle, target } = createFixture();
      scheduleDisclosureReveal({ toggle, getTargets: () => [target] });
      scroller.dispatchEvent(new Event(eventName));
      expect(isDisclosureRevealActive(scroller)).toBe(false);
      flushFrame();
      expect(scroller.scrollTop).toBe(200);
    }
  );

  it('cancels a prior reveal when another reveal starts on the same scroller', () => {
    const { scroller, rows, toggle, target } = createFixture();
    const otherToggle = document.createElement('button');
    otherToggle.getBoundingClientRect = () => rect(200, 24);
    const otherTarget = document.createElement('div');
    otherTarget.getBoundingClientRect = () => rect(230, 40);
    rows.append(otherToggle, otherTarget);

    scheduleDisclosureReveal({ toggle, getTargets: () => [target], animatedElement: target });
    scheduleDisclosureReveal({ toggle: otherToggle, getTargets: () => [otherTarget] });
    flushFrame();
    expect(scroller.scrollTop).toBe(200);
    expect(isDisclosureRevealActive(scroller)).toBe(false);
  });

  it('clamps expandedBottom against an overflowY: hidden ancestor', () => {
    const { scroller, rows, target } = createFixture({ targetTop: 450, targetHeight: 600 });
    const clip = document.createElement('div');
    clip.style.overflowY = 'hidden';
    clip.getBoundingClientRect = () => rect(200, 260);
    rows.append(clip);
    clip.append(target);
    expect(measureExpandedBottom([target], scroller)).toBe(460);
  });

  it('cleans up after settle timeout when scrollHeight cannot grow further', () => {
    const { scroller, toggle, target } = createFixture({ maxScrollTop: 200 });
    scheduleDisclosureReveal({ toggle, getTargets: () => [target] });
    flushFrame();
    expect(isDisclosureRevealActive(scroller)).toBe(true);
    vi.advanceTimersByTime(400);
    expect(isDisclosureRevealActive(scroller)).toBe(false);
  });

  it('skips an inner non-overflowing overflowX: auto wrapper to find the real scroller', () => {
    const { scroller, rows, toggle } = createFixture();
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    Object.defineProperty(inner, 'scrollHeight', { configurable: true, value: 160 });
    Object.defineProperty(inner, 'clientHeight', { configurable: true, value: 160 });
    rows.append(inner);
    inner.append(toggle);

    // Short thread before overflow: timeline scroller still wins via [data-timeline-rows]/padding.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
    expect(findScrollContainer(toggle)).toBe(scroller);

    // Overflowing scroller: returns immediately on scrollHeight > clientHeight.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1200 });
    expect(findScrollContainer(toggle)).toBe(scroller);
  });
});
