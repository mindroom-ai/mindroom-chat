import React, {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import {
  registerTrackpadSwipeClaimer,
  type TrackpadSwipeClaim,
} from '../../navigation/trackpadSwipeClaim';
import { EDGE_START_MAX_X } from '../../navigation/useEdgeSwipe';
import * as css from './CompactCardSwipe.css';
import { CompactCardSwipeStrip } from './CompactCardSwipeStrip';
import {
  focusCompactCardButton,
  isNodeInside,
  useParkedCardDismissal,
  useTouchSwipeSafetyNet,
} from './compactCardSwipeListeners';

export { CompactCardSwipeStrip, type CompactCardSwipeStripProps } from './CompactCardSwipeStrip';

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

  // Also map the mounted tray so touch/trackpad swipes starting over it work smoothly.
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

  useTouchSwipeSafetyNet(trackRef, gestureRef, actionsRef);
  useParkedCardDismissal(parked, trackRef, stripRef, actionsRef);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget === stripRef.current && !parkedRef.current) return;
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
      // Capture on the always-mounted track so hiding/unmounting the tray never drops capture.
      trackRef.current?.setPointerCapture?.(event.pointerId);
    }
    const { swipe } = gesture;
    updateSwipe(swipe, swipe.startOffset + (swipe.originX - event.clientX) * swipe.towardStart);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (event.pointerId === gestureRef.current?.pointerId) endSwipe('touch', commit);
  };

  const pointerHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => handlePointerEnd(event, true),
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => handlePointerEnd(event, false),
    onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) handlePointerEnd(event, false);
    },
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>, isTray: boolean) => {
    if (event.detail === 0) {
      if (!isTray && parkedRef.current) closeParked();
      return;
    }
    if (swipedRef.current) swipedRef.current = false;
    else if (!isTray && parkedRef.current) closeParked();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const runTrayAction = (action: () => void, restoreFocusIfInTray: boolean) => {
    if (!parkedRef.current || !propsRef.current.enabled || !strip) return;
    const doc = trackRef.current?.ownerDocument;
    const shouldRestoreFocus =
      restoreFocusIfInTray && isNodeInside(stripRef.current, doc?.activeElement ?? null);
    closeParked();
    if (shouldRestoreFocus) focusCompactCardButton(trackRef.current);
    action();
  };

  return (
    <>
      {strip && (
        <CompactCardSwipeStrip
          {...strip}
          stripRef={stripRef}
          armed={armed}
          parked={parked}
          onSnoozeClick={() =>
            runTrayAction(() => propsRef.current.onSnooze?.(strip.snoozed), strip.snoozed)
          }
          onResolveClick={() => runTrayAction(() => propsRef.current.onSwipe(strip.resolved), true)}
          {...(strip.snoozeLabel !== undefined
            ? { ...pointerHandlers, onClickCapture: (e) => handleClickCapture(e, true) }
            : undefined)}
        />
      )}
      <div
        ref={trackRef}
        className={[css.SwipeTrack, settling && css.SwipeTrackSettling].filter(Boolean).join(' ')}
        data-compact-card-swipe="track"
        {...pointerHandlers}
        onClickCapture={(e) => handleClickCapture(e, false)}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform') finishTransition();
        }}
      >
        {children}
      </div>
    </>
  );
}
