import type { DesktopShellEvent } from '../lib/desktopBridge';
import { desktopBridge, isDesktopApp } from '../lib/nativeShell';
import { hasOpenOverlay } from '../lib/openOverlay';
import { isMacOS } from '../lib/user-agent';
import { isQuickCapturePath } from '../routes/pathUtils';
import { documentIsRightToLeft } from '../ui/directional';
import { SwipeChevron, SwipeIndicator } from './desktopHistorySwipe.css';
import { trackpadSwipeClaimers, type TrackpadSwipeClaim } from './trackpadSwipeClaim';

export {
  registerTrackpadSwipeClaimer,
  type TrackpadSwipeCandidate,
  type TrackpadSwipeClaim,
  type TrackpadSwipeClaimer,
} from './trackpadSwipeClaim';

type Dir = 'back' | 'forward';
type NavWindow = Window & { navigation?: { canGoBack?: boolean; canGoForward?: boolean } };
type SwipeGesture =
  | { kind: 'pending'; path: Element[]; x: number; y: number; n: number }
  | { kind: 'track'; dir: Dir; rtl: boolean; dist: number; x: number; y: number; n: number }
  | { kind: 'claimed'; claim: TrackpadSwipeClaim }
  | { kind: 'ignored' };

const CFG = { lock: 12, ratio: 1.5, diag: 30, commit: 80, min: 3, dedup: 250 };
const SCROLL_BOX = new Set(['auto', 'scroll', 'hidden']);
const CHEVRON_D = { back: 'M14.5 6.5L9 12l5.5 5.5', forward: 'M9.5 6.5L15 12l-5.5 5.5' };
const IGNORED: SwipeGesture = { kind: 'ignored' };

const canGo = (target: Window, dir: Dir): boolean => {
  const nav = (target as NavWindow).navigation;
  if (!(dir === 'back' ? (nav?.canGoBack ?? target.history.length > 1) : nav?.canGoForward))
    return false;
  if (!hasOpenOverlay()) return true;
  const iv = dir === 'back' ? target.document.querySelector('[data-image-viewer-overlay]') : null;
  return Boolean(iv && !hasOpenOverlay(iv));
};

const pathOf = (e: WheelEvent): Element[] => {
  const els = e.composedPath().filter((n): n is Element => n instanceof Element);
  if (els.length > 0) return els;
  for (let n = e.target instanceof Node ? e.target : null; n; n = n.parentNode)
    if (n instanceof Element) els.push(n);
  return els;
};

const isBlockedByDom = (target: Window, path: Iterable<Element>): boolean => {
  const { documentElement, body } = target.document;
  for (const el of path) {
    const s = target.getComputedStyle(el);
    const [ox, oy] = [s.overflowX || s.overflow, s.overflowY || s.overflow];
    const box = el === documentElement || el === body || SCROLL_BOX.has(ox) || SCROLL_BOX.has(oy);
    if (box && /^(contain|none)$/.test(s.overscrollBehaviorX)) return true;
    const scroller = ox === 'auto' || ox === 'scroll' || el.matches('input,textarea');
    if (scroller && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
};

const createIndicator = (doc: Document) => {
  let root: HTMLDivElement | undefined;
  return {
    update: ({ dir, dist, n, rtl }: Extract<SwipeGesture, { kind: 'track' }>): void => {
      if (!root) {
        if (!doc.body) return;
        root = doc.createElement('div');
        root.className = SwipeIndicator;
        root.setAttribute('aria-hidden', 'true');
        root.dataset.desktopHistorySwipe = '';
        root.innerHTML = `<svg class="${SwipeChevron}" viewBox="0 0 24 24" aria-hidden="true" data-directional=""><path/></svg>`;
        doc.body.append(root);
      }
      const p = Math.min(1, Math.max(0, dist / CFG.commit));
      const sign = (dir === 'back') !== rtl ? -1 : 1;
      const armed = dist >= CFG.commit && n >= CFG.min;
      Object.assign(root.dataset, { direction: dir, armed: String(armed), visible: 'true' });
      root.style.setProperty('--swipe-offset', `${Math.round(sign * (1 - p) * 24)}px`);
      root.style.setProperty('--swipe-opacity', (0.35 + p * 0.65).toFixed(2));
      root.querySelector('path')?.setAttribute('d', CHEVRON_D[dir]);
    },
    hide: () => root && Object.assign(root.dataset, { visible: 'false', armed: 'false' }),
    destroy: (): void => {
      root?.remove();
      root = undefined;
    },
  };
};

/** Enables macOS trackpad swipe arbitration and back/forward history swipe in Electron. */
export const installDesktopHistorySwipe = (
  target: Window,
  options: { isMac?: () => boolean; allowUntrusted?: boolean; now?: () => number } = {}
): (() => void) => {
  const bridge = desktopBridge();
  const isMac = options.isMac ?? isMacOS;
  if (!isDesktopApp() || !bridge || !isMac() || isQuickCapturePath(target.location.pathname))
    return () => undefined;
  const { allowUntrusted = false, now = () => Date.now() } = options;
  const { document: doc, history } = target;
  const indicator = createIndicator(doc);
  let enabled = false;
  let inTouchGesture = false;
  let pendingEndRaf: number | null = null;
  let lastCommitAt = -Infinity;
  let gesture: SwipeGesture | null = null;
  const isActive = (): boolean => enabled || trackpadSwipeClaimers.size > 0;
  const clearPendingEnd = (): void => {
    if (pendingEndRaf !== null) {
      target.cancelAnimationFrame(pendingEndRaf);
      pendingEndRaf = null;
    }
  };
  const reset = (next: SwipeGesture | null = null): void => {
    const g = gesture;
    gesture = next;
    indicator.hide();
    if (g?.kind === 'claimed') g.claim.cancel();
  };
  const abortTouch = (): void => {
    clearPendingEnd();
    inTouchGesture = false;
    reset(null);
  };
  const finish = (next: SwipeGesture | null): void => {
    const g = gesture;
    gesture = next;
    indicator.hide();
    if (g?.kind === 'claimed') {
      g.claim.end();
    } else if (
      g?.kind === 'track' &&
      enabled &&
      g.n >= CFG.min &&
      g.dist >= CFG.commit &&
      canGo(target, g.dir)
    ) {
      lastCommitAt = now();
      history[g.dir]();
    }
  };
  const onShellEvent = (e: DesktopShellEvent): void => {
    if (e.type === 'swipe-tracking') {
      enabled = e.enabled;
      if (!isActive()) abortTouch();
      else if (!enabled && gesture?.kind === 'track') reset(null);
    } else if (e.type === 'window-hidden') {
      abortTouch();
      trackpadSwipeClaimers.forEach((c) => c.onWindowHidden?.());
    } else if (e.type === 'swipe') {
      if (gesture?.kind === 'claimed') return;
      const dir: Dir = (e.direction === 'left') !== documentIsRightToLeft() ? 'back' : 'forward';
      if (now() - lastCommitAt > CFG.dedup && canGo(target, dir)) {
        abortTouch();
        history[dir]();
      }
    } else if (e.type === 'scroll-gesture') {
      if (e.phase === 'begin') {
        if (pendingEndRaf !== null) {
          clearPendingEnd();
          finish(null);
        } else {
          reset(null);
        }
        inTouchGesture = true;
      } else if (e.phase === 'cancel') {
        abortTouch();
      } else if (
        (gesture?.kind === 'track' && gesture.n >= CFG.min && gesture.dist >= CFG.commit) ||
        (gesture?.kind === 'claimed' && gesture.claim.isReadyToCommit?.())
      ) {
        clearPendingEnd();
        inTouchGesture = false;
        finish(null);
      } else if (gesture?.kind === 'ignored' || !isActive()) {
        abortTouch();
      } else if (inTouchGesture && pendingEndRaf === null) {
        pendingEndRaf = target.requestAnimationFrame(() => {
          pendingEndRaf = null;
          inTouchGesture = false;
          finish(null);
        });
      }
    }
  };
  const onWheel = (e: WheelEvent): void => {
    if (
      (!allowUntrusted && !e.isTrusted) ||
      !isActive() ||
      !inTouchGesture ||
      e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
    )
      return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
      return reset(IGNORED);
    if (gesture?.kind === 'ignored') return;
    if ((e as WheelEvent & { momentum?: boolean }).momentum) return finish(IGNORED);
    const path = pathOf(e);
    if (path.some((el) => el.hasAttribute('data-titlebar-drag'))) return reset(IGNORED);
    if (e.deltaX === 0 && e.deltaY === 0) return;
    if (gesture?.kind === 'claimed') {
      gesture.claim.move(e.deltaX, e.deltaY);
      return;
    }
    const g = gesture ?? (gesture = { kind: 'pending', path, x: 0, y: 0, n: 0 });
    if (g.kind === 'pending') {
      g.x += e.deltaX;
      g.y += e.deltaY;
      g.n += 1;
      if (Math.hypot(g.x, g.y) < CFG.lock) return;
      const combinedPath = [...new Set([...g.path, ...path])];
      if (Math.abs(g.y) >= Math.abs(g.x)) {
        trackpadSwipeClaimers.forEach((c) => c.onVerticalScroll?.(combinedPath));
        return reset(IGNORED);
      }
      if (Math.abs(g.x) < Math.abs(g.y) * CFG.ratio) return reset(IGNORED);
      const rtl = documentIsRightToLeft();
      const blockedByDom = isBlockedByDom(target, combinedPath);
      for (const claimer of trackpadSwipeClaimers) {
        const claim = claimer.claim({
          path: combinedPath,
          deltaX: g.x,
          deltaY: g.y,
          rtl,
          blockedByDom,
        });
        if (claim) {
          gesture = { kind: 'claimed', claim };
          return;
        }
      }
      const dir: Dir = g.x < 0 !== rtl ? 'back' : 'forward';
      if (!enabled || blockedByDom || !canGo(target, dir)) return reset(IGNORED);
      const x = Math.abs(g.x);
      gesture = { kind: 'track', dir, rtl, dist: x, x, y: Math.abs(g.y), n: g.n };
      return indicator.update(gesture);
    }
    g.dist = Math.max(0, g.dist + ((g.dir === 'forward') !== g.rtl ? e.deltaX : -e.deltaX));
    g.x += Math.abs(e.deltaX);
    g.y += Math.abs(e.deltaY);
    g.n += 1;
    if (g.x + g.y >= CFG.diag && g.x < g.y * CFG.ratio) return reset(IGNORED);
    indicator.update(g);
  };
  const ac = new AbortController();
  const opts = { signal: ac.signal };
  const stopShell = bridge.onShellEvent(onShellEvent);
  target.addEventListener('wheel', onWheel, { passive: true, ...opts });
  target.addEventListener('blur', abortTouch, opts);
  target.addEventListener('popstate', () => gesture?.kind !== 'ignored' && abortTouch(), opts);
  doc.addEventListener(
    'visibilitychange',
    () => doc.visibilityState === 'hidden' && abortTouch(),
    opts
  );
  return () => {
    abortTouch();
    stopShell();
    ac.abort();
    indicator.destroy();
  };
};
