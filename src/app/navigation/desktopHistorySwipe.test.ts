// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { installDesktopHistorySwipe } from './desktopHistorySwipe';

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
const phase = (p: 'begin' | 'end') => emit({ type: 'scroll-gesture', phase: p });
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
      ? new Proxy(real(el), { get: (t, k, r) => (k in p ? p[k] : Reflect.get(t, k, r)) })
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

  it('blocks horizontal scrollers (incl. wheel-before-begin and input/textarea) and overscroll-x', () => {
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
    wheel({ deltaX: -30 });
    swipe(BACK.slice(1));
    expect(backSpy).toHaveBeenCalledTimes(3);
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
});
