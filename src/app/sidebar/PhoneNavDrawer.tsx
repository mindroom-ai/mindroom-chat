import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import {
  PHONE_NAV_MENU_BUTTON_ID,
  PHONE_SLIDE_OUT_MS,
  nextPhoneNavDrawerOpen,
  phoneNavDrawerOpenAtom,
  phoneNavSectionRootAtom,
  phoneNavSlotAtom,
  phoneSheetSlotAtom,
} from '../navigation/phoneNavDrawer';
import {
  type InteractiveSwipeScene,
  SWIPE_PRIORITY,
  animateSwipeElements,
} from '../navigation/interactiveSwipe';
import { skipActiveLiveSlide } from '../navigation/phonePageSlide';
import { useEdgeSwipe } from '../navigation/useEdgeSwipe';
import { edgeSwipeBackCountAtom } from '../navigation/useEdgeSwipeBack';
import { useSwipeAway } from '../navigation/useSwipeAway';
import { hasOpenOverlay } from '../lib/openOverlay';
import { observeLayerHost } from '../lib/overlayFocus';
import { pathnameContainsAliasRoute } from '../navigation/clientRouteRestore';
import { useInert } from '../lib/hooks/useInert';
import { NoticeSlot, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { focusHandOffAtom } from '../calls/window/callWindowState';
import { PHONE_NAV_DRAWER_ID } from './PhoneTopBar';
import * as css from './PhoneNavDrawer.css';

const isPanelTransformTransitionRunning = (panel: HTMLElement): boolean =>
  panel
    .getAnimations?.()
    .some(
      (animation) =>
        (animation as CSSTransition).transitionProperty === 'transform' &&
        animation.playState === 'running'
    ) ?? false;

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
  const aliasAction = useRef<NavigationType>(undefined);
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
  const [open, setOpenNow] = useAtom(phoneNavDrawerOpenAtom);
  // Opening the drawer cancels any in-flight live page slide so its built-in 280 ms slide-in plays
  // immediately without racing a stale Back commit.
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) skipActiveLiveSlide();
      setOpenNow(next);
    },
    [setOpenNow]
  );
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
  const scrimRef = useRef<HTMLDivElement>(null);
  const swipedClosedRef = useRef(false);
  const mountedRef = useRef(true);
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

  useDrawerFollowsNavigation(setOpenNow);
  useInert(panelRef, !open);
  useLayoutEffect(() => {
    if (open) skipActiveLiveSlide();
  }, [open]);
  // Gone with the phone layout (a phone turned sideways), the drawer is away: nothing else would
  // put it away, and edge swipes rest while it is out.
  useEffect(() => () => setOpenNow(false), [setOpenNow]);

  // Put away, the drawer drops the rail and the list once it has slid out, as a phone's page had
  // them unmounted before; out, sliding, or peeking during an interactive edge swipe, it holds them.
  const [sliding, setSliding] = useState(false);
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (open) {
      swipedClosedRef.current = false;
      setSliding(true);
      return undefined;
    }
    if (swipedClosedRef.current) {
      swipedClosedRef.current = false;
      setSliding(false);
      return undefined;
    }
    // Until its slide out ends, where the browser plays one. A room tapped in the drawer can hold
    // the main thread longer than the slide takes before its first frame, so a clock started now
    // would empty the drawer as it starts to slide. Asking for the slide starts it.
    const slide = panelRef.current
      ?.getAnimations?.()
      .find((each) => (each as CSSTransition).transitionProperty === 'transform');
    if (slide) {
      let current = true;
      const slidOut = () => {
        if (current) setSliding(false);
      };
      slide.finished.then(slidOut, slidOut);
      return () => {
        current = false;
      };
    }
    const timer = window.setTimeout(() => setSliding(false), PHONE_SLIDE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  const filled = open || sliding || peeking;
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
      // The rail's call button hands focus to its destination instead of the menu.
      const handOff = store.get(focusHandOffAtom);
      if (handOff?.to !== 'panel' || handOff.from !== focused) {
        document.getElementById(PHONE_NAV_MENU_BUTTON_ID)?.focus({ preventScroll: true });
      }
    }
  }, [open, store]);

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
  const beginOpenSwipe = useCallback(
    ({ dirSign }: { axisSign: 1 | -1; dirSign: 1 | -1 }): InteractiveSwipeScene | null => {
      skipActiveLiveSlide();
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || !scrim) return null;
      if (isPanelTransformTransitionRunning(panel)) return null;

      flushSync(() => setPeeking(true));
      // A drawer with the rail alone would widen once it is open for a notice that moves into
      // it (`[data-cover-notice]`): it opens on release then. A notice that stays on the page
      // leaves it as wide as it is.
      const railOnly = (slotRef.current?.childElementCount ?? 0) === 0;
      const hasCoverNotice =
        store.get(pageNoticeSlotAtom)?.querySelector('[data-cover-notice]') != null;
      if (railOnly && hasCoverNotice) {
        setPeeking(false);
        return null;
      }
      const extent = panel.getBoundingClientRect().width;
      if (extent <= 0) {
        flushSync(() => setPeeking(false));
        return null;
      }

      panel.dataset.swiping = '';
      scrim.dataset.swiping = '';

      let didCommit = false;
      let cleaned = false;

      const clearSwipeStyles = () => {
        panel.style.translate = '';
        scrim.style.opacity = '';
        void panel.offsetWidth;
        delete panel.dataset.swiping;
        delete scrim.dataset.swiping;
      };

      return {
        extent,
        update(offsetPx, progress) {
          panel.style.translate = `${offsetPx * dirSign}px 0`;
          scrim.style.opacity = String(progress);
        },
        settle(commit, durationMs, currentOffsetPx) {
          const startProgress = currentOffsetPx / extent;
          return animateSwipeElements(
            [
              {
                element: panel,
                keyframes: [
                  { translate: `${currentOffsetPx * dirSign}px 0` },
                  { translate: `${(commit ? extent : 0) * dirSign}px 0` },
                ],
              },
              {
                element: scrim,
                keyframes: [{ opacity: String(startProgress) }, { opacity: commit ? '1' : '0' }],
              },
            ],
            durationMs
          );
        },
        commit() {
          didCommit = true;
          skipActiveLiveSlide();
          flushSync(() => {
            setOpenNow(true);
            setPeeking(false);
          });
          if (!cleaned) {
            cleaned = true;
            clearSwipeStyles();
          }
        },
        cleanup(committed) {
          if (cleaned) return;
          cleaned = true;
          clearSwipeStyles();
          if (!committed && !didCommit && mountedRef.current) {
            setPeeking(false);
          }
        },
      };
    },
    [setOpenNow, store]
  );
  useEdgeSwipe({
    direction: 'back',
    enabled: !open && !backSwipeOn,
    priority: SWIPE_PRIORITY.DRAWER_OPEN,
    onSwipe: openDrawer,
    begin: beginOpenSwipe,
  });

  // The section's list is portaled in, so React's events from it bubble through the page, not
  // the drawer: the drawer listens on its own element. Following a link puts it away, also a link
  // to the page already shown; a swipe toward the edge does too.
  const close = useCallback(() => setOpen(false), [setOpen]);
  const beginCloseSwipe = useCallback(
    ({ dirSign }: { axisSign: 1 | -1; dirSign: 1 | -1 }): InteractiveSwipeScene | null => {
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || !scrim) return null;
      if (isPanelTransformTransitionRunning(panel)) return null;

      const extent = panel.getBoundingClientRect().width;
      if (extent <= 0) return null;

      panel.dataset.swiping = '';
      scrim.dataset.swiping = '';

      let cleaned = false;

      const clearSwipeStyles = () => {
        if (cleaned) return;
        cleaned = true;
        panel.style.translate = '';
        scrim.style.opacity = '';
        void panel.offsetWidth;
        delete panel.dataset.swiping;
        delete scrim.dataset.swiping;
      };

      return {
        extent,
        update(offsetPx, progress) {
          panel.style.translate = `${-offsetPx * dirSign}px 0`;
          scrim.style.opacity = String(1 - progress);
        },
        settle(commit, durationMs, currentOffsetPx) {
          const startProgress = currentOffsetPx / extent;
          return animateSwipeElements(
            [
              {
                element: panel,
                keyframes: [
                  { translate: `${-currentOffsetPx * dirSign}px 0` },
                  { translate: `${(commit ? -extent : 0) * dirSign}px 0` },
                ],
              },
              {
                element: scrim,
                keyframes: [
                  { opacity: String(1 - startProgress) },
                  { opacity: commit ? '0' : '1' },
                ],
              },
            ],
            durationMs
          );
        },
        commit() {
          const focused = document.activeElement;
          const handOff = store.get(focusHandOffAtom);
          const shouldReturnFocus =
            Boolean(focused && panel.contains(focused)) &&
            (handOff?.to !== 'panel' || handOff.from !== focused);
          swipedClosedRef.current = true;
          flushSync(() => {
            setOpenNow(false);
            setSliding(false);
          });
          clearSwipeStyles();
          if (shouldReturnFocus) {
            document.getElementById(PHONE_NAV_MENU_BUTTON_ID)?.focus({ preventScroll: true });
          }
        },
        cleanup() {
          clearSwipeStyles();
        },
      };
    },
    [setOpenNow, store]
  );
  useSwipeAway(panelRef, 'start', close, {
    enabled: open,
    priority: SWIPE_PRIORITY.SHEET,
    begin: beginCloseSwipe,
  });
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
      <div ref={sheetSlotRef} className={css.SheetSlot} data-phone-overlay-layer="" />
      <div
        ref={scrimRef}
        className={css.Scrim}
        data-phone-overlay-layer=""
        data-open={open || undefined}
        data-animate={animate || undefined}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <div
        ref={panelRef}
        id={PHONE_NAV_DRAWER_ID}
        className={css.Panel}
        data-phone-overlay-layer=""
        data-open={open || undefined}
        data-animate={animate || undefined}
      >
        {filled && nav}
        <div className={css.ListColumn}>
          {/* The drawer covers the page's notice place: what must stay in reach shows here, until
              the drawer has slid away, so a notice does not jump to the page mid-slide. */}
          {(open || sliding) && <NoticeSlot place="drawer" />}
          <div ref={slotRef} className={css.Slot} data-nav-slot />
        </div>
      </div>
    </>
  );
}
