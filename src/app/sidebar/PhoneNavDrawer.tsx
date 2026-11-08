import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import {
  PHONE_SLIDE_OUT_MS,
  nextPhoneNavDrawerOpen,
  phoneNavDrawerOpenAtom,
  phoneNavSectionRootAtom,
  phoneNavSlotAtom,
  phoneSheetSlotAtom,
} from '../navigation/phoneNavDrawer';
import { useEdgeSwipe } from '../navigation/useEdgeSwipe';
import { edgeSwipeBackCountAtom } from '../navigation/useEdgeSwipeBack';
import { useSwipeAway } from '../navigation/useSwipeAway';
import { hasOpenOverlay } from '../lib/openOverlay';
import { observeLayerHost } from '../lib/overlayFocus';
import { pathnameContainsAliasRoute } from '../navigation/clientRouteRestore';
import { useInert } from '../lib/hooks/useInert';
import { PHONE_NAV_DRAWER_ID, PHONE_NAV_MENU_BUTTON_ID } from './PhoneTopBar';
import * as css from './PhoneNavDrawer.css';

/** The drawer follows navigation: out at a section's own page, away on any other. */
const useDrawerFollowsNavigation = (setOpen: (update: (open: boolean) => boolean) => void) => {
  const { key, pathname } = useLocation();
  // An alias address shows no page until it turns into a room ID (a replace): that step decides,
  // as the navigation that opened the alias (a push from Search, a pop back) would have.
  const resolvingAlias = pathnameContainsAliasRoute(pathname);
  const action = useNavigationType();
  // Read from the store: the page marks itself in a layout effect of the same commit, before this
  // one runs; the value rendered here can lag that by a render.
  const store = useStore();
  const rootKey = useAtomValue(phoneNavSectionRootAtom);
  const wasSectionRoot = useRef(false);
  const aliasAction = useRef<NavigationType>();
  useLayoutEffect(() => {
    if (resolvingAlias) {
      // The alias's own clean-ups replace it too; the first navigation to it counts.
      if (action !== NavigationType.Replace || !aliasAction.current) aliasAction.current = action;
      return;
    }
    const decidingAction = aliasAction.current ?? action;
    aliasAction.current = undefined;
    const sectionRoot = store.get(phoneNavSectionRootAtom) === key;
    const fromSectionRoot = wasSectionRoot.current;
    wasSectionRoot.current = sectionRoot;
    setOpen((open) => nextPhoneNavDrawerOpen(open, sectionRoot, decidingAction, fromSectionRoot));
  }, [key, rootKey, action, resolvingAlias, setOpen, store]);
};

/**
 * A phone's navigation drawer: the icon rail and, beside it, the section's list, sliding in from
 * the start edge below the top bar over a dimmed page. The menu button or a swipe from the screen's
 * left edge brings it out. The menu button, the scrim, Escape and a swipe toward the edge put it
 * away; following a link in it does too.
 */
export function PhoneNavDrawer({ nav }: { nav: ReactNode }) {
  const [open, setOpen] = useAtom(phoneNavDrawerOpenAtom);
  // The section's list portals itself into the slot (`MobileFriendlyPageNav`).
  const setSlot = useSetAtom(phoneNavSlotAtom);
  const slotRef = useRef<HTMLDivElement>(null);
  // A sheet from the end edge (a room's members) portals itself into the layer under the drawer,
  // where focus treats it as a dialog in the body (`overlayFocus`).
  const setSheetSlot = useSetAtom(phoneSheetSlotAtom);
  const sheetSlotRef = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot) observeLayerHost(slot);
      setSheetSlot(slot);
    },
    [setSheetSlot]
  );
  const panelRef = useRef<HTMLDivElement>(null);
  // Motion only from the frame after the drawer first shows the stored state, so a page that opens
  // with the drawer out does not slide it. The page brings it out in a layout effect of the first
  // commit, but the atom's subscription starts with the passive effects, so the drawer renders it
  // one commit late: until then the rendered state lags the store.
  const store = useStore();
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (animate || store.get(phoneNavDrawerOpenAtom) !== open) return undefined;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [animate, open, store]);

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
    const timer = window.setTimeout(() => setSliding(false), PHONE_SLIDE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  const filled = open || sliding;
  // The slot stays on the page and is offered only while the drawer holds the list, so the list
  // leaves while it is still on the page: one that remembers the reader's place reads it then.
  useLayoutEffect(() => {
    if (!filled) return undefined;
    setSlot(slotRef.current);
    return () => setSlot(null);
  }, [filled, setSlot]);

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
  // (Edge swipes rest meanwhile: `useEdgeSwipe` reads `phoneLayerOpenAtom`.)
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasOpenOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, setOpen]);

  // A swipe from the screen's left edge brings it out, a room's too, unless a back swipe (a
  // thread's) takes it.
  const backSwipeOn = useAtomValue(edgeSwipeBackCountAtom) > 0;
  const openDrawer = useCallback(() => setOpen(true), [setOpen]);
  useEdgeSwipe({ direction: 'back', enabled: !backSwipeOn, onSwipe: openDrawer });

  // The section's list is portaled in, so React's events from it bubble through the page, not
  // the drawer: the drawer listens on its own element. Following a link puts it away, also a link
  // to the page already shown; a swipe toward the edge does too.
  const close = useCallback(() => setOpen(false), [setOpen]);
  useSwipeAway(panelRef, 'start', close);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const closeOnLink = (event: MouseEvent) => {
      // Not a click that goes nowhere (a drag's end) or opens elsewhere (a modifier, a middle button).
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('a[href]')) close();
    };
    panel.addEventListener('click', closeOnLink, true);
    return () => panel.removeEventListener('click', closeOnLink, true);
  }, [close]);

  return (
    <>
      <div ref={sheetSlotRef} className={css.SheetSlot} />
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
        <div ref={slotRef} className={css.Slot} data-nav-slot />
      </div>
    </>
  );
}
