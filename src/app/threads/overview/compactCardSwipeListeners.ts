import { type RefObject, useEffect } from 'react';
import { hasOpenOverlay } from '../../lib/openOverlay';

// Ignore tiny residual vertical momentum right after parking a card on a trackpad.
const PARK_SCROLL_DRIFT_PX = 8;
const PASSIVE = { capture: true, passive: true } as const;

export const isCardActionTarget = (target: EventTarget | null, track?: Element | null): boolean => {
  const el = target instanceof Element ? target : (target as Node | null)?.parentElement;
  const control = el?.closest('button,a[href],[role="button"]');
  return Boolean(
    control &&
    !control.hasAttribute('data-thread-root-id') &&
    (!(track instanceof Node) || !control.contains(track))
  );
};

export const focusCompactCardButton = (track: HTMLElement | null): void =>
  (
    track?.querySelector<HTMLElement>('[data-thread-root-id]') ??
    track?.querySelector<HTMLElement>('button')
  )?.focus({ preventScroll: true });

const getScrollTop = (target: EventTarget | null, doc: Document): number | undefined => {
  const el = !target || target === doc ? (doc.scrollingElement ?? doc.documentElement) : target;
  return el instanceof Element ? el.scrollTop : undefined;
};

const listen = (
  doc: Document,
  entries: Array<[string, EventListener, AddEventListenerOptions]>
) => {
  entries.forEach(([type, fn, opts]) => doc.addEventListener(type, fn, opts));
  return () => entries.forEach(([type, fn, opts]) => doc.removeEventListener(type, fn, opts));
};

/** Document safety net (touch/visibility) and parked-tray dismissal listeners. */
export const useCompactCardSwipeDocumentListeners = (
  parked: boolean,
  trackRef: RefObject<HTMLDivElement | null>,
  stripRef: RefObject<HTMLDivElement | null>,
  activeRef: RefObject<{ kind: 'touch' | 'trackpad'; swipe?: unknown } | undefined>,
  actionsRef: RefObject<{
    endSwipe: (commit: boolean) => void;
    closeParked: () => void;
    abortAll: () => void;
  }>
): void => {
  // No touch swipe outlives its touch or a hidden page.
  useEffect(() => {
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const onTouchStart = (e: Event) => {
      const a = activeRef.current;
      if (a?.kind === 'touch' && ((e as TouchEvent).touches.length > 1 || a.swipe))
        actionsRef.current.endSwipe(false);
    };
    const onTouchEnd = (e: Event) => {
      const a = activeRef.current;
      if (a?.kind !== 'touch' || !a.swipe || (e as TouchEvent).touches.length > 0) return;
      setTimeout(() => {
        if (activeRef.current === a) actionsRef.current.endSwipe(e.type === 'touchend');
      }, 0);
    };
    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') actionsRef.current.abortAll();
    };
    return listen(doc, [
      ['touchstart', onTouchStart, PASSIVE],
      ['touchend', onTouchEnd, PASSIVE],
      ['touchcancel', onTouchEnd, PASSIVE],
      ['visibilitychange', onVisibility, {}],
    ]);
  }, [actionsRef, activeRef, trackRef]);

  // Dismiss a parked tray on outside pointerdown, Escape, contextmenu, or real vertical scroll.
  useEffect(() => {
    if (!parked) return undefined;
    const doc = trackRef.current?.ownerDocument;
    if (!doc) return undefined;
    const startTop = new Map<EventTarget, number>();
    const record = (t: EventTarget | null) => {
      const top = t ? getScrollTop(t, doc) : undefined;
      if (t && top !== undefined) startTop.set(t, top);
    };
    record(doc);
    for (let el: HTMLElement | null = trackRef.current; el; el = el.parentElement) record(el);

    const onPointerDown = (e: Event) => {
      const t = e.target as Node | null;
      if (!trackRef.current?.contains(t) && !stripRef.current?.contains(t))
        actionsRef.current.closeParked();
    };
    const onKeyDown = (e: Event) => {
      const { key, shiftKey } = e as KeyboardEvent;
      if (key === 'ContextMenu' || (shiftKey && key === 'F10')) {
        actionsRef.current.closeParked();
      } else if (key === 'Escape' && !hasOpenOverlay()) {
        const inStrip = Boolean(stripRef.current?.contains(doc.activeElement));
        const inCard = inStrip || Boolean(trackRef.current?.contains(doc.activeElement));
        actionsRef.current.closeParked();
        if (!inCard) return;
        if (inStrip) focusCompactCardButton(trackRef.current);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      const isAncestor =
        !t ||
        t === doc ||
        t === doc.documentElement ||
        (t instanceof Element && t.contains(trackRef.current));
      if (!isAncestor) return;
      const top = getScrollTop(t, doc);
      const start = startTop.get(t ?? doc);
      if (top === undefined || start === undefined || Math.abs(top - start) > PARK_SCROLL_DRIFT_PX)
        actionsRef.current.closeParked();
    };
    return listen(doc, [
      ['pointerdown', onPointerDown, PASSIVE],
      ['keydown', onKeyDown, { capture: true }],
      ['scroll', onScroll, PASSIVE],
      ['contextmenu', () => actionsRef.current.closeParked(), PASSIVE],
    ]);
  }, [actionsRef, parked, stripRef, trackRef]);
};
