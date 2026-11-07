import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { conversationHiddenAtom } from './conversationCover';
import { imageViewerOpenAtom } from './imageViewerState';
import { phoneLayerOpenAtom } from './phoneNavDrawer';
import { hasBlockingPortalOverlay } from '../lib/portalOverlay';
import { isIOSStandaloneWebApp } from '../native/nativeSso';

export const EDGE_START_MAX_X = 28;
const MIN_SWIPE_DISTANCE_X = 72;
const MAX_VERTICAL_DRIFT = 64;
const HANDLED_EVENT_FLAG = '__mindroomEdgeSwipeHandled';

type TouchEventWithFlag = TouchEvent & {
  [HANDLED_EVENT_FLAG]?: boolean;
};

export type EdgeSwipeDirection = 'back' | 'forward';

export const useEdgeSwipe = ({
  blockStandaloneWebApp = false,
  direction,
  enabled = true,
  onSwipe,
}: {
  blockStandaloneWebApp?: boolean;
  direction: EdgeSwipeDirection;
  enabled?: boolean;
  onSwipe: () => void;
}): void => {
  const onSwipeRef = useRef(onSwipe);
  const imageViewerOpen = useAtomValue(imageViewerOpenAtom);
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  // The swipes act on the conversation (its thread, its room), which a plugin's cover or a side
  // panel may hide.
  const conversationHidden = useAtomValue(conversationHiddenAtom);
  const standaloneBlocked = blockStandaloneWebApp && isIOSStandaloneWebApp();

  useEffect(() => {
    onSwipeRef.current = onSwipe;
  }, [onSwipe]);

  useEffect(() => {
    if (!enabled || standaloneBlocked || imageViewerOpen || phoneLayerOpen || conversationHidden) {
      return;
    }
    if (typeof window === 'undefined') return;

    let tracking = false;
    // Far enough to go back or forward when the finger lifts. The swipe acts on the lift, not
    // mid-move: a navigation while the finger still moves leaves the rest of the touch to the
    // browser, which takes it as its own back or forward gesture and steps a second time.
    let armed = false;
    let startX = 0;
    let startY = 0;
    const reset = () => {
      tracking = false;
      armed = false;
      startX = 0;
      startY = 0;
    };

    const handleTouchStart = (event: TouchEventWithFlag) => {
      if (event[HANDLED_EVENT_FLAG] || hasBlockingPortalOverlay() || event.touches.length !== 1) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const startsAtEdge =
        direction === 'back'
          ? touch.clientX <= EDGE_START_MAX_X
          : touch.clientX >= window.innerWidth - EDGE_START_MAX_X;
      if (!startsAtEdge) {
        reset();
        return;
      }

      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchMove = (event: TouchEventWithFlag) => {
      if (!tracking || event[HANDLED_EVENT_FLAG]) return;
      if (hasBlockingPortalOverlay() || event.touches.length !== 1) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const directionMultiplier = direction === 'back' ? 1 : -1;
      const distanceX = (touch.clientX - startX) * directionMultiplier;
      const driftY = Math.abs(touch.clientY - startY);
      if (driftY > MAX_VERTICAL_DRIFT && driftY > Math.abs(distanceX)) {
        reset();
        return;
      }

      if (distanceX > 8 && driftY <= MAX_VERTICAL_DRIFT) event.preventDefault();
      armed = distanceX >= MIN_SWIPE_DISTANCE_X && driftY <= MAX_VERTICAL_DRIFT;
      if (armed) event[HANDLED_EVENT_FLAG] = true;
    };

    const handleTouchEnd = () => {
      const swiped = tracking && armed;
      reset();
      if (swiped) onSwipeRef.current();
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', reset);
    };
  }, [conversationHidden, direction, enabled, imageViewerOpen, phoneLayerOpen, standaloneBlocked]);
};
