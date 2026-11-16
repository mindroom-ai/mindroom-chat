import React, {
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
import { EDGE_START_MAX_X } from '../../navigation/useEdgeSwipe';
import * as css from './CompactCardSwipe.css';

// How far a touch moves before it counts as a swipe or a scroll.
const AXIS_LOCK_DISTANCE = 10;
// Longer than the settle transition. `transitionend` never comes when the
// transition is cancelled, as when a live re-sort moves the row mid-settle.
const SETTLE_FALLBACK_MS = 500;

export const getSwipeThreshold = (cardWidth: number): number =>
  Math.min(160, Math.max(72, cardWidth * 0.35));

type Swipe = {
  // Where the touch was when it locked sideways, so the card does not jump.
  originX: number;
  // The state the strip shows; letting go acts on it even if the thread
  // toggled elsewhere mid-swipe.
  resolved: boolean;
  // 1 when the inline start is on the left, -1 in right-to-left layouts.
  towardStart: 1 | -1;
  width: number;
  threshold: number;
  offset: number;
  armed: boolean;
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  swipe?: Swipe;
};

type Strip = { resolved: boolean; label: string };

// Every card's track, and whether its touch is a sideways swipe now.
const swipingByTrack = new WeakMap<EventTarget, () => boolean>();

/**
 * For the element that holds the swipeable cards, rendered for the caller's
 * whole lifetime, which also carries `SwipeList` (CompactCardSwipe.css.ts).
 * `touch-action: pan-y` alone may let iOS start a vertical pan once a sideways
 * swipe drifts; this keeps the scroller out of a touch a card's swipe owns.
 * React registers touchmove passively, so the listener is native, and there is
 * one for all cards: one on every card costs WebKit on iOS a touch region a
 * card, as a touch-action on every card does.
 */
export const useCompactCardSwipeList = (listRef: RefObject<HTMLElement>): void => {
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const handleTouchMove = (event: TouchEvent) => {
      if (!event.cancelable) return;
      const swiping = event.composedPath().some((target) => swipingByTrack.get(target)?.());
      if (swiping) event.preventDefault();
    };
    list.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => list.removeEventListener('touchmove', handleTouchMove);
  }, [listRef]);
};

export type CompactCardSwipeProps = {
  enabled: boolean;
  resolved: boolean;
  label: string;
  /** Receives whether the thread was resolved when the swipe started. */
  onSwipe: (wasResolved: boolean) => void;
  children: ReactNode;
};

/**
 * Lets a touch swipe a compact card toward the inline start to run its
 * resolve (or reopen) action, revealing the action under the card. Mouse and
 * keyboard users keep the hover buttons and the actions menu. The element that
 * holds the cards calls `useCompactCardSwipeList` and carries `SwipeList`.
 */
export function CompactCardSwipe({
  enabled,
  resolved,
  label,
  onSwipe,
  children,
}: CompactCardSwipeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>();
  const swipedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // Taken when the swipe starts, so the strip keeps naming the action it ran
  // while the card settles over a thread that has already toggled.
  const [strip, setStrip] = useState<Strip>();
  const [settling, setSettling] = useState(false);
  const [armed, setArmed] = useState(false);

  const settle = useCallback(() => {
    clearTimeout(settleTimerRef.current);
    setStrip(undefined);
    setSettling(false);
    setArmed(false);
  }, []);

  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  // The cards' container asks this on every touchmove (`useCompactCardSwipeList`).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    swipingByTrack.set(track, () => !!gestureRef.current?.swipe);
    return () => {
      swipingByTrack.delete(track);
    };
  }, []);

  // A card that leaves the list mid-swipe may show a moment longer as a copy
  // (ui/listMotion.tsx): at rest, without the strip.
  useLayoutEffect(() => {
    const track = trackRef.current;
    return () => {
      if (track) track.style.transform = '';
      // The strip comes with a swipe, after this effect ran: read as the card goes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (stripRef.current) stripRef.current.style.display = 'none';
    };
  }, []);

  // A touch can end without the card being told. A second finger makes it a pinch, which
  // changes the page zoom (theme/usePinchToZoom.ts); the page goes out of sight under the
  // finger; or the browser tells of the lift elsewhere, or not at all: on a phone a card was
  // left swiped with its strip showing, and nothing was sent. No swipe outlives its touch: it
  // lets go, with its action only where the finger lifted. The fingers may land and lift
  // anywhere, so the whole document listens for them.
  const finishRef = useLatestRef((commit: boolean) => finish(commit));
  useEffect(() => {
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const handleTouchStart = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      // A second finger, or the first finger of a new touch while a swipe is still on: its own
      // finger is gone. (A touch's own start comes before it is a swipe.)
      if (gesture && (event.touches.length > 1 || gesture.swipe)) finishRef.current(false);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture?.swipe || event.touches.length > 0) return;
      // After the card's own pointer event of this lift, which ends the swipe where it comes.
      setTimeout(() => {
        if (gestureRef.current === gesture) finishRef.current(event.type === 'touchend');
      }, 0);
    };
    const handleVisibilityChange = () => {
      if (doc.visibilityState === 'hidden') finishRef.current(false);
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
  }, [finishRef]);

  const finish = (commit: boolean) => {
    const swipe = gestureRef.current?.swipe;
    gestureRef.current = undefined;
    if (!swipe) return;
    swipedRef.current = true;
    if (trackRef.current) trackRef.current.style.transform = '';
    if (commit && swipe.armed && enabled) onSwipe(swipe.resolved);
    else setArmed(false);
    // A card already at rest has no transition to wait for.
    if (swipe.offset === 0) {
      settle();
      return;
    }
    setSettling(true);
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(settle, SETTLE_FALLBACK_MS);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // A new first finger: a swipe whose end never came lets go before it.
    if (event.isPrimary) finish(false);
    swipedRef.current = false;
    if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;
    // Edge swipes navigate back and forward; leave those touches to them.
    if (
      event.clientX <= EDGE_START_MAX_X ||
      event.clientX >= window.innerWidth - EDGE_START_MAX_X
    ) {
      return;
    }
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
        return;
      }
      const track = event.currentTarget;
      const { width } = track.getBoundingClientRect();
      gesture.swipe = {
        originX: event.clientX,
        resolved,
        towardStart: getComputedStyle(track).direction === 'rtl' ? -1 : 1,
        width,
        threshold: getSwipeThreshold(width),
        offset: 0,
        armed: false,
      };
      track.setPointerCapture(event.pointerId);
      clearTimeout(settleTimerRef.current);
      setSettling(false);
      setArmed(false);
      setStrip({ resolved, label });
    }
    const { swipe } = gesture;
    swipe.offset = Math.min(
      swipe.width,
      Math.max(0, (swipe.originX - event.clientX) * swipe.towardStart)
    );
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${-swipe.offset * swipe.towardStart}px)`;
    }
    const nextArmed = swipe.offset >= swipe.threshold;
    if (nextArmed !== swipe.armed) {
      swipe.armed = nextArmed;
      setArmed(nextArmed);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (event.pointerId !== gestureRef.current?.pointerId) return;
    finish(commit);
  };

  const trackClassName = [css.SwipeTrack, settling && css.SwipeTrackSettling]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {strip && (
        <div
          ref={stripRef}
          className={css.SwipeAction}
          data-compact-card-swipe="action"
          data-armed={armed ? 'true' : undefined}
          data-resolved={strip.resolved ? 'true' : undefined}
          aria-hidden
        >
          <Icon size="200" src={strip.resolved ? Icons.Reload : Icons.Check} />
          <Text size="B300">{strip.label}</Text>
        </div>
      )}
      <div
        ref={trackRef}
        className={trackClassName}
        data-compact-card-swipe="track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => handlePointerEnd(event, true)}
        onPointerCancel={(event) => handlePointerEnd(event, false)}
        // A live re-sort can move the row out from under the finger, which
        // drops the capture; later events then go to another card. The card
        // button losing the touch's implicit capture to the track also
        // bubbles here, and is not an end.
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) handlePointerEnd(event, false);
        }}
        onClickCapture={(event) => {
          // Keyboard clicks (detail 0) never come from the swipe.
          if (!swipedRef.current || event.detail === 0) return;
          // The touch that swiped the card must not also open it.
          swipedRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
          settle();
        }}
      >
        {children}
      </div>
    </>
  );
}
