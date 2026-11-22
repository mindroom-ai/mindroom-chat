import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { holdSelection } from '../../lib/hooks/useLongPress';
import { hasOpenOverlay } from '../../lib/openOverlay';
import type { StoredSession } from '../../matrix/session/sessions';
import type { AccountMenuAccount } from './AccountMenu';

/** How long the pointer must rest on the account avatar before the quick switcher opens. */
export const ACCOUNT_HOLD_MS = 220;

/** How far the pointer may drift, in CSS pixels, before the pending hold is cancelled. */
export const ACCOUNT_HOLD_SLOP = 10;

const ROW_HIT_PADDING_Y = 4;
const EDGE_SCROLL_ZONE_PX = 24;
const EDGE_SCROLL_MAX_PX_PER_SEC = 360;
const SUPPRESS_CLICK_TIMEOUT_MS = 400;

const isNonEmptyRect = (rect: DOMRect): boolean => rect.right > rect.left || rect.bottom > rect.top;

const isPointInRect = (x: number, y: number, rect: DOMRect): boolean =>
  isNonEmptyRect(rect) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

const findScrollList = (menu: HTMLElement | null): HTMLElement | null => {
  if (!menu) return null;
  return menu.querySelector<HTMLElement>('[data-quick-account-list]') ?? menu;
};

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
  const container = findScrollList(menu);
  if (!container) return undefined;

  const containerRect = container.getBoundingClientRect();
  // Never match points outside the visible list bounds horizontally or vertically.
  if (!isPointInRect(clientX, clientY, containerRect)) {
    return undefined;
  }

  const rows = container.querySelectorAll<HTMLElement>('[data-quick-account-session-id]');
  let nearestId: string | undefined;
  let nearestGap = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const sessionId = row.getAttribute('data-quick-account-session-id');
    if (!sessionId) continue;
    const rect = row.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, containerRect.top);
    const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
    const visibleLeft = Math.max(rect.left, containerRect.left);
    const visibleRight = Math.min(rect.right, containerRect.right);
    if (visibleBottom <= visibleTop || visibleRight <= visibleLeft) continue;

    // The row whose visible part holds the pointer wins outright, however near a neighbour is.
    if (clientY >= visibleTop && clientY <= visibleBottom) return sessionId;

    // Otherwise the pointer is in the 2 px gap between rows: the row whose visible edge is nearest
    // takes it, up to 4 px away, and of two equally near the earlier one.
    const gap = clientY < visibleTop ? visibleTop - clientY : clientY - visibleBottom;
    if (gap <= ROW_HIT_PADDING_Y && gap < nearestGap) {
      nearestGap = gap;
      nearestId = sessionId;
    }
  }

  return nearestId;
};

/**
 * Whether a dialog or menu opened over the quick menu after it, such as Settings or the command
 * palette from their shortcuts. Pointer capture keeps sending the held pointer to the avatar, so
 * without this a release where a row was would switch accounts through the layer covering it.
 */
const isCovered = (menu: HTMLElement | null): boolean => !!menu && hasOpenOverlay(menu);

/**
 * Returns a normalized scroll velocity in `[-1, 1]` when `(clientX, clientY)` rests inside the top
 * or bottom edge zone of an overflowing list container, or `0` when no auto-scroll should occur.
 */
const edgeScrollVelocity = (
  clientX: number,
  clientY: number,
  anchor: HTMLElement,
  menu: HTMLElement | null
): { container: HTMLElement; velocity: number } | undefined => {
  if (isPointInRect(clientX, clientY, anchor.getBoundingClientRect())) return undefined;
  const container = findScrollList(menu);
  if (!container) return undefined;
  const maxScroll = container.scrollHeight - container.clientHeight;
  if (maxScroll <= 0) return undefined;

  const rect = container.getBoundingClientRect();
  if (!isPointInRect(clientX, clientY, rect)) return undefined;

  const topEdge = rect.top + EDGE_SCROLL_ZONE_PX;
  if (clientY < topEdge && container.scrollTop > 0) {
    const intensity = Math.min(1, Math.max(0.25, (topEdge - clientY) / EDGE_SCROLL_ZONE_PX));
    return { container, velocity: -intensity };
  }

  const bottomEdge = rect.bottom - EDGE_SCROLL_ZONE_PX;
  if (clientY > bottomEdge && container.scrollTop < maxScroll) {
    const intensity = Math.min(1, Math.max(0.25, (clientY - bottomEdge) / EDGE_SCROLL_ZONE_PX));
    return { container, velocity: intensity };
  }

  return undefined;
};

/**
 * What the pointer that started a gesture is doing as the gesture ends: `lifted` (released or
 * cancelled), `held` (still down: Escape, a second pointer, a covering layer, `enabled` turning
 * false) or `gone` (the window lost focus, so its release may never reach this window).
 */
type PointerAtEnd = 'lifted' | 'held' | 'gone';

type ActiveGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  anchor: HTMLElement;
  open: boolean;
  hoveredSessionId: string | undefined;
  hasCapture: boolean;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
  scrollRafId: number | undefined;
  lastScrollFrameTime: number | undefined;
  removeListeners: () => void;
  removeTouchMove?: () => void;
  releaseSelection?: () => void;
};

const stopEdgeScroll = (gesture: ActiveGesture): void => {
  if (gesture.scrollRafId !== undefined && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(gesture.scrollRafId);
  }
  gesture.scrollRafId = undefined;
  gesture.lastScrollFrameTime = undefined;
};

const teardownGesture = (gesture: ActiveGesture): void => {
  if (gesture.holdTimer !== undefined) {
    clearTimeout(gesture.holdTimer);
    gesture.holdTimer = undefined;
  }
  stopEdgeScroll(gesture);
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
  const removeSuppressListenersRef = useRef<() => void>();

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
    removeSuppressListenersRef.current?.();
    removeSuppressListenersRef.current = undefined;
  }, []);

  /**
   * Suppresses the click a pointer leaves behind when it lifts after its hold opened the menu.
   * With `heldPointerId`, the menu closed while that pointer was still down: suppression stays
   * armed until the pointer lifts. Either way it then lasts a short while, for a lift that leaves
   * no click. Only four things disarm it: the click it swallows, that timer, a new primary press
   * on the avatar, and the window losing focus, after which the lift may happen in another window
   * and never be seen here. A key press never does: its own click passes anyway (`onClickCapture`).
   */
  const armSuppressNextClick = useCallback(
    (heldPointerId?: number) => {
      clearSuppressNextClick();
      suppressNextClickRef.current = true;
      const expireSoon = () => {
        suppressClickTimerRef.current = setTimeout(
          clearSuppressNextClick,
          SUPPRESS_CLICK_TIMEOUT_MS
        );
      };
      const onEnd = (winEvent: PointerEvent) => {
        if (winEvent.pointerId !== heldPointerId) return;
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        expireSoon();
      };
      window.addEventListener('blur', clearSuppressNextClick);
      if (heldPointerId === undefined) {
        expireSoon();
      } else {
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
      }
      removeSuppressListenersRef.current = () => {
        window.removeEventListener('blur', clearSuppressNextClick);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };
    },
    [clearSuppressNextClick]
  );

  const finishGesture = useCallback(
    (pointer: PointerAtEnd) => {
      const current = gestureRef.current;
      if (!current) return;
      const wasOpen = current.open;
      const { pointerId } = current;
      gestureRef.current = undefined;
      teardownGesture(current);
      if (wasOpen && pointer !== 'gone') {
        armSuppressNextClick(pointer === 'held' ? pointerId : undefined);
      }
      setPressing(false);
      setHoldAnchor(undefined);
      setHoveredSessionId(undefined);
    },
    [armSuppressNextClick]
  );

  const close = useCallback(() => {
    finishGesture('held');
  }, [finishGesture]);

  /** Highlights the row under the pointer's last position, the one a release would switch to. */
  const refreshHover = useCallback((gesture: ActiveGesture) => {
    const hovered = hitTestQuickAccountRow(
      gesture.lastX,
      gesture.lastY,
      gesture.anchor,
      menuRef.current
    );
    if (hovered !== gesture.hoveredSessionId) {
      gesture.hoveredSessionId = hovered;
      setHoveredSessionId(hovered);
    }
  }, []);

  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);

  // A wheel or trackpad scrolls the list under a pointer that stays where it is; the highlight
  // follows the rows without waiting for the pointer to move.
  useEffect(() => {
    const list = holdAnchor && findScrollList(menuRef.current);
    if (!list) return undefined;
    const onScroll = () => {
      const current = gestureRef.current;
      if (current?.open) refreshHover(current);
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [holdAnchor, refreshHover]);

  useEffect(
    () => () => {
      const current = gestureRef.current;
      if (current) {
        gestureRef.current = undefined;
        teardownGesture(current);
      }
      clearSuppressNextClick();
    },
    [clearSuppressNextClick]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (typeof window === 'undefined') return;

      const existing = gestureRef.current;
      if (existing) {
        if (event.pointerId !== existing.pointerId) {
          close();
        }
        return;
      }

      if (event.button !== 0 || event.isPrimary === false) return;
      // A fresh primary press starts an independent interaction; never let a stale suppression
      // from a previous hold swallow it (even when `enabled` is currently false).
      clearSuppressNextClick();
      if (!enabledRef.current) return;

      const anchor = event.currentTarget;
      const { pointerId, clientX: startX, clientY: startY } = event;

      const updateHoverAndAutoScroll = (current: ActiveGesture) => {
        refreshHover(current);

        const edge = edgeScrollVelocity(
          current.lastX,
          current.lastY,
          current.anchor,
          menuRef.current
        );
        if (!edge || typeof requestAnimationFrame !== 'function') {
          stopEdgeScroll(current);
          return;
        }
        if (current.scrollRafId !== undefined) return;

        const step = (now: number) => {
          current.scrollRafId = undefined;
          if (gestureRef.current !== current || !current.open) {
            current.lastScrollFrameTime = undefined;
            return;
          }
          const nextEdge = edgeScrollVelocity(
            current.lastX,
            current.lastY,
            current.anchor,
            menuRef.current
          );
          if (!nextEdge) {
            current.lastScrollFrameTime = undefined;
            return;
          }
          const dt =
            current.lastScrollFrameTime === undefined
              ? 16
              : Math.min(32, Math.max(8, now - current.lastScrollFrameTime));
          current.lastScrollFrameTime = now;

          const { container, velocity } = nextEdge;
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          const delta = (EDGE_SCROLL_MAX_PX_PER_SEC * velocity * dt) / 1000;
          const clamped = Math.max(0, Math.min(maxScroll, container.scrollTop + delta));
          const snapped = clamped <= 0.5 ? 0 : clamped >= maxScroll - 0.5 ? maxScroll : clamped;
          container.scrollTop = snapped;
          refreshHover(current);

          if (edgeScrollVelocity(current.lastX, current.lastY, current.anchor, menuRef.current)) {
            current.scrollRafId = requestAnimationFrame(step);
          } else {
            current.lastScrollFrameTime = undefined;
          }
        };

        current.scrollRafId = requestAnimationFrame(step);
      };

      const onWindowPointerDown = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId === current.pointerId) return;
        // Multi-touch or a second pointer cancels the hold-and-swipe gesture.
        close();
      };

      const onWindowPointerMove = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;

        current.lastX = winEvent.clientX;
        current.lastY = winEvent.clientY;

        if (!current.open) {
          if (
            Math.hypot(winEvent.clientX - current.startX, winEvent.clientY - current.startY) >
            ACCOUNT_HOLD_SLOP
          ) {
            close();
          }
          return;
        }

        if (isCovered(menuRef.current)) {
          close();
          return;
        }
        updateHoverAndAutoScroll(current);
      };

      const onWindowPointerUp = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;

        const targetSessionId =
          current.open && !isCovered(menuRef.current)
            ? hitTestQuickAccountRow(
                winEvent.clientX,
                winEvent.clientY,
                current.anchor,
                menuRef.current
              )
            : undefined;
        finishGesture('lifted');

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
        finishGesture('lifted');
      };

      // The pointer may lift in another window: nothing stays behind waiting for it.
      const onWindowBlur = () => {
        finishGesture('gone');
      };

      // Focus moving into a layer that opened over the menu is the first sign of it.
      const onWindowFocusIn = () => {
        if (gestureRef.current?.open && isCovered(menuRef.current)) close();
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
      window.addEventListener('focusin', onWindowFocusIn);
      window.addEventListener('keydown', onWindowKeyDown, true);

      const removeListeners = () => {
        window.removeEventListener('pointerdown', onWindowPointerDown);
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('pointercancel', onWindowPointerCancel);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('focusin', onWindowFocusIn);
        window.removeEventListener('keydown', onWindowKeyDown, true);
      };

      const gesture: ActiveGesture = {
        pointerId,
        startX,
        startY,
        lastX: startX,
        lastY: startY,
        anchor,
        open: false,
        hoveredSessionId: undefined,
        hasCapture: false,
        holdTimer: undefined,
        scrollRafId: undefined,
        lastScrollFrameTime: undefined,
        removeListeners,
      };

      gesture.holdTimer = setTimeout(() => {
        const current = gestureRef.current;
        if (current !== gesture || !enabledRef.current) return;
        current.holdTimer = undefined;
        current.open = true;

        // Dismiss any open or pending hover tooltip on the rail anchor so it cannot cover the menu.
        if (typeof MouseEvent === 'function') {
          current.anchor.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
        }

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
    [clearSuppressNextClick, close, finishGesture, refreshHover]
  );

  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      // Only a pointer's click counts presses (`detail` of 1 or more). Enter, Space and assistive
      // technology click with 0: never the click a lifted pointer leaves behind, so never
      // swallowed, and suppression stays armed for a pointer that is still down.
      if (event.detail === 0 || !suppressNextClickRef.current) return;
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
      'data-quick-switch-pressing': pressing ? 'true' : undefined,
      'data-quick-switch-open': holdAnchor ? 'true' : undefined,
    },
    close,
  };
}
