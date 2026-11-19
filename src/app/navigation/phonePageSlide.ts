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
/** Marks the page in it, below the top bar: what casts the slide's shadow. */
export const PHONE_PAGE = 'data-phone-page';

/** Marks the top bar in it (sidebar/PhoneTopBar.tsx), which no slide moves. */
const PHONE_TOP_BAR = 'data-phone-top-bar';
/** Marks the still copy of the phone layout that a slide shows (phonePageSlide.css.ts). */
const COPY = 'data-page-slide-copy';
/** The slide's keyframes (phonePageSlide.css.ts), apart from any other animation in the page. */
const KEYFRAMES = 'phone-page-';
/** How long the frame before the changes, and the slide itself, may take: a hidden tab has neither. */
const FRAME_MS = 100;
const PLAY_MS = 2000;

/** A change to the page; `sliding` tells whether it runs inside a slide. */
type Change = (sliding: boolean) => void;

/** A slide: `skip` runs its changes with nothing sliding, or cuts it short while it plays. */
type Slide = { finished: Promise<void>; skip: () => void };

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

/**
 * A still copy of the phone layout as it is, scrolled as it is, to show in `stage` while the
 * layout itself shows the next page: it takes no input, no name a lookup by id or test id would
 * find twice, and loads and plays nothing.
 */
const copyOf = (stage: Element): ((over: Element) => HTMLElement) => {
  const copy = stage.cloneNode(true) as HTMLElement;
  const copies = copy.querySelectorAll('*');
  const scrolled: [Element, number, number][] = [];
  stage.querySelectorAll('*').forEach((element, index) => {
    const twin = copies[index];
    if (twin && (element.scrollTop || element.scrollLeft)) {
      scrolled.push([twin, element.scrollTop, element.scrollLeft]);
    }
  });
  // A canvas is copied empty: it shows what its original does.
  const canvases = copy.querySelectorAll('canvas');
  stage.querySelectorAll('canvas').forEach((canvas, index) => {
    if (canvas.width && canvas.height) {
      canvases[index]?.getContext('2d')?.drawImage(canvas, 0, 0);
    }
  });
  copy.removeAttribute(PHONE_STAGE);
  copy.removeAttribute('id');
  copy.setAttribute(COPY, '');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('inert', '');
  copy.style.position = 'absolute';
  // The top bar stays above every page: the layout's own shows in the place of the copy's.
  Array.from(copy.children).forEach((child) => {
    if (child.hasAttribute(PHONE_TOP_BAR)) (child as HTMLElement).style.visibility = 'hidden';
    child.removeAttribute(PHONE_TOP_BAR);
  });
  copy.querySelectorAll('[id], [data-testid]').forEach((element) => {
    element.removeAttribute('id');
    element.removeAttribute('data-testid');
  });
  copy.querySelectorAll('iframe, video, audio, source').forEach((element) => {
    ['src', 'srcdoc', 'autoplay'].forEach((name) => element.removeAttribute(name));
  });
  return (over) => {
    over.append(copy);
    scrolled.forEach(([element, scrollTop, scrollLeft]) =>
      Object.assign(element, { scrollTop, scrollLeft })
    );
    return copy;
  };
};

/** The changes of the slide that waits for the frame that shows the page as it is. */
let waiting: Change[] | undefined;
let playing = false;
/** The slide from its call until it has played, waiting for its frame or playing. */
let active: Slide | undefined;

/**
 * Runs `change`, which may change what a phone shows, and slides when it shows deeper or less
 * deep after it: a thread over its room comes in from the end edge, and a thread or a room leaves
 * to it on the way back to the room or the list, the page under them moving a third as far
 * (phonePageSlide.css.ts). The way back to the list slides only for a navigation (the room
 * header's Back): a person brings the list out over the page without one
 * (`movePhoneNavDrawer`). The page stays put where the list goes away, as it does for a tap on a
 * room in it: the drawer slides away to the start edge on its own over the page the change shows
 * (sidebar/PhoneNavDrawer.css.ts).
 *
 * The slide plays between a still copy of the phone layout as it was (`copyOf`), laid over the
 * layout, and the layout as it is: both move with `translate` under the top bar, which changes no
 * layout, and the copy goes when the slide ends. (Not a view transition: the iOS web view's page
 * process crashed in them.) The copy is taken a frame after the call: `change` waits for that,
 * with every change asked for meanwhile, and they run together, in order and committed before
 * they return. While the slide plays, the page takes no taps (phonePageSlide.css.ts), and
 * further changes run at once, which the page that slides in shows as they happen.
 *
 * `change` runs at once, and nothing slides, off the phone layout and with reduced motion.
 * Nothing slides either when the change leaves the phone layout, or leaves a dialog open over
 * the page (one that closes with the change, as a search that opens a thread, does not count).
 */
export const slidePhonePage = (change: Change): void => {
  if (waiting) {
    waiting.push(change);
    return;
  }
  // No document: a test that renders without one.
  const page = typeof document === 'undefined' ? undefined : document;
  if (
    playing ||
    !page?.querySelector(`[${PHONE_STAGE}]`) ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    change(false);
    return;
  }

  const root = page.documentElement;
  const from = depth();
  const changes = [change];
  waiting = changes;
  // Marks the page as inside a slide (phonePageSlide.css.ts). Not from the list, which goes away
  // on its own and where nothing slides: the drawer keeps its slide, which the marker would turn
  // off. Its changes still wait for the frame, so the room a tap in the list opens comes with the
  // drawer going away, and a slide asked for meanwhile does not stop the drawer's.
  if (from !== 0) root.dataset.pageSlide = '';
  let frame = 0;
  let timer = 0;
  let copy: HTMLElement | undefined;
  let ended = false;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const end = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(timer);
    copy?.remove();
    playing = false;
    active = undefined;
    delete root.dataset.pageSlide;
    finish();
  };
  const run = (sliding: boolean) => {
    if (waiting !== changes) return;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    waiting = undefined;
    playing = true;
    const shown = sliding && from !== 0 ? page.querySelector(`[${PHONE_STAGE}]`) : null;
    const show = shown ? copyOf(shown) : undefined;
    flushSync(() => changes.forEach((each) => each(true)));
    const to = depth();
    const stage = page.querySelector(`[${PHONE_STAGE}]`);
    // Nothing to slide from the list, nor where the page is as deep as it was, and nothing where
    // the copy would not fit: the phone layout is gone (signed out, turned sideways), or a
    // dialog still open over the page would show under it.
    if (!show || to === from || !stage || hasBlockingPortalOverlay()) {
      end();
      return;
    }
    root.dataset.pageSlide = to > from ? 'forward' : 'back';
    copy = show(stage);
    // The copy's own slide ends with the layout's; a tab that is hidden plays neither.
    copy.addEventListener('animationend', (event) => {
      if (event.animationName.startsWith(KEYFRAMES)) end();
    });
    timer = window.setTimeout(end, PLAY_MS);
  };
  active = {
    finished,
    // As a person's own gesture asks (`movePhoneNavDrawer`): the changes of a slide that waits
    // run after the gesture's handler, and one that plays is over at once.
    skip: () => {
      if (waiting === changes) queueMicrotask(() => run(false));
      else end();
    },
  };
  frame = window.requestAnimationFrame(() => run(true));
  timer = window.setTimeout(() => run(true), FRAME_MS);
};

/**
 * Runs `change` now, or after the changes that wait for a slide's frame: what it sets is how
 * the page is left when they have run.
 */
export const afterWaitingSlide = (change: () => void): void => {
  if (waiting) waiting.push(change);
  else change();
};

/**
 * Brings a phone's navigation drawer out or puts it away, as a person does (the menu button, a
 * swipe, Escape): `set` changes it. The drawer is over the page, not a level of it, so nothing
 * slides but the drawer itself (sidebar/PhoneNavDrawer.css.ts).
 *
 * Brought out, it never comes inside a page slide, whose marker turns off the drawer's own slide
 * and whose depth would slide the whole page back. The person's gesture wins: a slide that waits
 * for its frame is skipped (its changes still run, with nothing sliding), one that plays jumps
 * to its end, and the drawer comes out once the slide is over and its marker gone. It stays away
 * if the phone layout went meanwhile (a phone turned sideways), which takes the drawer with it.
 *
 * Put away, it goes through `slidePhonePage`, so a tap on a link in it and the navigation that
 * follows run together from the list, where nothing slides.
 */
export const movePhoneNavDrawer = (open: boolean, set: (open: boolean) => void): void => {
  if (!open) {
    slidePhonePage(() => set(false));
    return;
  }
  const slide = active;
  if (!slide) {
    set(true);
    return;
  }
  slide.skip();
  // After the slide's own end (`end` in `slidePhonePage`), which takes its marker away.
  void slide.finished.then(() => {
    if (document.querySelector(`[${PHONE_STAGE}]`)) set(true);
  });
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
