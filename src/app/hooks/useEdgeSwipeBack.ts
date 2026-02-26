import { useEffect, useRef } from 'react';

const EDGE_START_MAX_X = 28;
const MIN_SWIPE_DISTANCE_X = 72;
const MAX_VERTICAL_DRIFT = 64;
const HANDLED_EVENT_FLAG = '__mindroomEdgeSwipeBackHandled';

type TouchEventWithFlag = TouchEvent & {
  [HANDLED_EVENT_FLAG]?: boolean;
};

export const useEdgeSwipeBack = (onBack: () => void, enabled: boolean = true): void => {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!enabled) return;
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
      if (evt[HANDLED_EVENT_FLAG]) return;
      if (evt.touches.length !== 1) {
        reset();
        return;
      }

      const touch = evt.touches[0];
      if (touch.clientX > EDGE_START_MAX_X) {
        reset();
        return;
      }

      tracking = true;
      triggered = false;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchMove = (evt: TouchEventWithFlag) => {
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

      if (deltaX > 8 && absDeltaY <= MAX_VERTICAL_DRIFT) {
        evt.preventDefault();
      }

      if (deltaX >= MIN_SWIPE_DISTANCE_X && absDeltaY <= MAX_VERTICAL_DRIFT) {
        evt[HANDLED_EVENT_FLAG] = true;
        triggered = true;
        tracking = false;
        onBackRef.current();
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
  }, [enabled]);
};
