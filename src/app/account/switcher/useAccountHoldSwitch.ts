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
import { OVERLAY_SELECTOR, hasOpenOverlay } from '../../lib/openOverlay';
import { hasBlockingPortalOverlay } from '../../lib/portalOverlay';
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
    // Beside the rows, in the list's padding or over its scrollbar, no row is meant.
    if (clientX < visibleLeft || clientX > visibleRight) continue;

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
 * Remembers the dialogs and menus open as a press starts and returns a check for one that opened
 * since, as Settings or the command palette do from their shortcuts while the hold is pending. One
 * that was open already, such as a phone's members sheet below the top bar, does not cover the
 * avatar that was just pressed, wherever it sits in the page.
 */
const watchForNewOverlay = (): (() => boolean) => {
  const before = new Set(document.querySelectorAll(OVERLAY_SELECTOR));
  const blockedBefore = hasBlockingPortalOverlay();
  return () =>
    (!blockedBefore && hasBlockingPortalOverlay()) ||
    Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(
      (overlay) => !before.has(overlay) && !overlay.closest('[inert]')
    );
};

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
 * false) or `gone` (the window lost focus, so its release may happen in another window and never
 * reach this one).
 */
type PointerAtEnd = 'lifted' | 'held' | 'gone';

type ActiveGesture = {
  pointerId: number;
  /** Whether a dialog or menu opened since the press, for the wait before the menu opens. */
  overlayOpened: () => boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  anchor: HTMLElement;
  open: boolean;
  hoveredSessionId: string | undefined;
  hasCapture: boolean;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ends a touch whose last finger lifted with a touchend alone, if no pointer event ends it. */
  liftTimer?: ReturnType<typeof setTimeout>;
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
  clearTimeout(gesture.liftTimer);
  gesture.liftTimer = undefined;
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
   * - `lifted`: for a short while, since a lift off the avatar leaves no click.
   * - `held`: until the pointer lifts, then for that short while.
   * - `gone`: with no timer and no listener, since the lift may never be seen here. The pointer
   *   may also come back still down and lift on the avatar, and that click is swallowed too.
   *
   * Left armed, it swallows nothing it should not: a click without a pointer (Enter, Space,
   * assistive technology) passes anyway (`onClickCapture`), and a new press on the avatar disarms
   * it before its own click.
   */
  const armSuppressNextClick = useCallback(
    (pointer: PointerAtEnd, pointerId: number) => {
      clearSuppressNextClick();
      suppressNextClickRef.current = true;
      if (pointer === 'gone') return;
      const expireSoon = () => {
        suppressClickTimerRef.current = setTimeout(
          clearSuppressNextClick,
          SUPPRESS_CLICK_TIMEOUT_MS
        );
      };
      if (pointer === 'lifted') {
        expireSoon();
        return;
      }
      const stopWaiting = () => {
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        window.removeEventListener('blur', stopWaiting);
        removeSuppressListenersRef.current = undefined;
      };
      function onEnd(winEvent: PointerEvent) {
        if (winEvent.pointerId !== pointerId) return;
        stopWaiting();
        expireSoon();
      }
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
      // The window losing focus leaves the pointer `gone`: armed, with nothing waiting.
      window.addEventListener('blur', stopWaiting);
      removeSuppressListenersRef.current = stopWaiting;
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
      if (wasOpen) armSuppressNextClick(pointer, pointerId);
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

      if (event.isPrimary === false) return;
      // A new press, with any button, means the pointer of a previous hold has lifted: a
      // suppression still armed for it is stale and must not swallow this press's click (even
      // when `enabled` is currently false).
      clearSuppressNextClick();
      if (event.button !== 0 || !enabledRef.current) return;
      // Control with a mouse's primary button is the press of the context menu on a Mac, which a
      // hold would keep from opening.
      if (event.pointerType === 'mouse' && event.ctrlKey) return;

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

        // A mouse lifts its primary button without a pointerup while another button of a chord
        // stays down, or outside the window before the menu captured the pointer.
        if (winEvent.pointerType === 'mouse' && (winEvent.buttons & 1) === 0) {
          close();
          return;
        }

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

      // The pointer lifted, at `point` when the lift may choose an account: over a visible row of
      // an open menu that nothing covers it switches to that account, anywhere else to none.
      const release = (current: ActiveGesture, point?: { x: number; y: number }) => {
        const targetSessionId =
          point && current.open && !isCovered(menuRef.current)
            ? hitTestQuickAccountRow(point.x, point.y, current.anchor, menuRef.current)
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

      const onWindowPointerUp = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;

        // The last button of a mouse chord to lift is not the one that held the menu open.
        const primaryRelease = winEvent.pointerType !== 'mouse' || winEvent.button === 0;
        release(current, primaryRelease ? { x: winEvent.clientX, y: winEvent.clientY } : undefined);
      };

      const onWindowPointerCancel = (winEvent: PointerEvent) => {
        const current = gestureRef.current;
        if (!current || winEvent.pointerId !== current.pointerId) return;
        release(current);
      };

      // The pointer may lift in another window: no listener stays behind waiting for it.
      const onWindowBlur = () => {
        finishGesture('gone');
      };

      // Focus moving into a layer that opened over the page (while the hold is pending) or over
      // the menu is the first sign of it.
      const onWindowFocusIn = () => {
        const current = gestureRef.current;
        if (!current) return;
        if (current.open ? isCovered(menuRef.current) : current.overlayOpened()) close();
      };

      const onWindowKeyDown = (winEvent: KeyboardEvent) => {
        if (winEvent.key !== 'Escape') return;
        if (gestureRef.current?.open) {
          winEvent.preventDefault();
          winEvent.stopPropagation();
        }
        close();
      };

      // A phone's web view can end a touch with a touchend or touchcancel alone, with no pointerup
      // or pointercancel (iOS WebKit; `CompactCardSwipe` sees the same). The last finger up then
      // ends the gesture as its pointer event would have, a touchend where the finger lifted and
      // a touchcancel without a switch, after that pointer event where one does come.
      const onWindowTouchEnd = (touchEvent: TouchEvent) => {
        const current = gestureRef.current;
        if (!current || touchEvent.touches.length > 0 || current.liftTimer !== undefined) return;
        const lifted = touchEvent.type === 'touchend' ? touchEvent.changedTouches[0] : undefined;
        const liftPoint = lifted && { x: lifted.clientX, y: lifted.clientY };
        current.liftTimer = setTimeout(() => {
          current.liftTimer = undefined;
          if (gestureRef.current === current) release(current, liftPoint);
        }, 0);
      };

      // In the capture phase: a second finger on a control that keeps its presses to itself (a
      // sidebar row that can be dragged) still cancels.
      window.addEventListener('pointerdown', onWindowPointerDown, true);
      if (event.pointerType === 'touch') {
        const early = { capture: true, passive: true };
        window.addEventListener('touchend', onWindowTouchEnd, early);
        window.addEventListener('touchcancel', onWindowTouchEnd, early);
      }
      window.addEventListener('pointermove', onWindowPointerMove);
      window.addEventListener('pointerup', onWindowPointerUp);
      window.addEventListener('pointercancel', onWindowPointerCancel);
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('focusin', onWindowFocusIn);
      window.addEventListener('keydown', onWindowKeyDown, true);

      const removeListeners = () => {
        window.removeEventListener('pointerdown', onWindowPointerDown, true);
        window.removeEventListener('touchend', onWindowTouchEnd, true);
        window.removeEventListener('touchcancel', onWindowTouchEnd, true);
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('pointercancel', onWindowPointerCancel);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('focusin', onWindowFocusIn);
        window.removeEventListener('keydown', onWindowKeyDown, true);
      };

      const gesture: ActiveGesture = {
        pointerId,
        overlayOpened: watchForNewOverlay(),
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
        // Settings or the command palette opened from their shortcut during the wait: the hold
        // ends there, with no menu and nothing to suppress.
        if (current.overlayOpened()) {
          close();
          return;
        }
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
      if (event.detail === 0) return;
      // While the menu is open, the pointer holding it is the only one on the avatar: its click
      // can come before the gesture has ended, where a touch lifts with a touchend alone.
      if (!suppressNextClickRef.current && !gestureRef.current?.open) return;
      clearSuppressNextClick();
      event.preventDefault();
      event.stopPropagation();
    },
    [clearSuppressNextClick]
  );

  // Only the context menu of the press itself, which a long touch asks for while the finger is
  // down. Suppression left armed for a click must not block one a key opens later (Shift+F10).
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (gestureRef.current) event.preventDefault();
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
