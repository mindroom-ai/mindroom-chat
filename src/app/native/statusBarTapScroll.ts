/**
 * Tapping the iOS status bar scrolls to the top, as in every iOS app. The system scrolls only the
 * web view's own page, which never scrolls here: the timelines, threads, lists and pages scroll in
 * their own areas. Capacitor's StatusBar plugin reports the tap as a `statusTap` event on the
 * window, and this scrolls the area the reader is looking at instead.
 */

import { isIOSFlickStopped, stopIOSFlick } from '../lib/iosFlickStop';

const SCROLLING_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/**
 * Cancelable event dispatched on the scroll target just before a status-bar tap jumps to the top.
 * Listeners that need to reconcile scroll state (such as clearing an active offset ledger before
 * jumping to `0`) call `preventDefault()` and perform the scroll-to-top themselves.
 */
export const STATUS_BAR_SCROLL_TOP_EVENT = 'mindroom:status-bar-scroll-top';

/**
 * The area the tap scrolls: the nearest one around the middle of the screen that is scrolled
 * down. One already at its top is passed over, so a short code block or menu at the middle of
 * the screen leaves the timeline around it to scroll.
 */
export const statusBarTapScrollTarget = (doc: Document): HTMLElement | undefined => {
  const view = doc.defaultView;
  if (!view) return undefined;
  const hit = doc.elementFromPoint(view.innerWidth / 2, view.innerHeight / 2);
  for (let node = hit; node; node = node.parentElement) {
    if (
      node instanceof view.HTMLElement &&
      node.scrollTop > 0 &&
      (node === doc.scrollingElement ||
        isIOSFlickStopped(node) ||
        SCROLLING_OVERFLOW.has(view.getComputedStyle(node).overflowY))
    )
      return node;
  }
  return undefined;
};

const scrollToTopOnStatusBarTapWithCleanup = (doc: Document): (() => void) | undefined => {
  const target = statusBarTapScrollTarget(doc);
  const view = doc.defaultView;
  if (!target || !view) return undefined;
  target.dispatchEvent(
    new view.WheelEvent('wheel', { bubbles: true, deltaMode: 0, deltaY: -target.scrollTop })
  );
  const restoreFlick = stopIOSFlick(target, view);
  const beforeTop = new view.Event(STATUS_BAR_SCROLL_TOP_EVENT, { cancelable: true });
  target.dispatchEvent(beforeTop);
  if (!beforeTop.defaultPrevented) {
    target.scrollTo({ top: 0 });
  }
  return restoreFlick;
};

/**
 * Scrolls the area under the middle of the screen to its top. A wheel turn up as far as the area
 * goes comes first, so the timelines take the move as the reader's own scroll: they keep it, rather
 * than holding the reader at the newest row or at a row they were opening at, and load older rows
 * once it reaches the top.
 */
export const scrollToTopOnStatusBarTap = (doc: Document): void => {
  scrollToTopOnStatusBarTapWithCleanup(doc);
};

/** Scrolls to the top on every status bar tap; returns what removes the listener. */
export const installStatusBarTapScroll = (view: Window): (() => void) => {
  let restoreLastFlick: (() => void) | undefined;
  const onTap = () => {
    const restore = scrollToTopOnStatusBarTapWithCleanup(view.document);
    if (restore) restoreLastFlick = restore;
  };
  view.addEventListener('statusTap', onTap);
  return () => {
    view.removeEventListener('statusTap', onTap);
    restoreLastFlick?.();
    restoreLastFlick = undefined;
  };
};
