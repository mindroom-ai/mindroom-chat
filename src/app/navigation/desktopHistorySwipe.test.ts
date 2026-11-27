// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { installDesktopHistorySwipe, registerTrackpadSwipeClaimer } from './desktopHistorySwipe';

type WheelOpts = WheelEventInit & { momentum?: boolean; defaultPrevented?: boolean };
type SwipeOpts = Parameters<typeof installDesktopHistorySwipe>[1];
const BACK: WheelOpts[] = [{ deltaX: -30 }, { deltaX: -30 }, { deltaX: -30 }];
const FWD: WheelOpts[] = [{ deltaX: 30 }, { deltaX: 30 }, { deltaX: 30 }];

let emit: (event: DesktopShellEvent) => void;
let backSpy: ReturnType<typeof vi.spyOn>;
let forwardSpy: ReturnType<typeof vi.spyOn>;
const cleanups: Array<() => void> = [];

const def = (obj: object, prop: PropertyKey, value: unknown) =>
  Object.defineProperty(obj, prop, { configurable: true, value });
const pill = () => document.querySelector<HTMLElement>('[data-desktop-history-swipe]');
const phase = (p: 'begin' | 'end' | 'cancel') => emit({ type: 'scroll-gesture', phase: p });
const counts = () => [backSpy.mock.calls.length, forwardSpy.mock.calls.length];
const install = (o: SwipeOpts = {}, enabled = true) => {
  const stop = installDesktopHistorySwipe(window, {
    isMac: () => true,
    allowUntrusted: true,
    ...o,
  });
  cleanups.push(stop);
  if (enabled) emit({ type: 'swipe-tracking', enabled: true });
  return stop;
};
const installBridge = () => {
  const ls = new Set<(e: DesktopShellEvent) => void>();
  emit = (e) => ls.forEach((l) => l(e));
  const bridge: Partial<DesktopBridge> = {
    onShellEvent: (l) => {
      ls.add(l);
      return () => void ls.delete(l);
    },
  };
  def(window, 'mindroomDesktop', bridge);
};
const wheel = (init: WheelOpts = {}, target: EventTarget = document.body) => {
  const { momentum, defaultPrevented, ...rest } = init;
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, ...rest });
  if (momentum !== undefined) def(e, 'momentum', momentum);
  if (defaultPrevented) e.preventDefault();
  target.dispatchEvent(e);
};
const swipe = (wheels: WheelOpts[], target: EventTarget = document.body, end = true) => {
  phase('begin');
  wheels.forEach((w) => wheel(w, target));
  if (end) phase('end');
};
const addEl = (tag: string, attrs: Record<string, string> = {}, parent = document.body) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  parent.append(el);
  return el;
};
const mockStyles = (entries: Array<[Element, Partial<CSSStyleDeclaration>]>) => {
  const map = new Map(entries);
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    const p = map.get(el) as Record<PropertyKey, unknown> | undefined;
    return p
      ? new Proxy(real(el), { get: (t, k) => (k in p ? p[k] : Reflect.get(t, k, t)) })
      : real(el);
  });
};

beforeEach(() => {
  document.documentElement.dir = 'ltr';
  document.body.innerHTML = '<div id="portalContainer"></div>';
  window.history.pushState({}, '', '/home');
  installBridge();
  def(window, 'navigation', { canGoBack: true, canGoForward: true });
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  Reflect.deleteProperty(window, 'mindroomDesktop');
  Reflect.deleteProperty(window, 'navigation');
  document.documentElement.dir = '';
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('installDesktopHistorySwipe', () => {
  it('is a no-op outside desktop, on non-macOS, and on /quick-capture/', () => {
    Reflect.deleteProperty(window, 'mindroomDesktop');
    install();
    installBridge();
    install({ isMac: () => false });
    emit({ type: 'swipe', direction: 'left' });
    window.history.pushState({}, '', '/quick-capture/');
    install();
    emit({ type: 'swipe', direction: 'left' });
    expect(counts()).toEqual([0, 0]);
    expect(pill()).toBeNull();
  });

  it('stays disabled when subscribing after did-finish-load sent false while discrete swipe still works', () => {
    // did-finish-load emitted swipe-tracking=false before the renderer subscribed
    emit({ type: 'swipe-tracking', enabled: false });
    install({}, false);

    // Default-disabled + gestureScrollBegin resending false must not navigate or show indicator
    BACK.forEach((w) => wheel(w));
    phase('end');
    emit({ type: 'swipe-tracking', enabled: false });
    BACK.forEach((w) => wheel(w));
    phase('end');
    expect(counts()).toEqual([0, 0]);
    expect(pill()).toBeNull();

    // Discrete AppKit swipe still works independently of two-finger scroll tracking
    emit({ type: 'swipe', direction: 'left' });
    expect(counts()).toEqual([1, 0]);

    // Once gestureScrollBegin syncs swipe-tracking=true, two-finger swipe works
    emit({ type: 'swipe-tracking', enabled: true });
    swipe(BACK);
    expect(counts()).toEqual([2, 0]);
  });

  it('navigates back and forward in LTR/RTL with lazy edge indicator and cleanup', () => {
    const stop = install();
    expect(pill()).toBeNull();
    phase('begin');
    wheel({ deltaX: -30 });
    const el = pill();
    const svg = el?.querySelector('svg');
    expect(el?.parentElement).toBe(document.body);
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.hasAttribute('data-directional')).toBe(true);
    expect(el?.dataset).toMatchObject({ direction: 'back', visible: 'true', armed: 'false' });
    BACK.slice(1).forEach((w) => wheel(w));
    expect(el?.dataset.armed).toBe('true');
    phase('end');
    expect(el?.dataset.visible).toBe('false');
    expect(counts()).toEqual([1, 0]);

    swipe(FWD);
    document.documentElement.dir = 'rtl';
    swipe(FWD, document.body, false);
    expect(el?.dataset).toMatchObject({ direction: 'back', armed: 'true' });
    phase('end');
    swipe(BACK);
    expect(counts()).toEqual([2, 2]);
    stop();
    expect(pill()).toBeNull();
    swipe(BACK);
    expect(counts()).toEqual([2, 2]);
  });

  it('cancels on finger reversal and commits on momentum/pause while swallowing momentum tail', () => {
    vi.useFakeTimers();
    install();
    swipe(BACK, document.body, false);
    expect(pill()?.dataset.armed).toBe('true');
    wheel({ deltaX: 40 });
    expect(pill()?.dataset.armed).toBe('false');
    phase('end');
    swipe([...BACK, { deltaX: 40 }, { deltaX: -50, momentum: true }]);
    swipe([{ deltaX: -20 }, { deltaX: -20 }, { deltaX: -10 }, { deltaX: -80, momentum: true }]);
    expect(backSpy).not.toHaveBeenCalled();

    swipe(BACK, document.body, false);
    vi.advanceTimersByTime(1000);
    expect(pill()?.dataset).toMatchObject({ visible: 'true', armed: 'true' });
    wheel({ deltaX: -10, momentum: true });
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(pill()?.dataset.visible).toBe('false');
    window.dispatchEvent(new PopStateEvent('popstate'));
    BACK.forEach((w) => wheel(w));
    expect(backSpy).toHaveBeenCalledTimes(1);

    // Next begin clears ignored even if previous end was dropped; pause before end commits
    swipe(BACK, document.body, false);
    vi.advanceTimersByTime(1000);
    phase('end');
    expect(backSpy).toHaveBeenCalledTimes(2);
  });

  it('blocks horizontal scrollers (incl. input/textarea) and overscroll-x', () => {
    const sized = (tag: string, sw: number) => {
      const el = addEl(tag);
      def(el, 'scrollWidth', sw);
      def(el, 'clientWidth', 300);
      return el;
    };
    const scroller = sized('div', 800);
    const child = addEl('span', {}, scroller);
    const fit = sized('div', 300);
    const inp = sized('input', 600);
    const ta = sized('textarea', 600);
    const osContain = addEl('div');
    const osNone = addEl('div');
    const osY = addEl('div');
    mockStyles([
      [scroller, { overflowX: 'auto' }],
      [fit, { overflowX: 'auto' }],
      [osContain, { overflowX: 'auto', overscrollBehaviorX: 'contain' }],
      [osNone, { overflowX: 'hidden', overscrollBehaviorX: 'none' }],
      [osY, { overflowY: 'auto', overscrollBehaviorX: 'auto', overscrollBehaviorY: 'contain' }],
    ]);
    install();
    wheel({ deltaX: -20 }, child);
    swipe(BACK, child);
    [inp, ta, osContain, osNone].forEach((el) => swipe(BACK, el));
    expect(backSpy).not.toHaveBeenCalled();
    expect(pill()).toBeNull();
    [fit, osY].forEach((el) => swipe(BACK, el));
    // A stray wheel before native begin (e.g. mouse wheel) must not count toward a later gesture
    wheel({ deltaX: -30 });
    swipe(BACK.slice(1));
    expect(backSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects modifiers, line-mode, defaultPrevented, untrusted, titlebar drag, diagonal drift, and swipe-tracking=false', () => {
    const drag = addEl('div', { 'data-titlebar-drag': '' });
    const stop = install();
    const run3 = (o: WheelOpts) => swipe(Array.from({ length: 3 }, () => ({ deltaX: -40, ...o })));
    (['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const).forEach((k) => run3({ [k]: true }));
    run3({ deltaMode: 1 });
    run3({ defaultPrevented: true });
    swipe(BACK, drag);
    swipe([{ deltaX: -15 }, { deltaX: -5, deltaY: 25 }, { deltaX: -90 }, { deltaX: -50 }]);
    emit({ type: 'swipe-tracking', enabled: false });
    swipe(BACK);
    stop();
    install({ allowUntrusted: false });
    swipe(BACK);
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('blocks dialogs, allows Back-only in ImageOverlay, and checks navigation/history fallback', () => {
    install();
    const dialog = addEl('div', { role: 'dialog' });
    swipe(BACK);
    dialog.remove();
    expect(counts()).toEqual([0, 0]);

    const iv = addEl('div', { 'data-image-viewer-overlay': '' });
    iv.innerHTML = '<div role="dialog"></div>';
    swipe(FWD);
    swipe(BACK);
    const menu = addEl('div', { role: 'menu' });
    swipe(BACK);
    menu.remove();
    iv.remove();
    expect(counts()).toEqual([1, 0]);

    def(window, 'navigation', { canGoBack: false, canGoForward: false });
    swipe(BACK);
    Reflect.deleteProperty(window, 'navigation');
    swipe(FWD);
    swipe(BACK);
    expect(counts()).toEqual([2, 0]);
  });

  it('handles discrete AppKit swipe with RTL/dedup and resets on blur, window-hidden, visibilitychange, and popstate', () => {
    let clock = 1000;
    install({ now: () => clock });
    emit({ type: 'swipe-tracking', enabled: false });
    emit({ type: 'swipe', direction: 'left' });
    emit({ type: 'swipe', direction: 'right' });
    document.documentElement.dir = 'rtl';
    emit({ type: 'swipe', direction: 'right' });
    document.documentElement.dir = 'ltr';
    expect(counts()).toEqual([2, 1]);

    emit({ type: 'swipe-tracking', enabled: true });
    swipe(BACK);
    clock += 200;
    emit({ type: 'swipe', direction: 'left' });
    expect(backSpy).toHaveBeenCalledTimes(3);
    clock += 100;
    emit({ type: 'swipe', direction: 'left' });
    expect(backSpy).toHaveBeenCalledTimes(4);

    for (const interrupt of [
      () => window.dispatchEvent(new Event('blur')),
      () => emit({ type: 'window-hidden' }),
      () => window.dispatchEvent(new PopStateEvent('popstate')),
      () => {
        def(document, 'visibilityState', 'hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        def(document, 'visibilityState', 'visible');
      },
    ]) {
      swipe(BACK, document.body, false);
      expect(pill()?.dataset.visible).toBe('true');
      interrupt();
      expect(pill()?.dataset.visible).toBe('false');
      phase('end');
    }
    expect(backSpy).toHaveBeenCalledTimes(4);
  });

  it('ignores mouse wheels without native begin, aborts on cancel, flushes 1 rAF on unarmed end, and cancels rAF on cleanup', () => {
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafQueue.delete(id);
    });
    const flushRaf = () => {
      for (const [id, cb] of [...rafQueue]) {
        rafQueue.delete(id);
        cb(16);
      }
    };

    const stop = install();

    // Mouse horizontal scroll wheels never emit native scroll-gesture begin -> 100% ignored
    [...BACK, ...BACK, ...FWD].forEach((w) => wheel(w));
    phase('end');
    expect(counts()).toEqual([0, 0]);
    expect(pill()).toBeNull();
    expect(rafSpy).not.toHaveBeenCalled();

    // Native cancel aborts an armed gesture without navigating and closes the touch gate
    swipe(BACK, document.body, false);
    expect(pill()?.dataset.armed).toBe('true');
    phase('cancel');
    expect(pill()?.dataset.visible).toBe('false');
    BACK.forEach((w) => wheel(w));
    phase('end');
    expect(counts()).toEqual([0, 0]);

    // Armed gesture commits immediately on end without scheduling a rAF
    swipe(BACK);
    expect(counts()).toEqual([1, 0]);
    expect(rafSpy).not.toHaveBeenCalled();

    // Unarmed gesture waits 1 rAF for a final coalesced compositor wheel sample, then commits
    phase('begin');
    wheel({ deltaX: -30 });
    wheel({ deltaX: -30 });
    phase('end');
    expect(rafQueue.size).toBe(1);
    expect(counts()).toEqual([1, 0]);
    wheel({ deltaX: -30 });
    flushRaf();
    expect(counts()).toEqual([2, 0]);
    expect(pill()?.dataset.visible).toBe('false');

    // After the rAF closes the touch gate, stray mouse wheels are ignored again
    BACK.forEach((w) => wheel(w));
    expect(counts()).toEqual([2, 0]);

    // A fresh begin after a missed end resets stale tracked distance instead of carrying it over
    phase('begin');
    wheel({ deltaX: -30 });
    wheel({ deltaX: -30 });
    expect(pill()?.dataset.visible).toBe('true');
    phase('begin');
    expect(pill()?.dataset.visible).toBe('false');
    wheel({ deltaX: -30 });
    phase('end');
    flushRaf();
    expect(counts()).toEqual([2, 0]);

    // Teardown cancels any pending end rAF cleanly
    phase('begin');
    wheel({ deltaX: -30 });
    phase('end');
    expect(rafQueue.size).toBe(1);
    stop();
    expect(cafSpy).toHaveBeenCalledTimes(1);
    expect(rafQueue.size).toBe(0);
    flushRaf();
    expect(counts()).toEqual([2, 0]);
  });
  it('arbitrates registered trackpad claimers cleanly with non-cancelable follow-ups and swipe-tracking=false', () => {
    install({}, false); // swipe-tracking disabled ("Swipe between pages" off)
    const move = vi.fn();
    const end = vi.fn();
    const cancel = vi.fn();
    const onVerticalScroll = vi.fn();
    const onWindowHidden = vi.fn();
    let readyToCommit = false;
    const claimFn = vi.fn(() => ({
      move,
      end,
      cancel,
      isReadyToCommit: () => readyToCommit,
    }));
    const stopClaimer = registerTrackpadSwipeClaimer({
      claim: claimFn,
      onVerticalScroll,
      onWindowHidden,
    });
    cleanups.push(stopClaimer);

    // Works with swipe-tracking=false and cancelable=false follow-up wheels; suppresses AppKit swipe while claimed.
    phase('begin');
    wheel({ deltaX: 4, cancelable: true });
    wheel({ deltaX: 50, cancelable: false });
    wheel({ deltaX: 60, cancelable: false });
    emit({ type: 'swipe', direction: 'left' });
    expect(counts()).toEqual([0, 0]);
    expect(claimFn).toHaveBeenCalledWith(
      expect.objectContaining({ deltaX: 54, deltaY: 0, blockedByDom: false })
    );
    expect(move).toHaveBeenCalledWith(60, 0);
    readyToCommit = true;
    phase('end');
    expect(end).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    // Vertical scroll notifies claimers without claiming; window-hidden cancels active claim & notifies.
    phase('begin');
    wheel({ deltaX: 1, deltaY: 20 });
    phase('end');
    expect(onVerticalScroll).toHaveBeenCalledTimes(1);

    readyToCommit = false;
    phase('begin');
    wheel({ deltaX: 40 });
    emit({ type: 'window-hidden' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onWindowHidden).toHaveBeenCalledTimes(1);

    // Momentum ends a claimed gesture cleanly without cancelling.
    phase('begin');
    wheel({ deltaX: 40 });
    wheel({ deltaX: 10, momentum: true });
    expect(end).toHaveBeenCalledTimes(2);

    // Passing blockedByDom=true on a horizontal scroller.
    const scroller = addEl('div');
    def(scroller, 'scrollWidth', 800);
    def(scroller, 'clientWidth', 300);
    mockStyles([[scroller, { overflowX: 'auto' }]]);
    claimFn.mockClear();
    phase('begin');
    wheel({ deltaX: 30 }, scroller);
    phase('cancel');
    expect(claimFn).toHaveBeenCalledWith(expect.objectContaining({ blockedByDom: true }));
    expect(counts()).toEqual([0, 0]);
  });
});
