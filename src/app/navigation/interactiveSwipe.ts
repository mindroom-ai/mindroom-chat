import './interactiveSwipe.css';
import { type MutableRefObject, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { hasOpenOverlay } from '../lib/openOverlay';
import { isIOSStandaloneWebApp } from '../native/nativeSso';
import {
  createSwipeTracker,
  EDGE_DISCRETE_MIN_PX,
  EDGE_START_MAX_X,
  MAX_VERTICAL_DRIFT,
  PANEL_DISCRETE_MIN_PX,
  type SwipeTracker,
} from './interactiveSwipeMath';

export const SWIPE_PRIORITY = {
  DRAWER_OPEN: 50,
  PAGE: 100,
  PANEL: 200,
  PANEL_INNER: 300,
  SHEET: 400,
  OVERLAY: 500,
} as const;

export type SwipeEdge = 'start' | 'end';
export type SwipeDirection = 'inward' | 'toward-edge';

export type InteractiveSwipeScene = {
  extent: number;
  update(offsetPx: number, progress: number): void;
  settle(commit: boolean, durationMs: number, currentOffsetPx: number): Promise<void>;
  commit(): void;
  cleanup(committed: boolean): void;
};

export type InteractiveSwipeBeginContext = {
  axisSign: 1 | -1;
  dirSign: 1 | -1;
};

export type InteractiveSwipeBegin = (
  ctx: InteractiveSwipeBeginContext
) => InteractiveSwipeScene | null;

export interface InteractiveSwipeOptions {
  zone: 'edge' | 'element';
  edge: SwipeEdge;
  direction: SwipeDirection;
  priority: number;
  enabled: boolean;
  elementRef?: RefObject<HTMLElement>;
  within?: RefObject<Element>;
  blockStandaloneWebApp?: boolean;
  cancelCommits?: boolean;
  onCommit: () => void;
  begin?: InteractiveSwipeBegin;
}

const HANDLED_EVENT_FLAG = '__mindroomEdgeSwipeHandled';

type TouchEventWithFlag = TouchEvent & {
  [HANDLED_EVENT_FLAG]?: boolean;
};

type SwipeRegistration = {
  id: number;
  zone: 'edge' | 'element';
  edge: SwipeEdge;
  direction: SwipeDirection;
  priority: number;
  elementRef?: RefObject<HTMLElement>;
  within?: RefObject<Element>;
  blockStandaloneWebApp: boolean;
  cancelCommits: boolean;
  onCommitRef: MutableRefObject<() => void>;
  beginRef: MutableRefObject<InteractiveSwipeBegin | undefined>;
};

type ActiveGesture = {
  entry: SwipeRegistration;
  tracker: SwipeTracker;
  axisSign: 1 | -1;
  dirSign: 1 | -1;
  overlayScope: Element | null | undefined;
  scene: InteractiveSwipeScene | null;
  sceneBegun: boolean;
  lockedOnce: boolean;
  cleanedUp: boolean;
  rafId: number | null;
  pendingFrame: { offset: number; progress: number } | null;
};

type ActiveSettle = {
  token: number;
  gesture: ActiveGesture;
};

const edgeEntries = new Set<SwipeRegistration>();
const elementEntries = new Set<SwipeRegistration>();
const claimedTouchStartEvents = new WeakSet<Event>();

let nextRegistrationId = 1;
let settleCounter = 0;
let activeGesture: ActiveGesture | null = null;
let activeSettle: ActiveSettle | null = null;
let clearPendingClickSuppressor: (() => void) | null = null;

let attachedEdgeWindow: Window | null = null;
let attachedInterruptWindow: Window | null = null;
let attachedInterruptDocument: Document | null = null;

export const resolveLogicalDirectionSign = (element?: Element | null): 1 | -1 => {
  if (typeof document === 'undefined') return 1;
  if (element) {
    const inlineDir = (element as HTMLElement).style?.direction;
    if (inlineDir === 'rtl') return -1;
    if (inlineDir === 'ltr') return 1;

    const closestDir = element.closest?.('[dir]')?.getAttribute('dir');
    if (closestDir === 'rtl') return -1;
    if (closestDir === 'ltr') return 1;

    const computed =
      typeof getComputedStyle === 'function' ? getComputedStyle(element).direction : '';
    if (computed === 'rtl') return -1;
  }

  if (document.documentElement?.dir === 'rtl') return -1;
  if (
    document.documentElement &&
    typeof getComputedStyle === 'function' &&
    getComputedStyle(document.documentElement).direction === 'rtl'
  ) {
    return -1;
  }
  return 1;
};

export const isReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
};

const applyKeyframeStyles = (element: HTMLElement, frame: Keyframe | undefined) => {
  if (!frame) return;
  for (const [key, value] of Object.entries(frame)) {
    if (key === 'offset' || key === 'easing' || key === 'composite' || value == null) {
      continue;
    }
    if (key.includes('-')) {
      element.style.setProperty(key, String(value));
    } else {
      (element.style as unknown as Record<string, string>)[key] = String(value);
    }
  }
};

export const animateSwipeElements = async (
  animations: ReadonlyArray<{ element: HTMLElement; keyframes: Keyframe[] }>,
  durationMs: number
): Promise<void> => {
  if (animations.length === 0) return;

  const reduced = isReducedMotion();
  const started: Array<{
    anim: Animation;
    element: HTMLElement;
    finalFrame: Keyframe | undefined;
  }> = [];

  for (const { element, keyframes } of animations) {
    const finalFrame = keyframes[keyframes.length - 1];
    if (
      durationMs <= 0 ||
      reduced ||
      keyframes.length === 0 ||
      typeof element.animate !== 'function'
    ) {
      applyKeyframeStyles(element, finalFrame);
      continue;
    }

    const anim = element.animate(keyframes, {
      duration: durationMs,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards',
    });
    started.push({ anim, element, finalFrame });
  }

  if (started.length === 0) return;

  try {
    await Promise.allSettled(started.map(({ anim }) => Promise.resolve(anim?.finished)));
  } finally {
    for (const { anim, element, finalFrame } of started) {
      applyKeyframeStyles(element, finalFrame);
      try {
        anim.cancel?.();
      } catch {
        // Ignore cancellation errors on detached or mocked animations.
      }
    }
  }
};

const getEventTimeMs = (event: Event): number =>
  typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now();

const resolveAxisGeometry = (
  edge: SwipeEdge,
  direction: SwipeDirection,
  dirSign: 1 | -1
): { isPhysicalLeftEdge: boolean; axisSign: 1 | -1 } => {
  const isPhysicalLeftEdge = (edge === 'start') === (dirSign === 1);
  const inwardSign: 1 | -1 = isPhysicalLeftEdge ? 1 : -1;
  const axisSign: 1 | -1 = direction === 'inward' ? inwardSign : ((-inwardSign) as 1 | -1);
  return { isPhysicalLeftEdge, axisSign };
};

const isInEdgeBand = (x: number, isPhysicalLeftEdge: boolean): boolean => {
  if (isPhysicalLeftEdge) return x <= EDGE_START_MAX_X;
  const viewportWidth =
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth
      : 0;
  return x >= viewportWidth - EDGE_START_MAX_X;
};

const sortByPriorityDesc = (entries: Iterable<SwipeRegistration>): SwipeRegistration[] =>
  Array.from(entries).sort((a, b) => b.priority - a.priority || b.id - a.id);

const scheduleAnimationFrame = (cb: () => void): number | null => {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(cb);
  }
  cb();
  return null;
};

const cancelScheduledAnimationFrame = (id: number | null) => {
  if (id === null) return;
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id);
  }
};

const armClickSuppressor = () => {
  clearPendingClickSuppressor?.();
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  const targetWindow = window;
  let cleaned = false;

  const suppressClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    cleanup();
  };

  const timerId = setTimeout(() => cleanup(), 0);

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timerId);
    targetWindow.removeEventListener('click', suppressClick, true);
    if (clearPendingClickSuppressor === cleanup) {
      clearPendingClickSuppressor = null;
    }
  };

  targetWindow.addEventListener('click', suppressClick, true);
  clearPendingClickSuppressor = cleanup;
};

const cleanupGestureImmediate = (gesture: ActiveGesture) => {
  cancelScheduledAnimationFrame(gesture.rafId);
  gesture.rafId = null;
  gesture.pendingFrame = null;
  if (gesture.scene && !gesture.cleanedUp) {
    gesture.cleanedUp = true;
    gesture.scene.cleanup(false);
  }
};

const abortActiveGesture = () => {
  if (!activeGesture) return;
  const gesture = activeGesture;
  activeGesture = null;
  cleanupGestureImmediate(gesture);
};

const abortActiveSettle = () => {
  if (!activeSettle) return;
  const { gesture } = activeSettle;
  activeSettle = null;
  cleanupGestureImmediate(gesture);
};

const abortAll = () => {
  abortActiveGesture();
  abortActiveSettle();
};

const abortEntry = (entry: SwipeRegistration) => {
  if (activeGesture?.entry === entry) {
    abortActiveGesture();
  }
  if (activeSettle?.gesture.entry === entry) {
    abortActiveSettle();
  }
};

const startGesture = (
  entry: SwipeRegistration,
  touch: Touch,
  timeMs: number,
  axisSign: 1 | -1,
  dirSign: 1 | -1
) => {
  const discreteMinPx =
    entry.zone === 'edge' ? EDGE_DISCRETE_MIN_PX : PANEL_DISCRETE_MIN_PX;
  const overlayScope =
    entry.zone === 'element' ? entry.elementRef?.current : entry.within?.current;

  activeGesture = {
    entry,
    tracker: createSwipeTracker({
      startX: touch.clientX,
      startY: touch.clientY,
      startTimeMs: timeMs,
      axisSign,
      discreteMinPx,
    }),
    axisSign,
    dirSign,
    overlayScope,
    scene: null,
    sceneBegun: false,
    lockedOnce: false,
    cleanedUp: false,
    rafId: null,
    pendingFrame: null,
  };
};

const handleActiveMove = (event: TouchEventWithFlag, gesture: ActiveGesture) => {
  if (gesture.entry.zone === 'edge' && event[HANDLED_EVENT_FLAG]) return;

  if (event.touches.length !== 1 || hasOpenOverlay(gesture.overlayScope)) {
    abortActiveGesture();
    return;
  }

  const touch = event.touches[0];
  if (!touch) {
    abortActiveGesture();
    return;
  }

  const x = touch.clientX;
  const y = touch.clientY;
  const timeMs = getEventTimeMs(event);
  const prevState = gesture.tracker.state;
  const nextState = gesture.tracker.move(x, y, timeMs, gesture.scene ? gesture.scene.extent : 0);

  if (nextState === 'yielded') {
    abortActiveGesture();
    return;
  }

  if (prevState === 'pending' && nextState === 'locked' && !gesture.sceneBegun) {
    gesture.sceneBegun = true;
    if (!isReducedMotion() && gesture.entry.beginRef.current) {
      const created = gesture.entry.beginRef.current({
        axisSign: gesture.axisSign,
        dirSign: gesture.dirSign,
      });
      if (created && created.extent > 0) {
        gesture.scene = created;
        // Recompute clamped offset/progress with the scene's real extent.
        gesture.tracker.move(x, y, timeMs, created.extent);
      } else if (created) {
        created.cleanup(false);
      }
    }
  }

  if (nextState !== 'locked') return;

  gesture.lockedOnce = true;

  if (gesture.scene || gesture.tracker.maxDriftY <= MAX_VERTICAL_DRIFT) {
    if (event.cancelable !== false) {
      event.preventDefault?.();
    }
  }

  if (gesture.entry.zone === 'edge') {
    event[HANDLED_EVENT_FLAG] = true;
  }

  if (gesture.scene) {
    gesture.pendingFrame = {
      offset: gesture.tracker.offset,
      progress: gesture.tracker.progress,
    };
    if (gesture.rafId === null) {
      gesture.rafId = scheduleAnimationFrame(() => {
        if (activeGesture !== gesture) return;
        gesture.rafId = null;
        if (gesture.cleanedUp || !gesture.scene || !gesture.pendingFrame) return;
        const { offset, progress } = gesture.pendingFrame;
        gesture.pendingFrame = null;
        gesture.scene.update(offset, progress);
      });
    }
  }
};

const handleActiveEnd = (gesture: ActiveGesture, isCancel: boolean) => {
  if (activeGesture !== gesture) return;

  if (isCancel && !gesture.entry.cancelCommits) {
    abortActiveGesture();
    return;
  }

  activeGesture = null;
  cancelScheduledAnimationFrame(gesture.rafId);
  gesture.rafId = null;

  if (gesture.lockedOnce) {
    armClickSuppressor();
  }

  if (hasOpenOverlay(gesture.overlayScope)) {
    cleanupGestureImmediate(gesture);
    return;
  }

  if (!gesture.scene) {
    if (gesture.tracker.shouldCommit(0)) {
      gesture.entry.onCommitRef.current();
    }
    return;
  }

  if (gesture.pendingFrame) {
    const { offset, progress } = gesture.pendingFrame;
    gesture.pendingFrame = null;
    gesture.scene.update(offset, progress);
  }

  const extent = gesture.scene.extent;
  const commit = gesture.tracker.shouldCommit(extent);
  const durationMs = gesture.tracker.settleDurationMs(commit, extent);
  const currentOffset = gesture.tracker.offset;
  const settleToken = ++settleCounter;
  activeSettle = { token: settleToken, gesture };

  void (async () => {
    let committed = false;
    try {
      await gesture.scene!.settle(commit, durationMs, currentOffset);
      if (activeSettle?.token !== settleToken || gesture.cleanedUp) return;
      if (commit) {
        committed = true;
        gesture.scene!.commit();
      }
    } finally {
      if (activeSettle?.token === settleToken) {
        activeSettle = null;
      }
      if (!gesture.cleanedUp) {
        gesture.cleanedUp = true;
        gesture.scene!.cleanup(committed);
      }
    }
  })();
};

const handleWindowTouchStart = (event: TouchEventWithFlag) => {
  if (activeGesture) {
    if (event.touches.length !== 1) {
      abortActiveGesture();
    }
    return;
  }
  if (activeSettle || claimedTouchStartEvents.has(event)) return;
  if (event[HANDLED_EVENT_FLAG] || event.touches.length !== 1) return;

  const touch = event.touches[0];
  if (!touch) return;

  const target = event.target as Node | null;
  const dirSign = resolveLogicalDirectionSign();
  const sorted = sortByPriorityDesc(edgeEntries);
  const blockedEdges = new Set<SwipeEdge>();
  let minAllowedPriority = -Infinity;

  for (const entry of sorted) {
    if (entry.priority < minAllowedPriority) break;

    if (entry.priority >= SWIPE_PRIORITY.OVERLAY) {
      minAllowedPriority = Math.max(minAllowedPriority, entry.priority);
    }

    const { isPhysicalLeftEdge, axisSign } = resolveAxisGeometry(
      entry.edge,
      entry.direction,
      dirSign
    );
    if (!isInEdgeBand(touch.clientX, isPhysicalLeftEdge)) continue;

    if (blockedEdges.has(entry.edge)) continue;

    if (entry.blockStandaloneWebApp && isIOSStandaloneWebApp()) {
      blockedEdges.add(entry.edge);
      continue;
    }

    if (hasOpenOverlay(entry.within?.current)) {
      break;
    }

    if (entry.within && !entry.within.current?.contains(target)) {
      if (entry.priority >= SWIPE_PRIORITY.SHEET) {
        minAllowedPriority = Math.max(minAllowedPriority, entry.priority);
      }
      continue;
    }

    startGesture(entry, touch, getEventTimeMs(event), axisSign, dirSign);
    break;
  }
};

const handleWindowTouchMove = (event: TouchEventWithFlag) => {
  if (!activeGesture || activeGesture.entry.zone !== 'edge') return;
  handleActiveMove(event, activeGesture);
};

const handleWindowTouchEnd = () => {
  if (!activeGesture || activeGesture.entry.zone !== 'edge') return;
  handleActiveEnd(activeGesture, false);
};

const handleWindowTouchCancel = () => {
  if (!activeGesture || activeGesture.entry.zone !== 'edge') return;
  handleActiveEnd(activeGesture, true);
};

const handleWindowResize = () => {
  abortAll();
};

const handleVisibilityChange = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    abortAll();
  }
};

const detachEdgeListeners = () => {
  if (!attachedEdgeWindow) return;
  attachedEdgeWindow.removeEventListener('touchstart', handleWindowTouchStart);
  attachedEdgeWindow.removeEventListener('touchmove', handleWindowTouchMove);
  attachedEdgeWindow.removeEventListener('touchend', handleWindowTouchEnd);
  attachedEdgeWindow.removeEventListener('touchcancel', handleWindowTouchCancel);
  attachedEdgeWindow = null;
};

const detachInterruptListeners = () => {
  if (attachedInterruptWindow) {
    attachedInterruptWindow.removeEventListener('resize', handleWindowResize);
    attachedInterruptWindow = null;
  }
  if (attachedInterruptDocument) {
    attachedInterruptDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    attachedInterruptDocument = null;
  }
};

const syncGlobalListeners = () => {
  const currentWindow = typeof window === 'undefined' ? null : window;
  const currentDocument = typeof document === 'undefined' ? null : document;

  if (attachedEdgeWindow && (edgeEntries.size === 0 || attachedEdgeWindow !== currentWindow)) {
    detachEdgeListeners();
  }
  if (edgeEntries.size > 0 && currentWindow && attachedEdgeWindow !== currentWindow) {
    currentWindow.addEventListener('touchstart', handleWindowTouchStart, { passive: true });
    currentWindow.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    currentWindow.addEventListener('touchend', handleWindowTouchEnd, { passive: true });
    currentWindow.addEventListener('touchcancel', handleWindowTouchCancel, { passive: true });
    attachedEdgeWindow = currentWindow;
  }

  const hasAny = edgeEntries.size > 0 || elementEntries.size > 0;
  if (
    attachedInterruptWindow &&
    (!hasAny || attachedInterruptWindow !== currentWindow)
  ) {
    attachedInterruptWindow.removeEventListener('resize', handleWindowResize);
    attachedInterruptWindow = null;
  }
  if (hasAny && currentWindow && attachedInterruptWindow !== currentWindow) {
    currentWindow.addEventListener('resize', handleWindowResize, { passive: true });
    attachedInterruptWindow = currentWindow;
  }

  if (
    attachedInterruptDocument &&
    (!hasAny || attachedInterruptDocument !== currentDocument)
  ) {
    attachedInterruptDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    attachedInterruptDocument = null;
  }
  if (hasAny && currentDocument && attachedInterruptDocument !== currentDocument) {
    currentDocument.addEventListener('visibilitychange', handleVisibilityChange);
    attachedInterruptDocument = currentDocument;
  }
};

const hasHigherPriorityCoveringEdge = (priority: number, target: Node | null): boolean => {
  for (const entry of edgeEntries) {
    if (entry.priority > priority && (!entry.within || entry.within.current?.contains(target))) {
      return true;
    }
  }
  return false;
};

const findWinningElementEntry = (target: Node | null): SwipeRegistration | null => {
  let winner: SwipeRegistration | null = null;
  for (const entry of elementEntries) {
    const el = entry.elementRef?.current;
    if (!el || !el.contains(target)) continue;
    if (
      !winner ||
      entry.priority > winner.priority ||
      (entry.priority === winner.priority && entry.id > winner.id)
    ) {
      winner = entry;
    }
  }
  return winner;
};

export const useInteractiveSwipe = ({
  zone,
  edge,
  direction,
  priority,
  enabled,
  elementRef,
  within,
  blockStandaloneWebApp = false,
  cancelCommits = false,
  onCommit,
  begin,
}: InteractiveSwipeOptions): void => {
  const onCommitRef = useRef(onCommit);
  const beginRef = useRef(begin);

  useLayoutEffect(() => {
    onCommitRef.current = onCommit;
    beginRef.current = begin;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined') return undefined;

    const entry: SwipeRegistration = {
      id: nextRegistrationId++,
      zone,
      edge,
      direction,
      priority,
      elementRef,
      within,
      blockStandaloneWebApp,
      cancelCommits,
      onCommitRef,
      beginRef,
    };

    if (zone === 'edge') {
      edgeEntries.add(entry);
      syncGlobalListeners();
      return () => {
        abortEntry(entry);
        edgeEntries.delete(entry);
        syncGlobalListeners();
        if (edgeEntries.size === 0 && elementEntries.size === 0) {
          detachInterruptListeners();
        }
      };
    }

    const panel = elementRef?.current;
    if (!panel) return undefined;

    const onElementTouchStart = (event: TouchEventWithFlag) => {
      if (activeGesture) {
        if (event.touches.length !== 1) {
          abortActiveGesture();
        }
        return;
      }
      if (activeSettle || claimedTouchStartEvents.has(event)) return;
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];
      if (!touch) return;

      const target = event.target as Node | null;
      const winner = findWinningElementEntry(target);
      if (winner !== entry) return;

      if (hasHigherPriorityCoveringEdge(entry.priority, target)) return;

      claimedTouchStartEvents.add(event);

      if (hasOpenOverlay(panel)) return;

      const dirSign = resolveLogicalDirectionSign(panel);
      const { axisSign } = resolveAxisGeometry(entry.edge, entry.direction, dirSign);
      startGesture(entry, touch, getEventTimeMs(event), axisSign, dirSign);
    };

    const onElementTouchMove = (event: TouchEventWithFlag) => {
      if (!activeGesture || activeGesture.entry !== entry) return;
      handleActiveMove(event, activeGesture);
    };

    const onElementTouchEnd = () => {
      if (!activeGesture || activeGesture.entry !== entry) return;
      handleActiveEnd(activeGesture, false);
    };

    const onElementTouchCancel = () => {
      if (!activeGesture || activeGesture.entry !== entry) return;
      handleActiveEnd(activeGesture, true);
    };

    elementEntries.add(entry);
    syncGlobalListeners();

    panel.addEventListener('touchstart', onElementTouchStart, { capture: true, passive: true });
    panel.addEventListener('touchmove', onElementTouchMove, { capture: true, passive: false });
    panel.addEventListener('touchend', onElementTouchEnd, { capture: true, passive: true });
    panel.addEventListener('touchcancel', onElementTouchCancel, { capture: true, passive: true });

    return () => {
      abortEntry(entry);
      elementEntries.delete(entry);
      panel.removeEventListener('touchstart', onElementTouchStart, true);
      panel.removeEventListener('touchmove', onElementTouchMove, true);
      panel.removeEventListener('touchend', onElementTouchEnd, true);
      panel.removeEventListener('touchcancel', onElementTouchCancel, true);
      syncGlobalListeners();
    };
  }, [
    zone,
    edge,
    direction,
    priority,
    enabled,
    elementRef,
    within,
    blockStandaloneWebApp,
    cancelCommits,
  ]);
};
