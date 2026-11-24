import type { DesktopShellEvent } from '../lib/desktopBridge';
import { desktopBridge, isDesktopApp } from '../lib/nativeShell';
import { hasOpenOverlay } from '../lib/openOverlay';
import { isMacOS } from '../lib/user-agent';
import { isQuickCapturePath } from '../routes/pathUtils';
import { documentIsRightToLeft } from '../ui/directional';
import { SwipeChevron, SwipeIndicator } from './desktopHistorySwipe.css';

type HistoryDirection = 'back' | 'forward';
type GesturePhase = 'idle' | 'pending' | 'tracking' | 'ignored' | 'committed';
type NavigationWindow = Window & { navigation?: { canGoBack?: boolean; canGoForward?: boolean } };
type MomentumWheelEvent = WheelEvent & { momentum?: boolean };

export type DesktopHistorySwipeOptions = {
  isMac?: () => boolean;
  allowUntrusted?: boolean;
  now?: () => number;
};

const AXIS_LOCK_PX = 12;
const AXIS_RATIO = 1.5;
const DIAGONAL_CHECK_PX = 30;
const COMMIT_PX = 100;
const FLING_COMMIT_PX = 55;
const MIN_EVENTS = 3;
const BEGIN_RACE_MS = 100;
const INACTIVITY_MS = 350;
const SWIPE_DEDUP_MS = 250;
const SCROLL_BOX = new Set(['auto', 'scroll', 'hidden']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHEVRON_D: Record<HistoryDirection, string> = {
  back: 'M14.5 6.5L9 12l5.5 5.5',
  forward: 'M9.5 6.5L15 12l-5.5 5.5',
};

const signedDelta = (dx: number, dir: HistoryDirection, rtl: boolean): number =>
  (rtl ? dir === 'back' : dir === 'forward') ? dx : -dx;

const canNavigate = (target: Window, dir: HistoryDirection): boolean => {
  const nav = (target as NavigationWindow).navigation;
  if (dir === 'back')
    return typeof nav?.canGoBack === 'boolean' ? nav.canGoBack : target.history.length > 1;
  return typeof nav?.canGoForward === 'boolean' ? nav.canGoForward : false;
};

const allowNavigation = (target: Window, dir: HistoryDirection): boolean => {
  if (!hasOpenOverlay()) return true;
  if (dir !== 'back') return false;
  const iv = target.document.querySelector('[data-image-viewer-overlay]');
  return Boolean(iv && !hasOpenOverlay(iv));
};

const pathElementsOf = (target: Window, event: WheelEvent): Element[] => {
  const path = event.composedPath().filter((n): n is Element => n instanceof Element);
  if (path.length > 0) return path;
  const out: Element[] = [];
  for (let n = event.target instanceof Node ? event.target : null; n; n = n.parentNode) {
    if (n instanceof Element) out.push(n);
  }
  if (out.length === 0) {
    if (target.document.body) out.push(target.document.body);
    if (target.document.documentElement) out.push(target.document.documentElement);
  }
  return out;
};

const isBlockedByDom = (target: Window, elements: Iterable<Element>, sumX: number): boolean => {
  const { documentElement, body } = target.document;
  for (const el of elements) {
    const style = target.getComputedStyle(el);
    const ox = style.overflowX || style.overflow;
    const oy = style.overflowY || style.overflow;
    const scrollBox =
      el === documentElement || el === body || SCROLL_BOX.has(ox) || SCROLL_BOX.has(oy);
    if (
      scrollBox &&
      (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none')
    ) {
      return true;
    }
    const scroller =
      ox === 'auto' ||
      ox === 'scroll' ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement;
    if (scroller && el.scrollWidth > el.clientWidth + 1) {
      const max = el.scrollWidth - el.clientWidth;
      const rtl = style.direction === 'rtl';
      const minL = rtl ? -max : 0;
      const maxL = rtl ? 0 : max;
      if (sumX < 0 ? el.scrollLeft > minL + 1 : el.scrollLeft < maxL - 1) return true;
    }
  }
  return false;
};

const createIndicator = (target: Window) => {
  let root: HTMLDivElement | undefined;
  let path: SVGPathElement | undefined;

  return {
    update: (dir: HistoryDirection, dist: number, armed: boolean, rtl: boolean): void => {
      if (!root) {
        const { body } = target.document;
        if (!body) return;
        root = target.document.createElement('div');
        root.className = SwipeIndicator;
        root.setAttribute('aria-hidden', 'true');
        root.dataset.desktopHistorySwipe = '';
        const svg = target.document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', SwipeChevron);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('data-directional', '');
        path = target.document.createElementNS(SVG_NS, 'path');
        svg.appendChild(path);
        root.appendChild(svg);
        body.appendChild(root);
      }
      const p = Math.min(1, Math.max(0, dist / COMMIT_PX));
      const sign = (dir === 'back') !== rtl ? -1 : 1;
      Object.assign(root.dataset, { direction: dir, armed: String(armed), visible: 'true' });
      root.style.setProperty('--swipe-offset', `${Math.round(sign * (1 - p) * 24)}px`);
      root.style.setProperty('--swipe-opacity', (0.35 + p * 0.65).toFixed(2));
      path?.setAttribute('d', CHEVRON_D[dir]);
    },
    hide: (): void => {
      if (root) Object.assign(root.dataset, { visible: 'false', armed: 'false' });
    },
    destroy: (): void => {
      root?.remove();
      root = undefined;
      path = undefined;
    },
  };
};

const emptyGesture = (phase: GesturePhase = 'idle') => ({
  phase,
  hasBegin: false,
  startedAt: 0,
  startElements: [] as Element[],
  sumX: 0,
  sumY: 0,
  travelX: 0,
  travelY: 0,
  eventCount: 0,
  lastNonZeroDelta: 0,
  direction: 'back' as HistoryDirection,
  rtl: false,
  distance: 0,
});

/**
 * Enables macOS two-finger trackpad scroll-gesture and discrete AppKit swipe history navigation
 * in the Electron main window, with a subtle edge chevron indicator.
 */
export const installDesktopHistorySwipe = (
  target: Window,
  options: DesktopHistorySwipeOptions = {}
): (() => void) => {
  const bridge = desktopBridge();
  if (
    !isDesktopApp() ||
    !bridge ||
    !(options.isMac ?? isMacOS)() ||
    isQuickCapturePath(target.location.pathname)
  ) {
    return () => undefined;
  }

  const allowUntrusted = options.allowUntrusted ?? false;
  const now = options.now ?? (() => Date.now());
  const indicator = createIndicator(target);

  let swipeTrackingEnabled = true;
  let pendingBegin = false;
  let lastWheelCommitAt = -Infinity;
  let g = emptyGesture();
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;

  const isActive = (): boolean => g.phase === 'pending' || g.phase === 'tracking';

  const armWatchdog = (): void => {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => reset('idle'), INACTIVITY_MS);
  };

  const reset = (phase: 'idle' | 'ignored' | 'committed' = 'idle'): void => {
    clearTimeout(watchdogTimer);
    watchdogTimer = undefined;
    pendingBegin = false;
    g = emptyGesture(phase);
    indicator.hide();
    if (phase !== 'idle') armWatchdog();
  };

  const renderIndicator = (): void => {
    if (g.hasBegin && g.phase === 'tracking') {
      indicator.update(
        g.direction,
        g.distance,
        g.distance >= COMMIT_PX && g.eventCount >= MIN_EVENTS,
        g.rtl
      );
    }
  };

  const navigate = (dir: HistoryDirection): void =>
    dir === 'back' ? target.history.back() : target.history.forward();

  const finishTracking = (viaFlingOrMomentum: boolean, endToIdle: boolean): void => {
    const dir = g.direction;
    const commit =
      g.phase === 'tracking' &&
      g.hasBegin &&
      g.eventCount >= MIN_EVENTS &&
      (g.distance >= COMMIT_PX ||
        (viaFlingOrMomentum && g.distance >= FLING_COMMIT_PX && g.lastNonZeroDelta > 0)) &&
      allowNavigation(target, dir) &&
      canNavigate(target, dir);
    if (commit) {
      lastWheelCommitAt = now();
      reset(endToIdle ? 'idle' : 'committed');
      navigate(dir);
    } else {
      reset(endToIdle ? 'idle' : 'ignored');
    }
  };

  const onShellEvent = (event: DesktopShellEvent): void => {
    if (event.type === 'swipe-tracking') {
      swipeTrackingEnabled = event.enabled;
      if (!swipeTrackingEnabled) reset('idle');
      return;
    }
    if (event.type === 'window-hidden') {
      reset('idle');
      return;
    }
    if (event.type === 'swipe') {
      if (now() - lastWheelCommitAt <= SWIPE_DEDUP_MS) return;
      const dir: HistoryDirection = (
        documentIsRightToLeft() ? event.direction === 'right' : event.direction === 'left'
      )
        ? 'back'
        : 'forward';
      if (!allowNavigation(target, dir) || !canNavigate(target, dir)) return;
      reset('idle');
      navigate(dir);
      return;
    }
    if (event.type !== 'scroll-gesture') return;

    if (event.phase === 'begin') {
      if (isActive() && !g.hasBegin && now() - g.startedAt < BEGIN_RACE_MS) {
        g.hasBegin = true;
        armWatchdog();
        renderIndicator();
      } else {
        reset('idle');
        if (swipeTrackingEnabled) {
          pendingBegin = true;
          armWatchdog();
        }
      }
    } else if (event.phase === 'fling') {
      if (g.phase === 'tracking') finishTracking(true, false);
      else if (g.phase === 'pending' || pendingBegin) reset('ignored');
      else if (g.phase === 'committed' || g.phase === 'ignored') armWatchdog();
    } else if (event.phase === 'end') {
      if (g.phase === 'tracking') finishTracking(false, true);
      else reset('idle');
    } else if (event.phase === 'cancel') {
      reset('idle');
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (
      (!allowUntrusted && !event.isTrusted) ||
      !swipeTrackingEnabled ||
      event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
    ) {
      return;
    }
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      if (isActive() || pendingBegin) reset('ignored');
      return;
    }
    if (g.phase === 'committed' || g.phase === 'ignored') {
      armWatchdog();
      return;
    }
    if (isActive() && !g.hasBegin && now() - g.startedAt >= BEGIN_RACE_MS) {
      reset('ignored');
      return;
    }
    if ((event as MomentumWheelEvent).momentum) {
      if (g.phase === 'tracking') finishTracking(true, false);
      else if (g.phase === 'pending' || pendingBegin) reset('ignored');
      return;
    }

    const path = pathElementsOf(target, event);
    if (path.some((el) => el.hasAttribute('data-titlebar-drag'))) {
      if (isActive() || pendingBegin) reset('ignored');
      return;
    }
    if (event.deltaX === 0 && event.deltaY === 0) {
      if (isActive()) armWatchdog();
      return;
    }

    if (g.phase === 'idle') {
      g = {
        ...emptyGesture('pending'),
        hasBegin: pendingBegin,
        startedAt: now(),
        startElements: path,
      };
      pendingBegin = false;
    }

    armWatchdog();
    g.travelX += Math.abs(event.deltaX);
    g.travelY += Math.abs(event.deltaY);
    g.eventCount += 1;

    if (g.phase === 'pending') {
      g.sumX += event.deltaX;
      g.sumY += event.deltaY;
      if (event.deltaX !== 0) g.lastNonZeroDelta = event.deltaX;
      if (Math.hypot(g.sumX, g.sumY) < AXIS_LOCK_PX) return;
      if (
        Math.abs(g.sumX) < Math.abs(g.sumY) * AXIS_RATIO ||
        isBlockedByDom(target, new Set([...g.startElements, ...path]), g.sumX)
      ) {
        reset('ignored');
        return;
      }
      g.rtl = documentIsRightToLeft();
      g.direction = (g.rtl ? g.sumX > 0 : g.sumX < 0) ? 'back' : 'forward';
      if (!allowNavigation(target, g.direction) || !canNavigate(target, g.direction)) {
        reset('ignored');
        return;
      }
      g.phase = 'tracking';
      g.distance = Math.max(0, signedDelta(g.sumX, g.direction, g.rtl));
      g.lastNonZeroDelta = signedDelta(g.lastNonZeroDelta, g.direction, g.rtl);
      renderIndicator();
      return;
    }

    const delta = signedDelta(event.deltaX, g.direction, g.rtl);
    g.distance = Math.max(0, g.distance + delta);
    if (delta !== 0) g.lastNonZeroDelta = delta;
    if (g.travelX + g.travelY >= DIAGONAL_CHECK_PX && g.travelX < g.travelY * AXIS_RATIO) {
      reset('ignored');
      return;
    }
    renderIndicator();
  };

  const onBlur = (): void => reset('idle');
  const onPopState = (): void => {
    if (g.phase !== 'committed') reset('idle');
  };
  const onVisibilityChange = (): void => {
    if (target.document.visibilityState === 'hidden') reset('idle');
  };

  const stopShellEvents = bridge.onShellEvent(onShellEvent);
  target.addEventListener('wheel', onWheel, { passive: true });
  target.addEventListener('blur', onBlur);
  target.addEventListener('popstate', onPopState);
  target.document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    reset('idle');
    stopShellEvents();
    target.removeEventListener('wheel', onWheel);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('popstate', onPopState);
    target.document.removeEventListener('visibilitychange', onVisibilityChange);
    indicator.destroy();
  };
};
