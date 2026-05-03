import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import { hasInteractiveSwipeOwnership } from './swipeGestureFlag';

const EDGE_START_MAX_X = 28;
const MIN_SWIPE_DISTANCE_X = 72;
const MAX_VERTICAL_DRIFT = 64;
const HANDLED_EVENT_FLAG = '__mindroomEdgeSwipeForwardHandled';

type TouchEventWithFlag = TouchEvent & {
  [HANDLED_EVENT_FLAG]?: boolean;
};

export const useEdgeSwipeForward = (onForward: () => void, enabled: boolean = true): void => {
  const onForwardRef = useRef(onForward);
  const imageViewerOpen = useAtomValue(imageViewerOpenAtom);

  useEffect(() => {
    onForwardRef.current = onForward;
  }, [onForward]);

  useEffect(() => {
    if (!enabled) return;
    if (imageViewerOpen) return;
    if (typeof window === 'undefined') return;

    let tracking = false;
    let startX = 0;
    let startY = 0;
    let triggered = false;

    const reset = () => {
      tracking = false;
      triggered = false;
      startX = 0;
      startY = 0;
    };

    const handleTouchStart = (evt: TouchEventWithFlag) => {
      if (hasInteractiveSwipeOwnership(evt)) return;
      if (evt[HANDLED_EVENT_FLAG]) return;
      if (evt.touches.length !== 1) {
        reset();
        return;
      }

      const touch = evt.touches[0];
      if (touch.clientX < window.innerWidth - EDGE_START_MAX_X) {
        reset();
        return;
      }

      tracking = true;
      triggered = false;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchMove = (evt: TouchEventWithFlag) => {
      if (hasInteractiveSwipeOwnership(evt)) {
        reset();
        return;
      }
      if (!tracking || triggered || evt[HANDLED_EVENT_FLAG]) return;
      if (evt.touches.length !== 1) {
        reset();
        return;
      }

      const touch = evt.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaY > MAX_VERTICAL_DRIFT && absDeltaY > Math.abs(deltaX)) {
        reset();
        return;
      }

      if (deltaX < -8 && absDeltaY <= MAX_VERTICAL_DRIFT) {
        evt.preventDefault();
      }

      if (-deltaX >= MIN_SWIPE_DISTANCE_X && absDeltaY <= MAX_VERTICAL_DRIFT) {
        evt[HANDLED_EVENT_FLAG] = true;
        triggered = true;
        tracking = false;
        onForwardRef.current();
      }
    };

    const handleTouchEnd = () => {
      reset();
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [enabled, imageViewerOpen]);
};
