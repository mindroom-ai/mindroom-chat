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
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import {
  registerTrackpadSwipeClaimer,
  type TrackpadSwipeClaim,
} from '../../navigation/desktopHistorySwipe';
import { EDGE_START_MAX_X } from '../../navigation/useEdgeSwipe';
import * as css from './CompactCardSwipe.css';

// How far a touch moves before it counts as a swipe or a scroll.
const AXIS_LOCK_DISTANCE = 10;
// Longer than the settle transition (`transitionend` never comes if a re-sort cancels it).
const SETTLE_FALLBACK_MS = 500;
const PARK_THRESHOLD = 60;
const PARK_WIDTH = 156;
const MIN_VISIBLE_CARD = 40;
const CLOSE_THRESHOLD = 24;
const PARK_DEEP_GAP = 12;

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
  claimTrackpad: (deltaX: number, blockedByDom: boolean) => TrackpadSwipeClaim | undefined;
};

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

const shouldPark = (swipe: Swipe): boolean =>
  swipe.parkWidth > 0 &&
  swipe.offset >= swipe.parkThreshold &&
  (swipe.startOffset === 0 || swipe.offset >= swipe.startOffset - CLOSE_THRESHOLD);

/**
 * For the element holding swipeable cards (`SwipeList` in CompactCardSwipe.css.ts).
 * Uses one `touchmove` listener for all cards (keeping iOS WebKit to one touch region) and
 * registers a lightweight macOS trackpad swipe claimer with `desktopHistorySwipe`.
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
    const stopTrackpad = registerTrackpadSwipeClaimer({
      claim: ({ path, deltaX, blockedByDom }) =>
        path.includes(list)
          ? path
              .map((node) => handleByNode.get(node))
              .find(Boolean)
              ?.claimTrackpad(deltaX, blockedByDom)
          : undefined,
      onVerticalScroll: (path) => {
        if (path.includes(list)) closeActiveParked();
      },
      onWindowHidden: () => closeActiveParked(),
    });
    return () => {
      stopTrackpad();
      list.removeEventListener('touchmove', handleTouchMove);
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
    const buttons = [
      {
        action: 'snooze',
        className: css.SnoozeButton,
        icon: Icons.Clock,
        text: snoozeLabel,
        onClick: onSnoozeClick,
      },
      {
        action: 'resolve',
        className: css.ResolveButton,
        icon: Icons.Check,
        text: label,
        onClick: onResolveClick,
      },
    ] as const;
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
        {buttons.map((btn) => (
          <button
            key={btn.action}
            type="button"
            className={`${css.TrayButton} ${btn.className}`}
            data-compact-card-swipe-action={btn.action}
            tabIndex={tabIndex}
            onClick={btn.onClick}
          >
            <Icon size="200" src={btn.icon} />
            <Text size="T200" className={css.TrayLabel}>
              {btn.text}
            </Text>
          </button>
        ))}
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

  // Register track with the list's touchmove handler and macOS trackpad claimer.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const handle: CardHandle = {
      isTouchSwiping: () => !!gestureRef.current?.swipe,
      claimTrackpad: (deltaX, blockedByDom) => {
        if (!propsRef.current.enabled || gestureRef.current?.swipe) return undefined;
        const isParked = Boolean(parkedRef.current);
        if (!isParked && blockedByDom) return undefined;
        const towardStart =
          parkedRef.current?.towardStart ?? (getComputedStyle(track).direction === 'rtl' ? -1 : 1);
        const deltaTowardStart = deltaX * towardStart;
        // Closed cards yield to inline-end (Back) swipes.
        if (!isParked && deltaTowardStart < 0) return undefined;
        const swipe = actionsRef.current.startSwipe(0, deltaTowardStart);
        if (!swipe) return undefined;
        trackpadSwipeRef.current = swipe;
        return {
          move: (dx) => {
            if (trackpadSwipeRef.current === swipe) {
              actionsRef.current.updateSwipe(swipe, swipe.offset + dx * swipe.towardStart);
            }
          },
          end: () => {
            if (trackpadSwipeRef.current === swipe) actionsRef.current.endSwipe('trackpad', true);
          },
          cancel: () => {
            if (trackpadSwipeRef.current === swipe) actionsRef.current.endSwipe('trackpad', false);
          },
          isReadyToCommit: () => trackpadSwipeRef.current === swipe && swipe.armed,
        };
      },
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
      if (gesture && (event.touches.length > 1 || gesture.swipe)) {
        actionsRef.current.endSwipe('touch', false);
      }
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture?.swipe || event.touches.length > 0) return;
      setTimeout(() => {
        if (gestureRef.current === gesture) {
          actionsRef.current.endSwipe('touch', event.type === 'touchend');
        }
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
      ) {
        return;
      }
      actionsRef.current.closeParked();
    };
    const onKeyDown = (event: Event) => {
      const { key, shiftKey } = event as KeyboardEvent;
      if (key === 'Escape') {
        const restoreFocus = isNodeInside(stripRef.current, doc.activeElement);
        actionsRef.current.closeParked();
        if (restoreFocus) {
          const cardButton =
            trackRef.current?.querySelector?.<HTMLElement>('[data-thread-root-id]') ??
            trackRef.current?.querySelector?.<HTMLElement>('button');
          cardButton?.focus({ preventScroll: true });
        }
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
          if (event.detail === 0) {
            if (parkedRef.current) closeParked();
            return;
          }
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
