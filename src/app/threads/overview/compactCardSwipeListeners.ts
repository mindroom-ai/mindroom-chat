import { type RefObject, useEffect } from 'react';

// Ignore tiny residual vertical momentum right after parking a card on a trackpad.
export const PARK_SCROLL_DISMISS_THRESHOLD = 8;

export const isNodeInside = (el: HTMLElement | null, target: EventTarget | null): boolean =>
  Boolean(
    el &&
    target &&
    (el === target ||
      (typeof el.contains === 'function' &&
        (typeof Node === 'undefined' || target instanceof Node) &&
        el.contains(target as Node)))
  );

export const focusCompactCardButton = (track: HTMLElement | null): void => {
  const cardButton =
    track?.querySelector?.<HTMLElement>('[data-thread-root-id]') ??
    track?.querySelector?.<HTMLElement>('button');
  cardButton?.focus({ preventScroll: true });
};

const getScrollTop = (target: EventTarget | null, doc: Document): number | undefined => {
  if (!target || target === doc) {
    const root = doc.scrollingElement ?? doc.documentElement;
    if (root && typeof root.scrollTop === 'number') return root.scrollTop;
    return typeof doc.defaultView?.scrollY === 'number' ? doc.defaultView.scrollY : undefined;
  }
  return 'scrollTop' in target && typeof (target as HTMLElement).scrollTop === 'number'
    ? (target as HTMLElement).scrollTop
    : undefined;
};

/** Document touch/visibility safety net: no swipe outlives its touch or a hidden page. */
export const useTouchSwipeSafetyNet = (
  trackRef: RefObject<HTMLDivElement | null>,
  gestureRef: RefObject<{ swipe?: unknown } | undefined>,
  actionsRef: RefObject<{
    endSwipe: (source: 'touch' | 'trackpad', commit: boolean) => void;
    abortAll: () => void;
  }>
): void => {
  useEffect(() => {
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const handleTouchStart = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (gesture && (event.touches.length > 1 || gesture.swipe)) {
        actionsRef.current.endSwipe('touch', false);
      }
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture?.swipe || event.touches.length > 0) return;
      setTimeout(() => {
        if (gestureRef.current === gesture) {
          actionsRef.current.endSwipe('touch', event.type === 'touchend');
        }
      }, 0);
    };
    const handleVisibilityChange = () => {
      if (doc.visibilityState === 'hidden') actionsRef.current.abortAll();
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
  }, [actionsRef, gestureRef, trackRef]);
};

/** Dismisses a parked swipe tray on outside tap/click, Escape, contextmenu, or real vertical scroll. */
export const useParkedCardDismissal = (
  parked: boolean,
  trackRef: RefObject<HTMLDivElement | null>,
  stripRef: RefObject<HTMLDivElement | null>,
  actionsRef: RefObject<{ closeParked: () => void }>
): void => {
  useEffect(() => {
    if (!parked) return undefined;
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const parkedScrollTop = new Map<EventTarget, number>();
    const recordScrollTop = (target: EventTarget | null) => {
      if (!target) return;
      const top = getScrollTop(target, doc);
      if (top !== undefined) parkedScrollTop.set(target, top);
    };
    recordScrollTop(doc);
    recordScrollTop(doc.documentElement ?? null);
    for (let el: HTMLElement | null = trackRef.current; el; el = el.parentElement ?? null) {
      recordScrollTop(el);
    }
    const onPointerDown = (event: Event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (
        path.includes(trackRef.current!) ||
        path.includes(stripRef.current!) ||
        isNodeInside(trackRef.current, event.target) ||
        isNodeInside(stripRef.current, event.target)
      ) {
        return;
      }
      actionsRef.current.closeParked();
    };
    const onKeyDown = (event: Event) => {
      const { key, shiftKey } = event as KeyboardEvent;
      if (key === 'Escape') {
        const restoreFocus = isNodeInside(stripRef.current, doc.activeElement);
        actionsRef.current.closeParked();
        if (restoreFocus) focusCompactCardButton(trackRef.current);
        event.preventDefault();
        event.stopPropagation();
      } else if (key === 'ContextMenu' || (shiftKey && key === 'F10')) {
        actionsRef.current.closeParked();
      }
    };
    const onScroll = (event: Event) => {
      const t = event.target;
      if (
        t &&
        t !== doc &&
        !(doc.documentElement && t === doc.documentElement) &&
        !isNodeInside(t as HTMLElement, trackRef.current)
      ) {
        return;
      }
      const currentTop = getScrollTop(t, doc);
      const startTop = parkedScrollTop.get(t ?? doc);
      if (
        currentTop !== undefined &&
        startTop !== undefined &&
        Math.abs(currentTop - startTop) <= PARK_SCROLL_DISMISS_THRESHOLD
      ) {
        return;
      }
      actionsRef.current.closeParked();
    };
    const onContextMenu = () => actionsRef.current.closeParked();
    const listeners: Array<[string, EventListener, AddEventListenerOptions]> = [
      ['pointerdown', onPointerDown, { capture: true, passive: true }],
      ['keydown', onKeyDown, { capture: true }],
      ['scroll', onScroll, { capture: true, passive: true }],
      ['contextmenu', onContextMenu, { capture: true, passive: true }],
    ];
    listeners.forEach(([type, fn, opts]) => doc.addEventListener(type, fn, opts));
    return () =>
      listeners.forEach(([type, fn]) => doc.removeEventListener(type, fn, { capture: true }));
  }, [actionsRef, parked, stripRef, trackRef]);
};
