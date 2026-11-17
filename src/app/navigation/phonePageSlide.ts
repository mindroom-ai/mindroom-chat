import { flushSync } from 'react-dom';
import { NavigationType, type createBrowserRouter } from 'react-router-dom';
import { hasBlockingPortalOverlay } from '../lib/portalOverlay';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { conversationUnderThreadAtom } from './conversationCover';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import './phonePageSlide.css';

/**
 * Marks the phone layout's box (shell/ClientLayout.tsx): what slides, and the sign that the page
 * is laid out for a phone.
 */
export const PHONE_STAGE = 'data-phone-stage';

/** A change to the page; `sliding` tells whether it runs inside a slide. */
type Change = (sliding: boolean) => void;

// TypeScript's DOM types (5.4) do not have view transitions yet.
type ViewTransition = { finished: Promise<void>; ready: Promise<void>; skipTransition: () => void };
type SlidingDocument = Document & { startViewTransition?: (update: () => void) => ViewTransition };

type Router = ReturnType<typeof createBrowserRouter>;

/**
 * How deep a phone shows: its list (the navigation drawer over the page), a page, or a thread
 * that fills the page. Deeper comes in from the end edge, as a page of a phone's own apps does.
 */
const depth = (): number => {
  const store = getImperativeJotaiStore();
  if (store.get(phoneNavDrawerOpenAtom)) return 0;
  return store.get(conversationUnderThreadAtom) ? 2 : 1;
};

/** The changes of the slide that waits for the browser's picture of the page as it is. */
let waiting: Change[] | undefined;
let playing = false;

/**
 * Runs `change`, which may change what a phone shows, and slides when it shows deeper or less
 * deep after it: a thread over its room comes in from the end edge, and a thread or a room leaves
 * to it on the way back to the room or the list, the page under them moving a third as far
 * (phonePageSlide.css.ts). The page stays put where the list goes away, as it does for a tap on a
 * room in it: the drawer slides away to the start edge on its own over the page the change shows
 * (sidebar/PhoneNavDrawer.css.ts).
 *
 * The browser plays the slide between two pictures of the page (a view transition), so no element
 * moves and nothing that measures the page sees it. It takes the first picture a frame after the
 * call: `change` waits for that, with every change asked for meanwhile, and they run together, in
 * order and committed before they return. While the slide plays, the page takes no taps (what
 * is in a picture answers none), and further changes run at once, which the picture that slides
 * in shows as they happen.
 *
 * `change` runs at once, and nothing slides, off the phone layout, in a browser without view
 * transitions and with reduced motion. Nothing slides either when the change leaves the phone
 * layout, or leaves a dialog open over the page (one that closes with the change, as a search
 * that opens a thread, does not count).
 */
export const slidePhonePage = (change: Change): void => {
  if (waiting) {
    waiting.push(change);
    return;
  }
  // No document: a test that renders without one.
  const page = typeof document === 'undefined' ? undefined : (document as SlidingDocument);
  if (
    playing ||
    !page?.startViewTransition ||
    !page.querySelector(`[${PHONE_STAGE}]`) ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    change(false);
    return;
  }

  const root = page.documentElement;
  const from = depth();
  const changes = [change];
  waiting = changes;
  // Names what slides (phonePageSlide.css.ts) for the picture of the page as it is. Nothing slides
  // from the list, which goes away on its own: the drawer keeps its slide, which the name would
  // turn off. Its changes still wait for the picture, so the room a tap in the list opens comes
  // with the drawer going away, and a slide asked for meanwhile does not stop the drawer's.
  if (from !== 0) root.dataset.pageSlide = '';
  const transition = page.startViewTransition(() => {
    waiting = undefined;
    playing = true;
    flushSync(() => changes.forEach((each) => each(true)));
    const to = depth();
    // Nothing to slide from the list, nor where the page is as deep as it was, and nothing where
    // the pictures would not fit: the phone layout is gone (signed out, turned sideways), or a
    // dialog still open over the page would show under them.
    if (
      from === 0 ||
      to === from ||
      !page.querySelector(`[${PHONE_STAGE}]`) ||
      hasBlockingPortalOverlay()
    ) {
      transition.skipTransition();
    } else root.dataset.pageSlide = to > from ? 'forward' : 'back';
  });
  const done = () => {
    playing = false;
    delete root.dataset.pageSlide;
  };
  transition.finished.then(done, done);
  // A slide that is skipped rejects it.
  transition.ready.catch(() => undefined);
};

/**
 * Runs `change` now, or after the changes that wait for a slide's picture: what it sets is how
 * the page is left when they have run.
 */
export const afterWaitingSlide = (change: () => void): void => {
  if (waiting) waiting.push(change);
  else change();
};

/**
 * `router` for `RouterProvider`, which then shows a new location inside a slide
 * (`slidePhonePage`). What the router tells without a new location goes on at once, after a
 * location that still waits for its slide. A step back the browser itself showed sliding (a swipe
 * from the screen's edge in a browser that has one) is left as it is.
 */
export const withPhonePageSlide = (router: Router): Router => {
  let browserSlid = false;
  // In the capture phase: before the router's own listener, which tells of the step.
  router.window?.addEventListener(
    'popstate',
    (event) => {
      browserSlid =
        (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition ===
        true;
    },
    true
  );
  const subscribe: Router['subscribe'] = (listener) => {
    let shown = router.state.location.key;
    return router.subscribe((state, opts) => {
      const moved = state.location.key !== shown;
      shown = state.location.key;
      const slides = moved && !(browserSlid && state.historyAction === NavigationType.Pop);
      if (moved) browserSlid = false;
      if (slides) {
        slidePhonePage((sliding) => listener(state, sliding ? { ...opts, flushSync: true } : opts));
      } else afterWaitingSlide(() => listener(state, opts));
    });
  };
  // The router's own properties are read through it: they are getters over its state.
  return Object.create(router, { subscribe: { value: subscribe } }) as Router;
};
