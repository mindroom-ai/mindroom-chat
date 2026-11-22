import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { StoredSession } from '../../matrix/session/sessions';
import type { AccountMenuAccount } from './AccountMenu';

/** How long the pointer must rest on the account avatar before the quick switcher opens. */
export const ACCOUNT_HOLD_MS = 220;

/** How far the pointer may drift, in CSS pixels, before the pending hold is cancelled. */
export const ACCOUNT_HOLD_SLOP = 10;

const ROW_HIT_PADDING_Y = 4;
const ROW_HIT_PADDING_X = 32;
const SUPPRESS_CLICK_TIMEOUT_MS = 400;

// Ref-counted selection hold so concurrent or nested holds restore document styles cleanly.
let selectionHolds = 0;

const holdSelection = (): (() => void) => {
  if (typeof document === 'undefined' || !document.documentElement) {
    return () => undefined;
  }
  const { style } = document.documentElement;
  if (selectionHolds === 0) {
    style.setProperty('-webkit-user-select', 'none');
    style.setProperty('user-select', 'none');
    style.setProperty('-webkit-touch-callout', 'none');
  }
  selectionHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    selectionHolds -= 1;
    if (selectionHolds > 0) return;
    style.removeProperty('-webkit-user-select');
    style.removeProperty('user-select');
    style.removeProperty('-webkit-touch-callout');
  };
};

const isNonEmptyRect = (rect: DOMRect): boolean => rect.right > rect.left || rect.bottom > rect.top;

const isPointInRect = (x: number, y: number, rect: DOMRect): boolean =>
  isNonEmptyRect(rect) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

const hitTestQuickAccountRow = (
  clientX: number,
  clientY: number,
  anchor: HTMLElement,
  menu: HTMLElement | null
): string | undefined => {
  // Releasing back over the trigger avatar cancels cleanly.
  if (isPointInRect(clientX, clientY, anchor.getBoundingClientRect())) {
    return undefined;
  }
  if (!menu) return undefined;

  const rows = menu.querySelectorAll<HTMLElement>('[data-quick-account-session-id]');
  let bestId: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const sessionId = row.getAttribute('data-quick-account-session-id');
    if (!sessionId) continue;
    const rect = row.getBoundingClientRect();
    if (!isNonEmptyRect(rect)) continue;
    const inY =
      clientY >= rect.top - ROW_HIT_PADDING_Y && clientY <= rect.bottom + ROW_HIT_PADDING_Y;
    const inX =
      clientX >= rect.left - ROW_HIT_PADDING_X && clientX <= rect.right + ROW_HIT_PADDING_X;
    if (!inY || !inX) continue;
    const centerY = (rect.top + rect.bottom) / 2;
    const distance = Math.abs(clientY - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = sessionId;
    }
  }

  return bestId;
};

type ActiveGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  anchor: HTMLElement;
  open: boolean;
  hoveredSessionId: string | undefined;
  hasCapture: boolean;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
  removeListeners: () => void;
  removeTouchMove?: () => void;
  releaseSelection?: () => void;
};

const teardownGesture = (gesture: ActiveGesture): void => {
  if (gesture.holdTimer !== undefined) {
    clearTimeout(gesture.holdTimer);
    gesture.holdTimer = undefined;
  }
  gesture.removeListeners();
  gesture.removeTouchMove?.();
  gesture.removeTouchMove = undefined;
  gesture.releaseSelection?.();
  gesture.releaseSelection = undefined;
  if (gesture.hasCapture) {
    gesture.hasCapture = false;
    try {
      if (
        typeof gesture.anchor.hasPointerCapture !== 'function' ||
        gesture.anchor.hasPointerCapture(gesture.pointerId)
      ) {
        gesture.anchor.releasePointerCapture?.(gesture.pointerId);
      }
    } catch {
      // Ignore if capture was already released or the element detached.
    }
  }
};

export type UseAccountHoldSwitchOptions = {
  enabled: boolean;
  others: AccountMenuAccount[];
  onSwitch: (session: StoredSession) => void;
};

export type UseAccountHoldSwitchResult = {
  holdAnchor: HTMLElement | undefined;
  pressing: boolean;
  hoveredSessionId: string | undefined;
  menuRef: RefObject<HTMLDivElement>;
  triggerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
    'data-quick-switch-enabled'?: 'true';
    'data-quick-switch-pressing'?: 'true';
    'data-quick-switch-open'?: 'true';
  };
  close: () => void;
};

/**
 * Press-and-hold gesture for the account avatar button: holding for `ACCOUNT_HOLD_MS` opens a
 * transient quick-switch menu, dragging highlights an account row, and releasing switches to it.
 * A short tap/click falls through untouched to the button's normal `onClick`.
 */
export function useAccountHoldSwitch({
  enabled,
  others,
  onSwitch,
}: UseAccountHoldSwitchOptions): UseAccountHoldSwitchResult {
  const [holdAnchor, setHoldAnchor] = useState<HTMLElement>();
  const [pressing, setPressing] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string>();

  const menuRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<ActiveGesture>();
  const suppressNextClickRef = useRef(false);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const othersRef = useRef(others);
  othersRef.current = others;
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  const clearSuppressNextClick = useCallback(() => {
    suppressNextClickRef.current = false;
    if (suppressClickTimerRef.current !== undefined) {
      clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = undefined;
    }
  }, []);

  const armSuppressNextClick = useCallback(() => {
    clearSuppressNextClick();
    suppressNextClickRef.current = true;
    suppressClickTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressClickTimerRef.current = undefined;
    }, SUPPRESS_CLICK_TIMEOUT_MS);
  }, [clearSuppressNextClick]);

  const close = useCallback(() => {
    const current = gestureRef.current;
    if (!current) return;
    gestureRef.current = undefined;
    teardownGesture(current);
    setPressing(false);
    setHoldAnchor(undefined);
    setHoveredSessionId(undefined);
  }, []);

  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);

  useEffect(
    () => () => {
      const current = gestureRef.current;
      if (current) {
        gestureRef.current = undefined;
        teardownGesture(current);
      }
      if (suppressClickTimerRef.current !== undefined) {
        clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = undefined;
      }
      suppressNextClickRef.current = false;
    },
    []
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (typeof window === 'undefined') return;
      if (!enabledRef.current) return;
      if (event.button !== 0) return;

      const existing = gestureRef.current;
      if (existing) {
        if (event.pointerId !== existing.pointerId) {
          close();
        }
        return;
      }

      clearSuppressNextClick();

      const anchor = event.currentTarget;
      const { pointerId, clientX: startX, clientY: startY } = event;

      const onWindowPointerDown = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId === current.pointerId) return;
        // Multi-touch or a second pointer cancels the hold-and-swipe gesture.
        close();
      };

      const onWindowPointerMove = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;

        if (!current.open) {
          if (
            Math.hypot(winEvent.clientX - current.startX, winEvent.clientY - current.startY) >
            ACCOUNT_HOLD_SLOP
          ) {
            close();
          }
          return;
        }

        const nextHovered = hitTestQuickAccountRow(
          winEvent.clientX,
          winEvent.clientY,
          current.anchor,
          menuRef.current
        );
        if (nextHovered !== current.hoveredSessionId) {
          current.hoveredSessionId = nextHovered;
          setHoveredSessionId(nextHovered);
        }
      };

      const onWindowPointerUp = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;

        const wasOpen = current.open;
        const targetSessionId = current.hoveredSessionId;
        close();

        if (!wasOpen) return;

        armSuppressNextClick();
        if (!targetSessionId) return;
        const match = othersRef.current.find(
          (account) => account.session.sessionId === targetSessionId
        );
        if (match) {
          onSwitchRef.current(match.session);
        }
      };

      const onWindowPointerCancel = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;
        close();
      };

      const onWindowBlur = () => {
        close();
      };

      const onWindowKeyDown = (winEvent: KeyboardEvent) => {
        if (winEvent.key !== 'Escape') return;
        if (gestureRef.current?.open) {
          winEvent.preventDefault();
          winEvent.stopPropagation();
        }
        close();
      };

      window.addEventListener('pointerdown', onWindowPointerDown);
      window.addEventListener('pointermove', onWindowPointerMove);
      window.addEventListener('pointerup', onWindowPointerUp);
      window.addEventListener('pointercancel', onWindowPointerCancel);
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('keydown', onWindowKeyDown, true);

      const removeListeners = () => {
        window.removeEventListener('pointerdown', onWindowPointerDown);
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('pointercancel', onWindowPointerCancel);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('keydown', onWindowKeyDown, true);
      };

      const gesture: ActiveGesture = {
        pointerId,
        startX,
        startY,
        anchor,
        open: false,
        hoveredSessionId: undefined,
        hasCapture: false,
        holdTimer: undefined,
        removeListeners,
      };

      gesture.holdTimer = setTimeout(() => {
        const current = gestureRef.current;
        if (current !== gesture || !enabledRef.current) return;
        current.holdTimer = undefined;
        current.open = true;

        try {
          current.anchor.setPointerCapture?.(current.pointerId);
          current.hasCapture = true;
        } catch {
          current.hasCapture = false;
        }

        current.releaseSelection = holdSelection();
        const selection = window.getSelection?.();
        if (selection && !selection.isCollapsed) {
          selection.removeAllRanges();
        }

        const preventTouchMove = (touchEvent: TouchEvent) => {
          touchEvent.preventDefault();
        };
        window.addEventListener('touchmove', preventTouchMove, { passive: false });
        current.removeTouchMove = () => {
          window.removeEventListener('touchmove', preventTouchMove);
        };

        setPressing(false);
        setHoldAnchor(current.anchor);
        setHoveredSessionId(undefined);
      }, ACCOUNT_HOLD_MS);

      gestureRef.current = gesture;
      setPressing(true);
    },
    [armSuppressNextClick, clearSuppressNextClick, close]
  );

  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!suppressNextClickRef.current) return;
      clearSuppressNextClick();
      event.preventDefault();
      event.stopPropagation();
    },
    [clearSuppressNextClick]
  );

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (gestureRef.current || suppressNextClickRef.current) {
      event.preventDefault();
    }
  }, []);

  return {
    holdAnchor,
    pressing,
    hoveredSessionId,
    menuRef,
    triggerProps: {
      onPointerDown,
      onClickCapture,
      onContextMenu,
      'data-quick-switch-enabled': enabled ? 'true' : undefined,
      'data-quick-switch-pressing': pressing ? 'true' : undefined,
      'data-quick-switch-open': holdAnchor ? 'true' : undefined,
    },
    close,
  };
}
