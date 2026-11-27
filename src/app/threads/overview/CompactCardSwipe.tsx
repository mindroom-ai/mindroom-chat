import React, {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Icon, Icons, Text } from 'folds';
import type { DesktopShellEvent } from '../../lib/desktopBridge';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { desktopBridge, isDesktopApp } from '../../lib/nativeShell';
import { isMacOS } from '../../lib/user-agent';
import { EDGE_START_MAX_X } from '../../navigation/useEdgeSwipe';
import * as css from './CompactCardSwipe.css';

// How far a touch or trackpad gesture moves before it counts as a swipe or a scroll.
const AXIS_LOCK_DISTANCE = 10;
// Longer than the settle transition (`transitionend` never comes if a re-sort cancels it).
const SETTLE_FALLBACK_MS = 500;
const PARK_THRESHOLD = 60;
const PARK_WIDTH = 156;
const MIN_VISIBLE_CARD = 40;
const CLOSE_THRESHOLD = 24;
const PARK_DEEP_GAP = 12;
const DOM_DELTA_PIXEL = 0;

export const getSwipeThreshold = (cardWidth: number): number =>
  Math.min(160, Math.max(72, cardWidth * 0.35));

export const getDeepThreshold = (cardWidth: number, hasSnooze: boolean): number =>
  hasSnooze
    ? Math.min(
        Math.min(200, Math.max(PARK_WIDTH + PARK_DEEP_GAP, cardWidth * 0.52)),
        cardWidth * 0.65
      )
    : getSwipeThreshold(cardWidth);

export const getParkWidth = (cardWidth: number, deepThreshold: number): number =>
  Math.max(
    0,
    Math.min(PARK_WIDTH, cardWidth - MIN_VISIBLE_CARD, Math.floor(deepThreshold - PARK_DEEP_GAP))
  );

type Swipe = {
  originX: number;
  startOffset: number;
  // Captured when the swipe starts so letting go acts on what the strip showed.
  resolved: boolean;
  snoozed: boolean;
  hasSnooze: boolean;
  // 1 in LTR, -1 in RTL.
  towardStart: 1 | -1;
  width: number;
  parkWidth: number;
  parkThreshold: number;
  deepThreshold: number;
  offset: number;
  armed: boolean;
};

type Gesture = { pointerId: number; startX: number; startY: number; swipe?: Swipe };
type Strip = {
  resolved: boolean;
  snoozed: boolean;
  label: string;
  snoozeLabel?: string;
  parkWidth: number;
};
type CardHandle = {
  isTouchSwiping: () => boolean;
  isEnabled: () => boolean;
  getOffset: () => number;
  getTowardStart: () => 1 | -1;
  startTrackpad: (deltaTowardStart: number) => boolean;
  moveTrackpad: (deltaX: number) => boolean;
  endTrackpad: (commit: boolean) => void;
  isTrackpadArmed: () => boolean;
};
type TrackpadGesture =
  | { kind: 'pending'; handle?: CardHandle; x: number; y: number }
  | { kind: 'track'; handle: CardHandle }
  | { kind: 'ignored' };

const IGNORED: TrackpadGesture = { kind: 'ignored' };
// Maps each card's track (and revealed tray while mounted) to its swipe handle.
const handleByNode = new WeakMap<EventTarget, CardHandle>();
let activeParked: { track: EventTarget; close: () => void } | undefined;

const closeActiveParked = (exceptTrack?: EventTarget | null) => {
  if (!activeParked || activeParked.track === exceptTrack) return;
  const closing = activeParked;
  activeParked = undefined;
  closing.close();
};

const isNodeInside = (el: HTMLElement | null, target: EventTarget | null): boolean =>
  Boolean(
    el &&
    target &&
    (el === target ||
      (typeof el.contains === 'function' &&
        (typeof Node === 'undefined' || target instanceof Node) &&
        el.contains(target as Node)))
  );

const findCardHandle = (event: Event): CardHandle | undefined => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    const handle = handleByNode.get(node);
    if (handle) return handle;
  }
  for (let node = event.target as Node | null; node; node = node.parentNode ?? null) {
    const handle = handleByNode.get(node);
    if (handle) return handle;
  }
  return undefined;
};

const shouldPark = (swipe: Swipe): boolean =>
  swipe.parkWidth > 0 &&
  swipe.offset >= swipe.parkThreshold &&
  (swipe.startOffset === 0 || swipe.offset >= swipe.startOffset - CLOSE_THRESHOLD);

/**
 * For the element holding swipeable cards (`SwipeList` in CompactCardSwipe.css.ts).
 * Uses one `touchmove` listener for all cards (keeping iOS WebKit to one touch region), and on
 * macOS Electron runs one shared trackpad wheel coordinator that leaves inline-end swipes on
 * closed cards untouched so `desktopHistorySwipe` navigates Back.
 */
export const useCompactCardSwipeList = (listRef: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const handleTouchMove = (event: TouchEvent) => {
      if (
        event.cancelable &&
        event.composedPath().some((n) => handleByNode.get(n)?.isTouchSwiping())
      ) {
        event.preventDefault();
      }
    };
    list.addEventListener('touchmove', handleTouchMove, { passive: false });

    const bridge = desktopBridge();
    if (!isDesktopApp() || !bridge || !isMacOS()) {
      return () => list.removeEventListener('touchmove', handleTouchMove);
    }

    const doc = list.ownerDocument;
    const win = doc?.defaultView ?? (typeof window === 'undefined' ? undefined : window);
    const raf = win?.requestAnimationFrame?.bind(win);
    const caf = win?.cancelAnimationFrame?.bind(win);
    let inGesture = false;
    let gesture: TrackpadGesture | null = null;
    let pendingEndRaf: number | null = null;

    const clearPendingEnd = () => {
      if (pendingEndRaf !== null) {
        caf?.(pendingEndRaf);
        pendingEndRaf = null;
      }
    };
    const finishGesture = (commit: boolean) => {
      const current = gesture;
      gesture = null;
      if (current?.kind === 'track') current.handle.endTrackpad(commit);
    };
    const abortGesture = () => {
      clearPendingEnd();
      inGesture = false;
      finishGesture(false);
    };
    const onShellEvent = (event: DesktopShellEvent) => {
      if (event.type === 'window-hidden') {
        abortGesture();
        closeActiveParked();
      } else if (event.type === 'swipe-tracking' && !event.enabled) {
        abortGesture();
      } else if (event.type === 'scroll-gesture') {
        if (event.phase === 'begin') {
          const hadPending = pendingEndRaf !== null;
          clearPendingEnd();
          finishGesture(hadPending);
          inGesture = true;
        } else if (event.phase === 'cancel' || !gesture || gesture.kind === 'ignored') {
          abortGesture();
        } else if (gesture.kind === 'track' && gesture.handle.isTrackpadArmed()) {
          clearPendingEnd();
          inGesture = false;
          finishGesture(true);
        } else if (inGesture && pendingEndRaf === null) {
          const settleEnd = () => {
            pendingEndRaf = null;
            inGesture = false;
            finishGesture(true);
          };
          pendingEndRaf = raf ? raf(settleEnd) : (settleEnd(), null);
        }
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!inGesture || event.deltaMode !== DOM_DELTA_PIXEL) return;
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        finishGesture(false);
        gesture = IGNORED;
        return;
      }
      if ((event as WheelEvent & { momentum?: boolean }).momentum) {
        finishGesture(true);
        gesture = IGNORED;
        return;
      }
      if (gesture?.kind === 'ignored' || (event.deltaX === 0 && event.deltaY === 0)) return;
      if (gesture?.kind === 'track') {
        event.preventDefault();
        if (!gesture.handle.moveTrackpad(event.deltaX)) gesture = IGNORED;
        return;
      }
      const pending =
        gesture ?? (gesture = { kind: 'pending', handle: findCardHandle(event), x: 0, y: 0 });
      pending.x += event.deltaX;
      pending.y += event.deltaY;
      if (Math.hypot(pending.x, pending.y) < AXIS_LOCK_DISTANCE) return;
      if (Math.abs(pending.y) >= Math.abs(pending.x)) {
        gesture = IGNORED;
        closeActiveParked();
        return;
      }
      const { handle } = pending;
      const deltaTowardStart = handle ? pending.x * handle.getTowardStart() : 0;
      // Closed card swiped toward inline-end (Back): leave untouched for desktopHistorySwipe.
      if (
        !handle?.isEnabled() ||
        (handle.getOffset() === 0 && deltaTowardStart < 0) ||
        !handle.startTrackpad(deltaTowardStart)
      ) {
        gesture = IGNORED;
        return;
      }
      event.preventDefault();
      gesture = { kind: 'track', handle };
    };
    const onVisibilityChange = () => {
      if (doc?.visibilityState === 'hidden') abortGesture();
    };
    const stopShell = bridge.onShellEvent(onShellEvent);
    list.addEventListener('wheel', onWheel, { passive: false });
    win?.addEventListener?.('blur', abortGesture);
    doc?.addEventListener?.('visibilitychange', onVisibilityChange);
    return () => {
      abortGesture();
      stopShell();
      list.removeEventListener('touchmove', handleTouchMove);
      list.removeEventListener('wheel', onWheel);
      win?.removeEventListener?.('blur', abortGesture);
      doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
    };
  }, [listRef]);
};

export type CompactCardSwipeStripProps = {
  resolved: boolean;
  label: string;
  armed?: boolean;
  snoozed?: boolean;
  snoozeLabel?: string;
  parked?: boolean;
  parkWidth?: number;
  onSnoozeClick?: () => void;
  onResolveClick?: () => void;
  stripRef?: RefObject<HTMLDivElement | null>;
  'data-tour-swipe'?: string;
};

/** The action strip or split tray revealed behind a swiped compact card; shared with the tour. */
export function CompactCardSwipeStrip({
  resolved,
  label,
  armed = false,
  snoozed = false,
  snoozeLabel,
  parked = false,
  parkWidth,
  onSnoozeClick,
  onResolveClick,
  stripRef,
  ...props
}: CompactCardSwipeStripProps) {
  if (snoozeLabel !== undefined) {
    const tabIndex = parked ? 0 : -1;
    return (
      <div
        ref={stripRef}
        className={css.SwipeTray}
        style={
          parkWidth !== undefined
            ? ({ '--swipe-tray-width': `${parkWidth}px` } as CSSProperties)
            : undefined
        }
        data-compact-card-swipe="action"
        data-armed={armed ? 'true' : undefined}
        data-parked={parked ? 'true' : undefined}
        data-snoozed={snoozed ? 'true' : undefined}
        aria-hidden={parked ? undefined : true}
        {...props}
      >
        <button
          type="button"
          className={`${css.TrayButton} ${css.SnoozeButton}`}
          data-compact-card-swipe-action="snooze"
          tabIndex={tabIndex}
          onClick={onSnoozeClick}
        >
          <Icon size="200" src={Icons.Clock} />
          <Text size="T200" className={css.TrayLabel}>
            {snoozeLabel}
          </Text>
        </button>
        <button
          type="button"
          className={`${css.TrayButton} ${css.ResolveButton}`}
          data-compact-card-swipe-action="resolve"
          tabIndex={tabIndex}
          onClick={onResolveClick}
        >
          <Icon size="200" src={Icons.Check} />
          <Text size="T200" className={css.TrayLabel}>
            {label}
          </Text>
        </button>
      </div>
    );
  }
  return (
    <div
      ref={stripRef}
      className={css.SwipeAction}
      data-compact-card-swipe="action"
      data-armed={armed ? 'true' : undefined}
      data-resolved={resolved ? 'true' : undefined}
      aria-hidden
      {...props}
    >
      <Icon size="200" src={resolved ? Icons.Reload : Icons.Check} />
      <Text size="B300">{label}</Text>
    </div>
  );
}

export type CompactCardSwipeProps = {
  enabled: boolean;
  resolved: boolean;
  label: string;
  /** Receives whether the thread was resolved when the swipe started. */
  onSwipe: (wasResolved: boolean) => void;
  snoozed?: boolean;
  snoozeLabel?: string;
  /** On open cards, enables parking the Snooze/Resolve split tray. Receives whether snoozed at start. */
  onSnooze?: (wasSnoozed: boolean) => void;
  children: ReactNode;
};

/**
 * Lets a touch swipe (or macOS Electron two-finger trackpad swipe) slide a compact card toward
 * inline-start to park a Snooze/Resolve tray or deep-pull to Resolve/Reopen directly. Mouse and
 * keyboard users keep hover buttons and the actions menu. The list calls `useCompactCardSwipeList`.
 */
export function CompactCardSwipe({
  enabled,
  resolved,
  label,
  onSwipe,
  snoozed = false,
  snoozeLabel,
  onSnooze,
  children,
}: CompactCardSwipeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>(undefined);
  const trackpadSwipeRef = useRef<Swipe>(undefined);
  const parkedRef = useRef<{ offset: number; towardStart: 1 | -1; width: number }>(undefined);
  const handleRef = useRef<CardHandle>(undefined);
  const swipedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [strip, setStrip] = useState<Strip>();
  const [settling, setSettling] = useState(false);
  const [armed, setArmed] = useState(false);
  const [parked, setParked] = useState(false);

  const propsRef = useLatestRef({
    enabled,
    resolved,
    snoozed,
    label,
    snoozeLabel,
    canSnooze: !resolved && Boolean(onSnooze && snoozeLabel),
    onSwipe,
    onSnooze,
  });

  const finishTransition = useCallback(() => {
    clearTimeout(settleTimerRef.current);
    setSettling(false);
    if (!parkedRef.current) {
      setStrip(undefined);
      setArmed(false);
    }
  }, []);

  const startSettleTimer = useCallback(() => {
    setSettling(true);
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(finishTransition, SETTLE_FALLBACK_MS);
  }, [finishTransition]);

  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  const closeParked = () => {
    if (!parkedRef.current) return;
    parkedRef.current = undefined;
    if (trackRef.current && activeParked?.track === trackRef.current) activeParked = undefined;
    setParked(false);
    setArmed(false);
    if (trackRef.current) trackRef.current.style.transform = '';
    startSettleTimer();
  };

  const startSwipe = (originX: number, initialDelta = 0): Swipe | undefined => {
    const track = trackRef.current;
    const p = propsRef.current;
    if (!track || !p.enabled) return undefined;
    closeActiveParked(track);
    const prev = parkedRef.current;
    const width = prev?.width ?? track.getBoundingClientRect().width;
    const towardStart = prev?.towardStart ?? (getComputedStyle(track).direction === 'rtl' ? -1 : 1);
    const deepThreshold = getDeepThreshold(width, p.canSnooze);
    const parkWidth = p.canSnooze ? getParkWidth(width, deepThreshold) : 0;
    const offset = Math.min(width, Math.max(0, (prev?.offset ?? 0) + initialDelta));
    const nextArmed = offset >= deepThreshold;
    const swipe: Swipe = {
      originX,
      startOffset: prev?.offset ?? 0,
      resolved: p.resolved,
      snoozed: p.snoozed,
      hasSnooze: p.canSnooze,
      towardStart,
      width,
      parkWidth,
      parkThreshold: p.canSnooze ? Math.min(PARK_THRESHOLD, parkWidth * 0.5) : 0,
      deepThreshold,
      offset,
      armed: nextArmed,
    };
    parkedRef.current = undefined;
    if (activeParked?.track === track) activeParked = undefined;
    clearTimeout(settleTimerRef.current);
    setParked(false);
    setSettling(false);
    setArmed(nextArmed);
    setStrip({
      resolved: swipe.resolved,
      snoozed: swipe.snoozed,
      label: p.label,
      snoozeLabel: p.canSnooze ? p.snoozeLabel : undefined,
      parkWidth,
    });
    track.style.transform = `translateX(${-offset * towardStart}px)`;
    return swipe;
  };

  const updateSwipe = (swipe: Swipe, nextOffset: number) => {
    swipe.offset = Math.min(swipe.width, Math.max(0, nextOffset));
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${-swipe.offset * swipe.towardStart}px)`;
    }
    const nextArmed = swipe.offset >= swipe.deepThreshold;
    if (nextArmed !== swipe.armed) {
      swipe.armed = nextArmed;
      setArmed(nextArmed);
    }
  };

  const completeSwipe = (swipe: Swipe, commit: boolean, fromTouch: boolean) => {
    const track = trackRef.current;
    const p = propsRef.current;
    if (fromTouch) swipedRef.current = true;
    if (commit && !swipe.armed && swipe.hasSnooze && p.enabled && shouldPark(swipe)) {
      parkedRef.current = {
        offset: swipe.parkWidth,
        towardStart: swipe.towardStart,
        width: swipe.width,
      };
      if (track) {
        closeActiveParked(track);
        activeParked = { track, close: () => actionsRef.current.closeParked() };
        track.style.transform = `translateX(${-swipe.parkWidth * swipe.towardStart}px)`;
      }
      setParked(true);
      setArmed(false);
      if (swipe.offset === swipe.parkWidth) finishTransition();
      else startSettleTimer();
      return;
    }
    if (track) track.style.transform = '';
    if (commit && swipe.armed && p.enabled) p.onSwipe(swipe.resolved);
    else setArmed(false);
    if (swipe.offset === 0) finishTransition();
    else startSettleTimer();
  };
  const endSwipe = (source: 'touch' | 'trackpad', commit: boolean) => {
    const swipe = source === 'touch' ? gestureRef.current?.swipe : trackpadSwipeRef.current;
    if (source === 'touch') gestureRef.current = undefined;
    else trackpadSwipeRef.current = undefined;
    if (swipe) completeSwipe(swipe, commit, source === 'touch');
  };

  const abortAll = () => {
    endSwipe('touch', false);
    endSwipe('trackpad', false);
    closeParked();
  };

  const actionsRef = useLatestRef({ startSwipe, updateSwipe, endSwipe, closeParked, abortAll });

  // Register track with the list's shared touchmove & macOS Electron trackpad coordinator.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const handle: CardHandle = {
      isTouchSwiping: () => !!gestureRef.current?.swipe,
      isEnabled: () => propsRef.current.enabled,
      getOffset: () => parkedRef.current?.offset ?? trackpadSwipeRef.current?.offset ?? 0,
      getTowardStart: () =>
        parkedRef.current?.towardStart ?? (getComputedStyle(track).direction === 'rtl' ? -1 : 1),
      startTrackpad: (deltaTowardStart) => {
        if (gestureRef.current?.swipe) return false;
        const swipe = actionsRef.current.startSwipe(0, deltaTowardStart);
        trackpadSwipeRef.current = swipe;
        return Boolean(swipe);
      },
      moveTrackpad: (deltaX) => {
        const swipe = trackpadSwipeRef.current;
        if (!swipe) return false;
        actionsRef.current.updateSwipe(swipe, swipe.offset + deltaX * swipe.towardStart);
        return true;
      },
      endTrackpad: (commit) => actionsRef.current.endSwipe('trackpad', commit),
      isTrackpadArmed: () => Boolean(trackpadSwipeRef.current?.armed),
    };
    handleRef.current = handle;
    handleByNode.set(track, handle);
    return () => {
      handleRef.current = undefined;
      handleByNode.delete(track);
    };
  }, [actionsRef, propsRef]);

  // Also map the mounted tray so swiping right over it closes the parked card.
  useEffect(() => {
    const el = stripRef.current;
    const handle = handleRef.current;
    if (!strip || !el || !handle) return undefined;
    handleByNode.set(el, handle);
    return () => void handleByNode.delete(el);
  }, [strip]);

  // A card leaving the list mid-swipe may show briefly as a copy (`ui/listMotion.tsx`): at rest.
  useLayoutEffect(() => {
    const track = trackRef.current;
    return () => {
      if (track && activeParked?.track === track) activeParked = undefined;
      if (track) track.style.transform = '';
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (stripRef.current) stripRef.current.style.display = 'none';
    };
  }, []);

  useEffect(() => {
    if (!enabled) actionsRef.current.abortAll();
    else if (resolved) actionsRef.current.closeParked();
  }, [actionsRef, enabled, resolved]);

  // Document touch/visibility safety net: no swipe outlives its touch or a hidden page.
  useEffect(() => {
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const handleTouchStart = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (gesture && (event.touches.length > 1 || gesture.swipe))
        actionsRef.current.endSwipe('touch', false);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture?.swipe || event.touches.length > 0) return;
      setTimeout(() => {
        if (gestureRef.current === gesture)
          actionsRef.current.endSwipe('touch', event.type === 'touchend');
      }, 0);
    };
    const handleVisibilityChange = () => {
      if (doc.visibilityState === 'hidden') actionsRef.current.abortAll();
    };
    const early = { capture: true, passive: true };
    doc.addEventListener('touchstart', handleTouchStart, early);
    doc.addEventListener('touchend', handleTouchEnd, early);
    doc.addEventListener('touchcancel', handleTouchEnd, early);
    doc.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      doc.removeEventListener('touchstart', handleTouchStart, early);
      doc.removeEventListener('touchend', handleTouchEnd, early);
      doc.removeEventListener('touchcancel', handleTouchEnd, early);
      doc.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [actionsRef]);

  // Dismiss the single parked card on outside tap/click, Escape, contextmenu, or vertical scroll.
  useEffect(() => {
    if (!parked) return undefined;
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const onPointerDown = (event: Event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (
        path.includes(trackRef.current!) ||
        path.includes(stripRef.current!) ||
        isNodeInside(trackRef.current, event.target) ||
        isNodeInside(stripRef.current, event.target)
      )
        return;
      actionsRef.current.closeParked();
    };
    const onKeyDown = (event: Event) => {
      const { key, shiftKey } = event as KeyboardEvent;
      if (key === 'Escape') {
        actionsRef.current.closeParked();
        event.preventDefault();
        event.stopPropagation();
      } else if (key === 'ContextMenu' || (shiftKey && key === 'F10')) {
        actionsRef.current.closeParked();
      }
    };
    const onScroll = (event: Event) => {
      const t = event.target;
      if (
        !t ||
        t === doc ||
        (doc.documentElement && t === doc.documentElement) ||
        isNodeInside(t as HTMLElement, trackRef.current)
      ) {
        actionsRef.current.closeParked();
      }
    };
    const onContextMenu = () => actionsRef.current.closeParked();
    const listeners: Array<[string, EventListener, AddEventListenerOptions]> = [
      ['pointerdown', onPointerDown, { capture: true, passive: true }],
      ['keydown', onKeyDown, { capture: true }],
      ['scroll', onScroll, { capture: true, passive: true }],
      ['contextmenu', onContextMenu, { capture: true, passive: true }],
    ];
    listeners.forEach(([type, fn, opts]) => doc.addEventListener(type, fn, opts));
    return () =>
      listeners.forEach(([type, fn]) => doc.removeEventListener(type, fn, { capture: true }));
  }, [actionsRef, parked]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) endSwipe('touch', false);
    swipedRef.current = false;
    if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;
    if (event.clientX <= EDGE_START_MAX_X || event.clientX >= window.innerWidth - EDGE_START_MAX_X)
      return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!gesture.swipe) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) < AXIS_LOCK_DISTANCE && Math.abs(dy) < AXIS_LOCK_DISTANCE) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        gestureRef.current = undefined;
        closeParked();
        return;
      }
      const swipe = startSwipe(event.clientX, 0);
      if (!swipe) {
        gestureRef.current = undefined;
        return;
      }
      gesture.swipe = swipe;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const { swipe } = gesture;
    updateSwipe(swipe, swipe.startOffset + (swipe.originX - event.clientX) * swipe.towardStart);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (event.pointerId === gestureRef.current?.pointerId) endSwipe('touch', commit);
  };

  const runTrayAction = (action: () => void) => {
    if (!parkedRef.current || !propsRef.current.enabled || !strip) return;
    closeParked();
    action();
  };

  return (
    <>
      {strip && (
        <CompactCardSwipeStrip
          stripRef={stripRef}
          resolved={strip.resolved}
          label={strip.label}
          armed={armed}
          snoozed={strip.snoozed}
          snoozeLabel={strip.snoozeLabel}
          parked={parked}
          parkWidth={strip.parkWidth}
          onSnoozeClick={() => runTrayAction(() => propsRef.current.onSnooze?.(strip.snoozed))}
          onResolveClick={() => runTrayAction(() => propsRef.current.onSwipe(strip.resolved))}
        />
      )}
      <div
        ref={trackRef}
        className={[css.SwipeTrack, settling && css.SwipeTrackSettling].filter(Boolean).join(' ')}
        data-compact-card-swipe="track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => handlePointerEnd(event, true)}
        onPointerCancel={(event) => handlePointerEnd(event, false)}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) handlePointerEnd(event, false);
        }}
        onClickCapture={(event) => {
          if (event.detail === 0) return;
          if (swipedRef.current) {
            swipedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          } else if (parkedRef.current) {
            closeParked();
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'transform') {
            finishTransition();
          }
        }}
      >
        {children}
      </div>
    </>
  );
}
