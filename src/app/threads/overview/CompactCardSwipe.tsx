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
import { CompactCardSwipeStrip, type SwipePointerHandlers } from './CompactCardSwipeStrip';
import {
  focusCompactCardButton,
  isCardActionTarget,
  useCompactCardSwipeDocumentListeners,
} from './compactCardSwipeListeners';

export { CompactCardSwipeStrip, type CompactCardSwipeStripProps } from './CompactCardSwipeStrip';

// Longer `settleMs` than the settle transition (`transitionend` never comes if a re-sort cancels it).
const SWIPE = {
  lock: 10,
  settleMs: 500,
  parkThreshold: 60,
  parkWidth: 156,
  minVisible: 40,
  closeThreshold: 24,
  parkGap: 12,
} as const;

export const getSwipeThreshold = (cardWidth: number): number =>
  Math.min(160, Math.max(72, cardWidth * 0.35));

export const getDeepThreshold = (cardWidth: number, hasSnooze: boolean): number =>
  hasSnooze
    ? Math.min(200, cardWidth * 0.65, Math.max(SWIPE.parkWidth + SWIPE.parkGap, cardWidth * 0.52))
    : getSwipeThreshold(cardWidth);

export const getParkWidth = (cardWidth: number, deepThreshold: number): number =>
  Math.max(
    0,
    Math.min(
      SWIPE.parkWidth,
      cardWidth - SWIPE.minVisible,
      Math.floor(deepThreshold - SWIPE.parkGap)
    )
  );

type Swipe = {
  originX: number;
  startOffset: number;
  resolved: boolean; // Captured at start so letting go acts on what the strip showed.
  towardStart: 1 | -1; // 1 in LTR, -1 in RTL.
  width: number;
  parkWidth: number;
  deepThreshold: number;
  offset: number;
  armed: boolean;
};
type ActiveGesture =
  | { kind: 'touch'; pointerId: number; startX: number; startY: number; swipe?: Swipe }
  | { kind: 'trackpad'; swipe: Swipe };
type Strip = {
  resolved: boolean;
  snoozed: boolean;
  label: string;
  snoozeLabel?: string;
  parkWidth: number;
};
type SwipeView = { strip: Strip; armed: boolean; parked: boolean; settling: boolean };
type CardHandle = {
  isTouchSwiping: () => boolean;
  claimTrackpad: (deltaX: number, blockedByDom: boolean) => TrackpadSwipeClaim | undefined;
};
type ParkedCard = { track: EventTarget; offset: number; close: () => void };

// Maps each card's track (and revealed tray while mounted) to its swipe handle.
const handleByNode = new WeakMap<EventTarget, CardHandle>();
let activeParked: ParkedCard | undefined;

const closeActiveParked = (exceptTrack?: EventTarget | null) => {
  if (activeParked && activeParked.track !== exceptTrack) activeParked.close();
};

const getTowardStart = (track: HTMLElement): 1 | -1 =>
  getComputedStyle(track).direction === 'rtl' ? -1 : 1;

const shouldPark = (s: Swipe): boolean =>
  s.parkWidth > 0 &&
  s.offset >= Math.min(SWIPE.parkThreshold, s.parkWidth * 0.5) &&
  (s.startOffset === 0 || s.offset >= s.startOffset - SWIPE.closeThreshold);

/**
 * For the element holding swipeable cards (`SwipeList` in CompactCardSwipe.css.ts).
 * Uses one `touchmove` listener for all cards (keeping iOS WebKit to one touch region) and
 * registers a lightweight macOS trackpad swipe claimer with `desktopHistorySwipe`.
 */
export const useCompactCardSwipeList = (listRef: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const onTouchMove = (e: TouchEvent) => {
      if (e.cancelable && e.composedPath().some((n) => handleByNode.get(n)?.isTouchSwiping()))
        e.preventDefault();
    };
    list.addEventListener('touchmove', onTouchMove, { passive: false });
    const stopTrackpad = registerTrackpadSwipeClaimer({
      claim: ({ path, deltaX, blockedByDom }) =>
        path.includes(list)
          ? path
              .map((n) => handleByNode.get(n))
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
      list.removeEventListener('touchmove', onTouchMove);
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
  /** On open cards, enables parking the Snooze/Resolve split tray. Receives live snooze state. */
  onSnooze?: (wasSnoozed: boolean) => void;
  children: ReactNode;
};

/**
 * Lets a touch swipe (or macOS Electron two-finger trackpad swipe) slide a compact card toward
 * inline-start to park a Snooze/Resolve tray or deep-pull to Resolve/Reopen directly. Mouse and
 * keyboard users keep hover buttons and the actions menu. The list calls `useCompactCardSwipeList`.
 */
export function CompactCardSwipe(props: CompactCardSwipeProps) {
  const { enabled, resolved, snoozed = false, snoozeLabel, children } = props;
  const canSnooze = !resolved && Boolean(props.onSnooze && snoozeLabel);
  const propsRef = useLatestRef({ ...props, snoozed, canSnooze });

  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<ActiveGesture>(undefined);
  const swipedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [view, setView] = useState<SwipeView>();

  const getParked = () =>
    trackRef.current && activeParked?.track === trackRef.current ? activeParked : undefined;

  const setTransform = (offset?: number, dir: 1 | -1 = 1) => {
    if (trackRef.current)
      trackRef.current.style.transform =
        offset === undefined ? '' : `translateX(${-offset * dir}px)`;
  };

  const finishTransition = useCallback(() => {
    clearTimeout(settleTimerRef.current);
    setView((v) =>
      trackRef.current && activeParked?.track === trackRef.current
        ? v && { ...v, settling: false }
        : undefined
    );
  }, []);

  const settle = (next: (prev: SwipeView | undefined) => SwipeView | undefined, animate = true) => {
    clearTimeout(settleTimerRef.current);
    setView(next);
    if (animate) settleTimerRef.current = setTimeout(finishTransition, SWIPE.settleMs);
  };

  const closeParked = () => {
    if (!getParked()) return;
    activeParked = undefined;
    const p = propsRef.current;
    setTransform();
    settle(
      (v) =>
        v && {
          strip: p.canSnooze
            ? { ...v.strip, snoozed: p.snoozed, snoozeLabel: p.snoozeLabel }
            : v.strip,
          parked: false,
          armed: false,
          settling: true,
        }
    );
  };

  const startSwipe = (originX: number, initialDelta = 0): Swipe | undefined => {
    const track = trackRef.current;
    const p = propsRef.current;
    if (!track || !p.enabled) return undefined;
    closeActiveParked(track);
    const prev = getParked();
    if (prev) activeParked = undefined;
    const width = track.getBoundingClientRect().width;
    const towardStart = getTowardStart(track);
    const deepThreshold = getDeepThreshold(width, p.canSnooze);
    const parkWidth = p.canSnooze ? getParkWidth(width, deepThreshold) : 0;
    const startOffset = prev?.offset ?? 0;
    const offset = Math.min(width, Math.max(0, startOffset + initialDelta));
    const armed = offset >= deepThreshold;
    const strip: Strip = {
      resolved: p.resolved,
      snoozed: p.snoozed,
      label: p.label,
      snoozeLabel: p.canSnooze ? p.snoozeLabel : undefined,
      parkWidth,
    };
    settle(() => ({ strip, armed, parked: false, settling: false }), false);
    setTransform(offset, towardStart);
    return {
      originX,
      startOffset,
      resolved: p.resolved,
      towardStart,
      width,
      parkWidth,
      deepThreshold,
      offset,
      armed,
    };
  };

  const updateSwipe = (swipe: Swipe, nextOffset: number) => {
    swipe.offset = Math.min(swipe.width, Math.max(0, nextOffset));
    setTransform(swipe.offset, swipe.towardStart);
    const armed = swipe.offset >= swipe.deepThreshold;
    if (armed !== swipe.armed) {
      swipe.armed = armed;
      setView((v) => v && { ...v, armed });
    }
  };

  const completeSwipe = (swipe: Swipe, commit: boolean, fromTouch: boolean) => {
    const track = trackRef.current;
    const p = propsRef.current;
    if (fromTouch) swipedRef.current = true;
    if (track && commit && !swipe.armed && p.canSnooze && p.enabled && shouldPark(swipe)) {
      closeActiveParked(track);
      activeParked = {
        track,
        offset: swipe.parkWidth,
        close: () => actionsRef.current.closeParked(),
      };
      setTransform(swipe.parkWidth, swipe.towardStart);
      const settling = swipe.offset !== swipe.parkWidth;
      settle((v) => v && { ...v, parked: true, armed: false, settling }, settling);
      return;
    }
    setTransform();
    const fire = commit && swipe.armed && p.enabled;
    if (fire) p.onSwipe(swipe.resolved);
    if (swipe.offset === 0) finishTransition();
    else settle((v) => v && { ...v, armed: fire ? v.armed : false, settling: true });
  };

  const endSwipe = (commit: boolean) => {
    const active = activeRef.current;
    activeRef.current = undefined;
    if (active?.swipe) completeSwipe(active.swipe, commit, active.kind === 'touch');
  };

  const abortAll = () => {
    endSwipe(false);
    closeParked();
  };

  const claimTrackpad = (deltaX: number, blockedByDom: boolean): TrackpadSwipeClaim | undefined => {
    const track = trackRef.current;
    if (!track || !propsRef.current.enabled || activeRef.current?.swipe) return undefined;
    const prev = getParked();
    if (!prev && blockedByDom) return undefined;
    const dir = getTowardStart(track);
    const delta = deltaX * dir;
    if (!prev && delta < 0) return undefined; // Closed cards yield to inline-end (Back) swipes.
    const swipe = startSwipe(0, delta);
    if (!swipe) return undefined;
    activeRef.current = { kind: 'trackpad', swipe };
    const ifCurrent = (fn: () => void) => {
      if (activeRef.current?.swipe === swipe) fn();
    };
    return {
      move: (dx) => ifCurrent(() => actionsRef.current.updateSwipe(swipe, swipe.offset + dx * dir)),
      end: () => ifCurrent(() => actionsRef.current.endSwipe(true)),
      cancel: () => ifCurrent(() => actionsRef.current.endSwipe(false)),
      isReadyToCommit: () => activeRef.current?.swipe === swipe && swipe.armed,
    };
  };

  const actionsRef = useLatestRef({ updateSwipe, endSwipe, closeParked, abortAll, claimTrackpad });

  // Register track (and mounted tray) with the list's touchmove handler and macOS trackpad claimer.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    handleByNode.set(track, {
      isTouchSwiping: () => activeRef.current?.kind === 'touch' && !!activeRef.current.swipe,
      claimTrackpad: (dx, blocked) => actionsRef.current.claimTrackpad(dx, blocked),
    });
    return () => void handleByNode.delete(track);
  }, [actionsRef]);

  const hasStrip = Boolean(view);
  useEffect(() => {
    const el = stripRef.current;
    const handle = trackRef.current && handleByNode.get(trackRef.current);
    if (!hasStrip || !el || !handle) return undefined;
    handleByNode.set(el, handle);
    return () => void handleByNode.delete(el);
  }, [hasStrip]);

  // A card leaving the list mid-swipe may show briefly as a copy (`ui/listMotion.tsx`): at rest.
  useLayoutEffect(() => {
    const track = trackRef.current;
    return () => {
      activeRef.current = undefined;
      clearTimeout(settleTimerRef.current);
      if (track && activeParked?.track === track) activeParked = undefined;
      if (track) track.style.transform = '';
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (stripRef.current) stripRef.current.style.display = 'none';
    };
  }, []);

  useEffect(() => {
    if (!enabled) actionsRef.current.abortAll();
    else if (!canSnooze) actionsRef.current.closeParked();
  }, [actionsRef, canSnooze, enabled]);

  useCompactCardSwipeDocumentListeners(
    Boolean(view?.parked),
    trackRef,
    stripRef,
    activeRef,
    actionsRef
  );

  const endTouch = (id: number, commit: boolean) => {
    if (activeRef.current?.kind === 'touch' && id === activeRef.current.pointerId) endSwipe(commit);
  };

  const pointerHandlers: SwipePointerHandlers = {
    onPointerDown: (e) => {
      if (e.currentTarget === stripRef.current && !getParked()) return;
      if (e.isPrimary) endSwipe(false);
      swipedRef.current = false;
      if (!enabled || e.pointerType !== 'touch' || !e.isPrimary) return;
      if (e.clientX <= EDGE_START_MAX_X || e.clientX >= window.innerWidth - EDGE_START_MAX_X)
        return;
      activeRef.current = {
        kind: 'touch',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    onPointerMove: (e) => {
      const active = activeRef.current;
      if (active?.kind !== 'touch' || e.pointerId !== active.pointerId) return;
      if (!active.swipe) {
        const dx = e.clientX - active.startX;
        const dy = e.clientY - active.startY;
        if (Math.abs(dx) < SWIPE.lock && Math.abs(dy) < SWIPE.lock) return;
        const track = trackRef.current;
        if (
          Math.abs(dy) >= Math.abs(dx) ||
          !track ||
          (!getParked() && -dx * getTowardStart(track) <= 0)
        ) {
          activeRef.current = undefined;
          return closeParked();
        }
        const swipe = startSwipe(e.clientX, 0);
        if (!swipe) {
          activeRef.current = undefined;
          return;
        }
        active.swipe = swipe;
        // Capture on the always-mounted track so hiding/unmounting the tray never drops capture.
        track.setPointerCapture?.(e.pointerId);
      }
      const { swipe } = active;
      updateSwipe(swipe, swipe.startOffset + (swipe.originX - e.clientX) * swipe.towardStart);
    },
    onPointerUp: (e) => endTouch(e.pointerId, true),
    onPointerCancel: (e) => endTouch(e.pointerId, false),
    onLostPointerCapture: (e) => {
      if (e.target === e.currentTarget) endTouch(e.pointerId, false);
    },
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>, isTray: boolean) => {
    if (event.detail === 0) {
      if (!isTray) closeParked();
      return;
    }
    if (swipedRef.current) {
      swipedRef.current = false;
    } else if (!isTray && getParked()) {
      closeParked();
      if (isCardActionTarget(event.target, trackRef.current)) return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const runTrayAction = (action: () => void, restoreFocusIfInTray: boolean) => {
    if (!getParked() || !propsRef.current.enabled || !view) return;
    const active = trackRef.current?.ownerDocument?.activeElement ?? null;
    const restoreFocus = restoreFocusIfInTray && Boolean(stripRef.current?.contains(active));
    closeParked();
    if (restoreFocus) focusCompactCardButton(trackRef.current);
    action();
  };

  return (
    <>
      {view && (
        <CompactCardSwipeStrip
          {...view.strip}
          snoozed={view.parked ? snoozed : view.strip.snoozed}
          snoozeLabel={view.parked ? (canSnooze ? snoozeLabel : undefined) : view.strip.snoozeLabel}
          stripRef={stripRef}
          armed={view.armed}
          parked={view.parked}
          onSnoozeClick={() =>
            runTrayAction(
              () => propsRef.current.onSnooze?.(propsRef.current.snoozed),
              propsRef.current.snoozed
            )
          }
          onResolveClick={() =>
            runTrayAction(() => propsRef.current.onSwipe(view.strip.resolved), true)
          }
          {...(view.strip.snoozeLabel !== undefined
            ? { ...pointerHandlers, onClickCapture: (e) => handleClickCapture(e, true) }
            : undefined)}
        />
      )}
      <div
        ref={trackRef}
        className={view?.settling ? `${css.SwipeTrack} ${css.SwipeTrackSettling}` : css.SwipeTrack}
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
