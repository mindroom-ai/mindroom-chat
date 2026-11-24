// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { installDesktopHistorySwipe } from './desktopHistorySwipe';

type ShellListener = (event: DesktopShellEvent) => void;
type WheelOpts = WheelEventInit & { momentum?: boolean; defaultPrevented?: boolean };

let emitShell: (event: DesktopShellEvent) => void;
let backSpy: ReturnType<typeof vi.spyOn>;
let forwardSpy: ReturnType<typeof vi.spyOn>;

const setNavigation = (canGoBack: boolean, canGoForward: boolean) => {
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: { canGoBack, canGoForward },
  });
};

const installBridge = () => {
  const listeners = new Set<ShellListener>();
  emitShell = (event) => {
    for (const listener of listeners) listener(event);
  };
  const bridge: Partial<DesktopBridge> = {
    onShellEvent: (listener: ShellListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
};

const fireWheel = (init: WheelOpts = {}, target: EventTarget = document.body) => {
  const { momentum, defaultPrevented, ...wheelInit } = init;
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    ...wheelInit,
  });
  if (momentum !== undefined) Object.defineProperty(event, 'momentum', { value: momentum });
  if (defaultPrevented) event.preventDefault();
  target.dispatchEvent(event);
  return event;
};

const runSwipe = (
  wheels: WheelOpts[],
  {
    target = document.body,
    end = 'end',
  }: { target?: EventTarget; end?: 'end' | 'fling' | 'cancel' | null } = {}
) => {
  emitShell({ type: 'scroll-gesture', phase: 'begin' });
  for (const w of wheels) fireWheel(w, target);
  if (end) emitShell({ type: 'scroll-gesture', phase: end });
};

const BACK_SWIPE: WheelOpts[] = [{ deltaX: -40 }, { deltaX: -40 }, { deltaX: -30 }];
const FORWARD_SWIPE: WheelOpts[] = [{ deltaX: 40 }, { deltaX: 40 }, { deltaX: 30 }];
const indicatorEl = () => document.querySelector<HTMLElement>('[data-desktop-history-swipe]');

const mockComputedStyles = (overrides: Map<Element, Partial<CSSStyleDeclaration>>) => {
  const real = window.getComputedStyle.bind(window);
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    const base = real(el);
    const patch = overrides.get(el);
    if (!patch) return base;
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in patch) {
          return patch[prop as keyof CSSStyleDeclaration];
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  });
};

beforeEach(() => {
  document.documentElement.dir = 'ltr';
  document.body.innerHTML = '<div id="portalContainer"></div>';
  window.history.pushState({}, '', '/home');
  installBridge();
  setNavigation(true, true);
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
});

afterEach(() => {
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
    const stopWeb = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    fireWheel({ deltaX: -50 });
    stopWeb();

    installBridge();
    const stopLinux = installDesktopHistorySwipe(window, {
      isMac: () => false,
      allowUntrusted: true,
    });
    emitShell({ type: 'swipe', direction: 'left' });
    stopLinux();

    window.history.pushState({}, '', '/quick-capture/');
    const stopQc = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    emitShell({ type: 'swipe', direction: 'left' });
    stopQc();

    expect(backSpy).not.toHaveBeenCalled();
    expect(indicatorEl()).toBeNull();
  });

  it('navigates back and forward in LTR/RTL with lazy edge indicator and cleanup', () => {
    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    expect(indicatorEl()).toBeNull();

    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    fireWheel({ deltaX: -30 });
    const pill = indicatorEl();
    expect(pill).not.toBeNull();
    expect(pill?.parentElement).toBe(document.body);
    expect(pill?.getAttribute('aria-hidden')).toBe('true');
    expect(pill?.querySelector('svg')?.hasAttribute('data-directional')).toBe(true);
    expect(pill?.dataset).toMatchObject({ direction: 'back', visible: 'true', armed: 'false' });

    fireWheel({ deltaX: -40 });
    fireWheel({ deltaX: -40 });
    expect(pill?.dataset.armed).toBe('true');

    emitShell({ type: 'scroll-gesture', phase: 'end' });
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(pill?.dataset.visible).toBe('false');

    runSwipe(FORWARD_SWIPE, { end: null });
    expect(pill?.dataset).toMatchObject({ direction: 'forward', armed: 'true' });
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    expect(forwardSpy).toHaveBeenCalledTimes(1);

    document.documentElement.dir = 'rtl';
    runSwipe(FORWARD_SWIPE, { end: null });
    expect(pill?.dataset.direction).toBe('back');
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    expect(backSpy).toHaveBeenCalledTimes(2);

    stop();
    expect(indicatorEl()).toBeNull();
  });

  it('reversing fingers disarms both steady release and fling', () => {
    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      // Arm to 120px, then reverse back to 20px before end
      runSwipe([{ deltaX: -40 }, { deltaX: -40 }, { deltaX: -40 }], { end: null });
      expect(indicatorEl()?.dataset.armed).toBe('true');
      fireWheel({ deltaX: 50 });
      fireWheel({ deltaX: 50 });
      expect(indicatorEl()?.dataset.armed).toBe('false');
      emitShell({ type: 'scroll-gesture', phase: 'end' });

      // Reach 80px, reverse slightly to 70px (lastNonZeroDelta < 0), then fling: must not commit
      runSwipe([{ deltaX: -30 }, { deltaX: -30 }, { deltaX: -20 }, { deltaX: 10 }], {
        end: 'fling',
      });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('commits on fling or momentum >= 55px without counting momentum delta and ignores momentum tail', () => {
    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      // Fling commit at 60px + momentum tail swallowed (even after popstate)
      runSwipe([{ deltaX: -20 }, { deltaX: -20 }, { deltaX: -20 }], { end: 'fling' });
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(indicatorEl()?.dataset.visible).toBe('false');

      window.dispatchEvent(new PopStateEvent('popstate'));
      fireWheel({ deltaX: -50 });
      fireWheel({ deltaX: -50 });
      fireWheel({ deltaX: -50 });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).toHaveBeenCalledTimes(1);

      // WheelEvent.momentum stops BEFORE counting momentum delta (40px + 80px momentum must not commit)
      runSwipe(
        [{ deltaX: -15 }, { deltaX: -15 }, { deltaX: -10 }, { deltaX: -80, momentum: true }],
        { end: 'fling' }
      );
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).toHaveBeenCalledTimes(1);

      // WheelEvent.momentum commits at 60px and subsequent fling does not double-navigate
      runSwipe(
        [{ deltaX: -20 }, { deltaX: -20 }, { deltaX: -20 }, { deltaX: -30, momentum: true }],
        { end: 'fling' }
      );
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it('handles IPC race when wheels arrive right before begin and cancels without begin after 100ms', () => {
    let clock = 1000;
    const stop = installDesktopHistorySwipe(window, {
      isMac: () => true,
      allowUntrusted: true,
      now: () => clock,
    });
    try {
      // 2 wheels arrive before begin within 100ms: deltas preserved, indicator deferred until begin
      fireWheel({ deltaX: -20 });
      clock += 20;
      fireWheel({ deltaX: -25 });
      expect(indicatorEl()).toBeNull();

      clock += 20;
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      expect(indicatorEl()?.dataset.visible).toBe('true');

      clock += 20;
      fireWheel({ deltaX: -60 });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).toHaveBeenCalledTimes(1);

      // Wheels without begin after 100ms cancel and never show indicator or commit
      clock += 500;
      fireWheel({ deltaX: -40 });
      clock += 110;
      fireWheel({ deltaX: -40 });
      fireWheel({ deltaX: -40 });
      fireWheel({ deltaX: -40, momentum: true });
      expect(indicatorEl()?.dataset.visible).toBe('false');
      expect(backSpy).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('respects horizontal scrollers mid-scroll vs at edge in LTR, RTL, and inputs', () => {
    const makeScroller = (tag: 'div' | 'input', width: number) => {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      Object.defineProperty(el, 'scrollWidth', { configurable: true, value: width });
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: 300 });
      return el;
    };
    const scroller = makeScroller('div', 800);
    const child = document.createElement('span');
    scroller.appendChild(child);

    const rtlScroller = makeScroller('div', 800);
    const rtlChild = document.createElement('span');
    rtlScroller.appendChild(rtlChild);

    const input = makeScroller('input', 600);

    mockComputedStyles(
      new Map<Element, Partial<CSSStyleDeclaration>>([
        [scroller, { overflowX: 'auto', direction: 'ltr' }],
        [rtlScroller, { overflowX: 'scroll', direction: 'rtl' }],
      ])
    );

    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      // LTR scroller mid-scroll: hitting scrollLeft=0 mid-gesture stays ignored
      scroller.scrollLeft = 40;
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      fireWheel({ deltaX: -20 }, child);
      scroller.scrollLeft = 0;
      fireWheel({ deltaX: -50 }, child);
      fireWheel({ deltaX: -50 }, child);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).not.toHaveBeenCalled();

      // Fresh swipe already at left edge chains into Back
      runSwipe(BACK_SWIPE, { target: child });
      expect(backSpy).toHaveBeenCalledTimes(1);

      // RTL scroller: scrollLeft in [-500, 0]. Mid-scroll (-100) blocks Back; at edge (0) chains
      document.documentElement.dir = 'rtl';
      rtlScroller.scrollLeft = -100;
      runSwipe(FORWARD_SWIPE, { target: rtlChild });
      expect(backSpy).toHaveBeenCalledTimes(1);

      rtlScroller.scrollLeft = 0;
      runSwipe(FORWARD_SWIPE, { target: rtlChild });
      expect(backSpy).toHaveBeenCalledTimes(2);

      // Input with horizontal overflow mid-scroll blocks swipe
      document.documentElement.dir = 'ltr';
      input.scrollLeft = 50;
      runSwipe(BACK_SWIPE, { target: input });
      expect(backSpy).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it('blocks overscroll-behavior-x: contain while allowing overscroll-behavior-y: contain', () => {
    const blocked = document.createElement('div');
    const allowed = document.createElement('div');
    document.body.append(blocked, allowed);
    mockComputedStyles(
      new Map<Element, Partial<CSSStyleDeclaration>>([
        [blocked, { overflowX: 'auto', overscrollBehaviorX: 'contain' }],
        [
          allowed,
          { overflowY: 'auto', overscrollBehaviorX: 'auto', overscrollBehaviorY: 'contain' },
        ],
      ])
    );

    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      runSwipe(BACK_SWIPE, { target: blocked });
      expect(backSpy).not.toHaveBeenCalled();

      runSwipe(BACK_SWIPE, { target: allowed });
      expect(backSpy).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('rejects modifiers, line-mode, defaultPrevented, untrusted, titlebar drag, diagonal drift, and swipe-tracking=false', () => {
    const drag = document.createElement('div');
    drag.setAttribute('data-titlebar-drag', '');
    document.body.appendChild(drag);

    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      const triple = (extra: WheelOpts): WheelOpts[] => [
        { deltaX: -50, ...extra },
        { deltaX: -50, ...extra },
        { deltaX: -50, ...extra },
      ];
      runSwipe(triple({ shiftKey: true }));
      runSwipe(triple({ ctrlKey: true }));
      runSwipe(triple({ deltaMode: WheelEvent.DOM_DELTA_LINE }));
      runSwipe(triple({ defaultPrevented: true }));
      runSwipe(BACK_SWIPE, { target: drag });
      // Lock horizontally, then drift diagonally past 30px
      runSwipe([
        { deltaX: -15, deltaY: 0 },
        { deltaX: -5, deltaY: 25 },
        { deltaX: -90, deltaY: 0 },
        { deltaX: -50, deltaY: 0 },
      ]);

      emitShell({ type: 'swipe-tracking', enabled: false });
      runSwipe(BACK_SWIPE);
      expect(backSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }

    // Without allowUntrusted, synthetic untrusted WheelEvents are rejected
    const stopStrict = installDesktopHistorySwipe(window, { isMac: () => true });
    try {
      runSwipe(BACK_SWIPE);
      expect(backSpy).not.toHaveBeenCalled();
    } finally {
      stopStrict();
    }
  });

  it('blocks dialogs, allows Back-only in ImageOverlay, and checks canGoBack/history fallback', () => {
    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.appendChild(dialog);
      runSwipe(BACK_SWIPE);
      expect(backSpy).not.toHaveBeenCalled();
      dialog.remove();

      const iv = document.createElement('div');
      iv.setAttribute('data-image-viewer-overlay', '');
      iv.innerHTML = '<div role="dialog"></div>';
      document.body.appendChild(iv);
      runSwipe(FORWARD_SWIPE);
      expect(forwardSpy).not.toHaveBeenCalled();
      runSwipe(BACK_SWIPE);
      expect(backSpy).toHaveBeenCalledTimes(1);

      // A menu opened on top of ImageOverlay blocks Back too
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      document.body.appendChild(menu);
      runSwipe(BACK_SWIPE);
      expect(backSpy).toHaveBeenCalledTimes(1);
      menu.remove();
      iv.remove();

      // canGoBack: false blocks Back
      setNavigation(false, false);
      runSwipe(BACK_SWIPE);
      expect(backSpy).toHaveBeenCalledTimes(1);

      // Without window.navigation, falls back to history.length > 1 for Back and false for Forward
      Reflect.deleteProperty(window, 'navigation');
      runSwipe(FORWARD_SWIPE);
      expect(forwardSpy).not.toHaveBeenCalled();
      runSwipe(BACK_SWIPE);
      expect(backSpy).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it('handles discrete AppKit swipe with RTL and deduplicates within 250ms of wheel commit', () => {
    let clock = 1000;
    const stop = installDesktopHistorySwipe(window, {
      isMac: () => true,
      allowUntrusted: true,
      now: () => clock,
    });
    try {
      emitShell({ type: 'swipe', direction: 'left' });
      expect(backSpy).toHaveBeenCalledTimes(1);
      emitShell({ type: 'swipe', direction: 'right' });
      expect(forwardSpy).toHaveBeenCalledTimes(1);

      document.documentElement.dir = 'rtl';
      emitShell({ type: 'swipe', direction: 'right' });
      expect(backSpy).toHaveBeenCalledTimes(2);
      document.documentElement.dir = 'ltr';

      runSwipe(BACK_SWIPE);
      expect(backSpy).toHaveBeenCalledTimes(3);

      clock += 200;
      emitShell({ type: 'swipe', direction: 'left' });
      expect(backSpy).toHaveBeenCalledTimes(3);

      clock += 100;
      emitShell({ type: 'swipe', direction: 'left' });
      expect(backSpy).toHaveBeenCalledTimes(4);
    } finally {
      stop();
    }
  });

  it('resets without committing on cancel, blur, window-hidden, popstate, visibilitychange, and 350ms watchdog', () => {
    vi.useFakeTimers();
    const stop = installDesktopHistorySwipe(window, { isMac: () => true, allowUntrusted: true });
    try {
      const startArmed = () => {
        runSwipe(BACK_SWIPE, { end: null });
        expect(indicatorEl()?.dataset.visible).toBe('true');
      };

      startArmed();
      emitShell({ type: 'scroll-gesture', phase: 'cancel' });
      expect(indicatorEl()?.dataset.visible).toBe('false');

      startArmed();
      window.dispatchEvent(new Event('blur'));
      expect(indicatorEl()?.dataset.visible).toBe('false');

      startArmed();
      emitShell({ type: 'window-hidden' });
      expect(indicatorEl()?.dataset.visible).toBe('false');

      startArmed();
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(indicatorEl()?.dataset.visible).toBe('false');

      startArmed();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      expect(indicatorEl()?.dataset.visible).toBe('false');

      startArmed();
      vi.advanceTimersByTime(350);
      expect(indicatorEl()?.dataset.visible).toBe('false');
      emitShell({ type: 'scroll-gesture', phase: 'end' });

      expect(backSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
