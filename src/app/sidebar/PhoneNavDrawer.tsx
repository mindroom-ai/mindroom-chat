import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useLocation, useMatches, useNavigationType } from 'react-router-dom';
import {
  nextPhoneNavDrawerOpen,
  phoneNavDrawerOpenAtom,
  phoneNavSlotAtom,
} from '../navigation/phoneNavDrawer';
import { isSectionRootHandle } from '../routes/sectionRoot';
import { hasBlockingPortalOverlay } from '../lib/portalOverlay';
import { useInert } from '../lib/hooks/useInert';
import { PHONE_NAV_DRAWER_ID, PHONE_NAV_MENU_BUTTON_ID } from './PhoneTopBar';
import * as css from './PhoneNavDrawer.css';

/** How long the drawer keeps its content after it was put away: until it has slid out. */
const SLIDE_OUT_MS = 320;
/** How far a finger moves the drawer toward its edge to put it away. */
const CLOSE_SWIPE_DISTANCE = 56;

const isRightToLeft = (element: Element): boolean => getComputedStyle(element).direction === 'rtl';

/**
 * Whether a menu, listbox or dialog is open: Escape is theirs then. Broader than
 * `hasBlockingPortalOverlay`, which sees only the portal container: folds menus portal into
 * `body`, and the drawer, which closes on Escape before the page sees it, must leave every one.
 */
const overlayOpen = (): boolean =>
  hasBlockingPortalOverlay() ||
  document.querySelector(
    '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]'
  ) !== null;

/** The drawer follows navigation: out at a section's own page, away on any other. */
const useDrawerFollowsNavigation = (setOpen: (update: (open: boolean) => boolean) => void) => {
  const { key } = useLocation();
  const action = useNavigationType();
  const sectionRoot = useMatches().some((match) => isSectionRootHandle(match.handle));
  const wasSectionRoot = useRef(false);
  useLayoutEffect(() => {
    const fromSectionRoot = wasSectionRoot.current;
    wasSectionRoot.current = sectionRoot;
    setOpen((open) => nextPhoneNavDrawerOpen(open, sectionRoot, action, fromSectionRoot));
  }, [key, sectionRoot, action, setOpen]);
};

/**
 * A phone's navigation drawer: the icon rail and, beside it, the section's list, sliding in from
 * the start edge below the top bar over a dimmed page. The menu button, the scrim, Escape and a
 * swipe toward the edge put it away; following a link in it does too.
 */
export function PhoneNavDrawer({ nav }: { nav: ReactNode }) {
  const [open, setOpen] = useAtom(phoneNavDrawerOpenAtom);
  // The section's list portals itself into the slot (`MobileFriendlyPageNav`).
  const slotRef = useSetAtom(phoneNavSlotAtom);
  const panelRef = useRef<HTMLDivElement>(null);
  // Motion only after the first frame, so a page that opens with the drawer out does not slide it.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useDrawerFollowsNavigation(setOpen);
  useInert(panelRef, !open);
  // Gone with the phone layout (a phone turned sideways), the drawer is away: nothing else would
  // put it away, and edge swipes rest while it is out.
  useEffect(() => () => setOpen(false), [setOpen]);

  // Put away, the drawer drops the rail and the list once it has slid out, as a phone's page had
  // them unmounted before; out, or sliding, it holds them.
  const [sliding, setSliding] = useState(false);
  useEffect(() => {
    if (open) {
      setSliding(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setSliding(false), SLIDE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  const filled = open || sliding;

  // Opened with the menu button, the drawer takes the focus from it; brought out by a navigation,
  // it leaves the focus to the page that restores it. Put away around the focus, the focus goes
  // back to the menu button.
  const wasOpen = useRef(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || wasOpen.current === open) return;
    wasOpen.current = open;
    const focused = document.activeElement;
    if (open && focused?.id === PHONE_NAV_MENU_BUTTON_ID) {
      // The open section's rail button, else the first entry.
      const entry =
        panel.querySelector<HTMLElement>('[aria-current="page"]') ??
        panel.querySelector<HTMLElement>('button, a[href]');
      entry?.focus({ preventScroll: true });
    } else if (!open && focused && panel.contains(focused)) {
      document.getElementById(PHONE_NAV_MENU_BUTTON_ID)?.focus({ preventScroll: true });
    }
  }, [open]);

  // While out, Escape puts it away, before the page's own Escape handling (focusing the composer,
  // marking the room read) sees it, unless a menu or dialog is open over it: that one closes.
  // (Edge swipes rest meanwhile: `useEdgeSwipe` reads the same atom.)
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, setOpen]);

  // The section's list is portaled in, so React's events from it bubble through the page, not
  // the drawer: the drawer listens on its own element. Following a link puts it away, also a link
  // to the page already shown; a swipe toward the edge does too.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    let start: { x: number; y: number } | undefined;
    let last: { x: number; y: number } | undefined;
    const closeOnLink = (event: MouseEvent) => {
      // Not a click that goes nowhere (a drag's end) or opens elsewhere (a modifier, a middle button).
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('a[href]')) setOpen(false);
    };
    const pointOf = (event: globalThis.TouchEvent) => {
      const touch = event.touches[0];
      return event.touches.length === 1 && touch
        ? { x: touch.clientX, y: touch.clientY }
        : undefined;
    };
    const startSwipe = (event: globalThis.TouchEvent) => {
      start = pointOf(event);
      last = start;
    };
    const moveSwipe = (event: globalThis.TouchEvent) => {
      last = pointOf(event);
    };
    // Decided from the last move, so a lift the browser reports as a cancel counts too.
    const endSwipe = () => {
      const from = start;
      const to = last;
      start = undefined;
      last = undefined;
      if (!from || !to) return;
      const towardEdge = (from.x - to.x) * (isRightToLeft(panel) ? -1 : 1);
      if (towardEdge >= CLOSE_SWIPE_DISTANCE && towardEdge > Math.abs(to.y - from.y)) {
        setOpen(false);
      }
    };
    panel.addEventListener('click', closeOnLink, true);
    // In the capture phase: the list's rows take touches for their own gestures first.
    const early = { capture: true, passive: true };
    panel.addEventListener('touchstart', startSwipe, early);
    panel.addEventListener('touchmove', moveSwipe, early);
    panel.addEventListener('touchend', endSwipe, early);
    panel.addEventListener('touchcancel', endSwipe, early);
    return () => {
      panel.removeEventListener('click', closeOnLink, true);
      panel.removeEventListener('touchstart', startSwipe, true);
      panel.removeEventListener('touchmove', moveSwipe, true);
      panel.removeEventListener('touchend', endSwipe, true);
      panel.removeEventListener('touchcancel', endSwipe, true);
    };
  }, [setOpen]);

  return (
    <>
      <div
        className={css.Scrim}
        data-open={open || undefined}
        data-animate={animate || undefined}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <div
        ref={panelRef}
        id={PHONE_NAV_DRAWER_ID}
        className={css.Panel}
        data-open={open || undefined}
        data-animate={animate || undefined}
      >
        {filled && nav}
        {filled && <div ref={slotRef} className={css.Slot} data-nav-slot />}
      </div>
    </>
  );
}
