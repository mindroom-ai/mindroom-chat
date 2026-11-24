import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { STATUS_BAR_SCROLL_TOP_EVENT } from '../native/statusBarTapScroll';
import { SCROLL_SESSION_STALE_MS, hasActiveWindowTouches } from './scrollQuiescence';
import {
  HEADROOM_IDLE_REST_MS,
  TOP_UP_LOW_WATER_VIEWPORTS,
  computeTrimPlan,
  isScrollerRubberBanding,
  resolveReserveEntryTarget,
  type ThreadScrollOwnerState,
} from './threadScrollHeadroom';

const PROGRAMMATIC_SCROLL_ECHO_MS = 120;

const supportsScrollEndEvents = (): boolean =>
  typeof window !== 'undefined' && 'onscrollend' in window;

export const shouldArmOwnerIdleWork = ({
  owner,
  scrollTop,
  viewHeight,
  viewWidth,
  hasMoreHistory,
  threadUserScrolled,
  threadEventsLength,
  unmeasuredAbove,
}: {
  owner: ThreadScrollOwnerState;
  scrollTop: number;
  viewHeight: number;
  viewWidth: number;
  hasMoreHistory: boolean;
  threadUserScrolled: boolean;
  threadEventsLength: number;
  unmeasuredAbove: number;
}): boolean => {
  if (owner.heldRawEvents !== undefined) return true;
  if (
    !hasMoreHistory &&
    owner.committedHeadroomPx > 0 &&
    threadEventsLength > 0 &&
    computeTrimPlan({
      headroomPx: owner.committedHeadroomPx,
      scrollTop,
      viewHeight,
      viewWidth,
      unmeasuredAbove,
    }) !== undefined
  ) {
    return true;
  }
  return (
    hasMoreHistory &&
    threadUserScrolled &&
    owner.committedHeadroomPx < viewHeight * TOP_UP_LOW_WATER_VIEWPORTS
  );
};

export const isOwnerScrollerAtRest = (
  owner: ThreadScrollOwnerState,
  el: HTMLElement | null
): boolean => {
  if (!el || !el.isConnected) return false;
  if (hasActiveWindowTouches()) return false;
  if (el.dataset.scrollbarDragging === 'true') return false;
  if (isScrollerRubberBanding(el)) return false;
  const now = Date.now();
  if (owner.lastActivityAt > 0 && now - owner.lastActivityAt < HEADROOM_IDLE_REST_MS) {
    return false;
  }
  const sessionStillLive =
    owner.scrollSessionLive && now - owner.lastScrollEventAt < SCROLL_SESSION_STALE_MS;
  if (sessionStillLive) return false;
  return el.scrollTop === owner.sampledScrollTop;
};

/**
 * Tracks user scroll/wheel/touch activity, footer/viewport resize, status-bar tap,
 * and genuine idle rest. Never writes `scrollTop`; only enqueues pending facts and
 * bumps the owner's commit tick.
 */
export const useThreadScrollRestObserver = ({
  owner,
  ownerEnabled,
  threadId,
  hasMoreHistory,
  threadUserScrolled,
  getScrollElement,
  footerProbeRef,
  armIdleRef,
}: {
  owner: ThreadScrollOwnerState;
  ownerEnabled: boolean;
  threadId: string | undefined;
  hasMoreHistory: boolean;
  threadUserScrolled: boolean;
  getScrollElement: () => HTMLDivElement | null;
  footerProbeRef?: RefObject<HTMLElement>;
  armIdleRef: MutableRefObject<() => void>;
}): void => {
  const latestRef = useRef({ hasMoreHistory, threadUserScrolled });
  latestRef.current = { hasMoreHistory, threadUserScrolled };

  useEffect(() => {
    if (!ownerEnabled || !threadId) return undefined;
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const needsIdleWork = (): boolean => {
      const cur = latestRef.current;
      if (owner.heldRawEvents !== undefined) return true;
      const viewH = Math.max(300, scrollElement.clientHeight || 900);
      if (!cur.hasMoreHistory && owner.committedHeadroomPx > 0) {
        const plan = computeTrimPlan({
          headroomPx: owner.committedHeadroomPx,
          scrollTop: scrollElement.scrollTop,
          viewHeight: viewH,
          viewWidth: scrollElement.clientWidth || 1200,
          unmeasuredAbove: 0,
        });
        if (plan !== undefined) return true;
      }
      return (
        cur.hasMoreHistory &&
        cur.threadUserScrolled &&
        owner.committedHeadroomPx < viewH * TOP_UP_LOW_WATER_VIEWPORTS
      );
    };

    const scheduleCheck = (delayMs: number) => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      owner.sampledScrollTop = scrollElement.scrollTop;
      idleTimer = setTimeout(() => {
        idleTimer = undefined;
        if (!scrollElement.isConnected) return;
        const currentTop = scrollElement.scrollTop;
        if (currentTop !== owner.sampledScrollTop) {
          owner.sampledScrollTop = currentTop;
          owner.lastActivityAt = Date.now();
          scheduleCheck(HEADROOM_IDLE_REST_MS);
          return;
        }
        const now = Date.now();
        const elapsed =
          owner.lastActivityAt > 0 ? now - owner.lastActivityAt : HEADROOM_IDLE_REST_MS;
        const sessionStillLive =
          owner.scrollSessionLive && now - owner.lastScrollEventAt < SCROLL_SESSION_STALE_MS;
        if (
          hasActiveWindowTouches() ||
          scrollElement.dataset.scrollbarDragging === 'true' ||
          isScrollerRubberBanding(scrollElement) ||
          sessionStillLive ||
          elapsed < HEADROOM_IDLE_REST_MS
        ) {
          const nextDelay = Math.max(
            60,
            elapsed < HEADROOM_IDLE_REST_MS ? HEADROOM_IDLE_REST_MS - elapsed : 120
          );
          scheduleCheck(nextDelay);
          return;
        }
        if (needsIdleWork()) {
          owner.idleIntentQueued = true;
          owner.bumpCommitTick();
        }
      }, delayMs);
    };

    const markUserActivity = (fromScrollEvent: boolean) => {
      const now = Date.now();
      const top = scrollElement.scrollTop;
      if (
        fromScrollEvent &&
        owner.lastProgrammaticScrollTop !== undefined &&
        Math.abs(top - owner.lastProgrammaticScrollTop) <= 1.5 &&
        now - owner.lastProgrammaticWriteAt < PROGRAMMATIC_SCROLL_ECHO_MS
      ) {
        owner.sampledScrollTop = top;
        return;
      }
      owner.lastActivityAt = now;
      owner.idleIntentQueued = false;
      if (fromScrollEvent) {
        if (supportsScrollEndEvents()) {
          owner.scrollSessionLive = true;
          owner.lastScrollEventAt = now;
        }
        const distBelow = scrollElement.scrollHeight - scrollElement.clientHeight - top;
        if (distBelow > 2 && owner.lastPinnedTop !== undefined && top < owner.lastPinnedTop - 1) {
          owner.bottomPinned = false;
        } else if (
          distBelow <= 2 &&
          !hasActiveWindowTouches() &&
          scrollElement.dataset.scrollbarDragging !== 'true'
        ) {
          owner.bottomPinned = true;
          owner.lastPinnedTop = top;
        }
        const clampTarget = resolveReserveEntryTarget(top, owner.committedHeadroomPx);
        if (clampTarget !== undefined) {
          owner.pendingFacts.push({ kind: 'clamp-reserve', target: clampTarget });
          owner.bumpCommitTick();
        }
      }
      scheduleCheck(HEADROOM_IDLE_REST_MS);
    };

    const onScroll = () => markUserActivity(true);
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) owner.bottomPinned = false;
      markUserActivity(false);
    };
    const onTouchStart = () => {
      markUserActivity(false);
    };
    const onTouchMove = () => {
      owner.bottomPinned = false;
      markUserActivity(false);
    };
    const onTouchOrPointerEnd = () => {
      owner.lastActivityAt = Math.max(owner.lastActivityAt, Date.now());
      scheduleCheck(HEADROOM_IDLE_REST_MS);
    };
    const onScrollEnd = () => {
      owner.scrollSessionLive = false;
      const now = Date.now();
      const remaining =
        owner.lastActivityAt > 0
          ? Math.max(50, HEADROOM_IDLE_REST_MS - (now - owner.lastActivityAt))
          : 50;
      scheduleCheck(remaining);
    };
    const onStatusBarScrollTop = () => {
      owner.bottomPinned = false;
      owner.pendingFacts.push({ kind: 'status-bar-top' });
      owner.bumpCommitTick();
    };

    armIdleRef.current = () => {
      if (!needsIdleWork()) return;
      const now = Date.now();
      const elapsed = owner.lastActivityAt > 0 ? now - owner.lastActivityAt : HEADROOM_IDLE_REST_MS;
      const delay = elapsed >= HEADROOM_IDLE_REST_MS ? 60 : HEADROOM_IDLE_REST_MS - elapsed;
      scheduleCheck(delay);
    };

    let resizeObserver: ResizeObserver | undefined;
    const probe = footerProbeRef?.current;
    if (typeof ResizeObserver !== 'undefined') {
      let inset = probe?.offsetHeight ?? 0;
      let viewHeight = scrollElement.clientHeight;
      let viewWidth = scrollElement.getBoundingClientRect().width;
      resizeObserver = new ResizeObserver(() => {
        const nextInset = probe?.offsetHeight ?? 0;
        const nextViewHeight = scrollElement.clientHeight;
        const nextViewWidth = scrollElement.getBoundingClientRect().width;
        const covered = nextInset - inset + (viewHeight - nextViewHeight);
        const rewrapped = nextViewWidth !== viewWidth;
        inset = nextInset;
        viewHeight = nextViewHeight;
        viewWidth = nextViewWidth;
        if (
          owner.bottomPinned &&
          (covered > 0 || rewrapped) &&
          !hasActiveWindowTouches() &&
          scrollElement.dataset.scrollbarDragging !== 'true'
        ) {
          owner.pendingFacts.push({ kind: 'pin-bottom', behavior: 'instant' });
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(() => {
              if (scrollElement.isConnected) flushSync(() => owner.bumpCommitTick());
            });
          } else {
            owner.bumpCommitTick();
          }
        }
      });
      resizeObserver.observe(scrollElement);
      if (probe) resizeObserver.observe(probe);
    }

    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    scrollElement.addEventListener('wheel', onWheel, { passive: true, capture: true });
    scrollElement.addEventListener('scrollend', onScrollEnd, { passive: true });
    scrollElement.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    scrollElement.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    scrollElement.addEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onStatusBarScrollTop);
    window.addEventListener('touchend', onTouchOrPointerEnd, { passive: true, capture: true });
    window.addEventListener('touchcancel', onTouchOrPointerEnd, { passive: true, capture: true });
    window.addEventListener('pointerup', onTouchOrPointerEnd, { passive: true, capture: true });

    armIdleRef.current();

    return () => {
      armIdleRef.current = () => undefined;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      resizeObserver?.disconnect();
      scrollElement.removeEventListener('scroll', onScroll);
      scrollElement.removeEventListener('wheel', onWheel, true);
      scrollElement.removeEventListener('scrollend', onScrollEnd);
      scrollElement.removeEventListener('touchstart', onTouchStart, true);
      scrollElement.removeEventListener('touchmove', onTouchMove, true);
      scrollElement.removeEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onStatusBarScrollTop);
      window.removeEventListener('touchend', onTouchOrPointerEnd, true);
      window.removeEventListener('touchcancel', onTouchOrPointerEnd, true);
      window.removeEventListener('pointerup', onTouchOrPointerEnd, true);
    };
  }, [armIdleRef, footerProbeRef, getScrollElement, hasMoreHistory, owner, ownerEnabled, threadId]);
};
