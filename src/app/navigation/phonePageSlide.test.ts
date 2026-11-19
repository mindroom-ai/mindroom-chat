// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { conversationUnderThreadAtom } from './conversationCover';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import {
  PHONE_STAGE,
  afterWaitingSlide,
  movePhoneNavDrawer,
  slidePhonePage,
  withPhonePageSlide,
} from './phonePageSlide';

// A dialog or popover in the app's portal container, over the page.
const overlay = vi.hoisted(() => ({ open: false }));
vi.mock('../lib/portalOverlay', () => ({ hasBlockingPortalOverlay: () => overlay.open }));

type Router = Parameters<typeof withPhonePageSlide>[0];
type RouterState = Router['state'];
type Listener = Parameters<Router['subscribe']>[0];

const store = getImperativeJotaiStore();
const root = document.documentElement;

/** The still copy of the layout a slide that plays shows. */
const copy = () => document.querySelector<HTMLElement>('[data-page-slide-copy]');

/** An animation of `name` ends on `element`. */
const endAnimation = (element: Element | null, name: string) =>
  element?.dispatchEvent(
    Object.assign(new Event('animationend', { bubbles: true }), { animationName: name })
  );

/** The browser's side of a slide: the frame its changes wait for, and the slide's end. */
const browser = () => {
  let next: (() => void) | undefined;
  let played: Element | null = null;
  /** The direction of each slide that played, as its change left it. */
  const plays: (string | undefined)[] = [];
  const request = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    next = callback;
    // Not the frames a slide is held for at its start.
    if (root.dataset.pageSlideHeld === undefined) request();
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    next = undefined;
  });
  const page = {
    /** The frames slides asked for, to change the page in: one each. */
    request,
    plays,
    /** The frame comes: the page changes. */
    frame: () => {
      const run = next;
      next = undefined;
      run?.();
      // Once a slide: the frames it is held for at its start come here too.
      if (run && copy() && copy() !== played) plays.push(root.dataset.pageSlide);
      played = copy();
    },
    /** The slide has played to its end. */
    finish: async () => {
      endAnimation(copy(), 'phone-page-over-out');
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  shown = page;
  return page;
};
/** The browser of the test that runs. */
let shown: ReturnType<typeof browser> | undefined;

const showList = (shown: boolean) => store.set(phoneNavDrawerOpenAtom, shown);
const showThread = (shown: boolean) => store.set(conversationUnderThreadAtom, shown);

beforeEach(() => {
  const stage = document.createElement('div');
  stage.setAttribute(PHONE_STAGE, '');
  document.body.append(stage);
  showList(false);
  showThread(false);
  overlay.open = false;
});

afterEach(async () => {
  // A slide a test left waiting or playing ends, so the next test starts with none.
  shown?.frame();
  await shown?.finish();
  shown = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete root.dataset.pageSlide;
  delete root.dataset.pageSlideHeld;
});

describe('slidePhonePage', () => {
  it('slides without a view transition of the browser', async () => {
    const page = browser();
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      value: startViewTransition,
      configurable: true,
    });
    try {
      slidePhonePage(() => showThread(true));
      page.frame();
      expect(page.plays).toEqual(['forward']);
      await page.finish();
      expect(startViewTransition).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  it('shows a still copy of the layout as it was over the layout while it plays', async () => {
    const page = browser();
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    stage.innerHTML =
      '<header data-phone-top-bar></header>' +
      '<main id="room" data-testid="room"><ul>room</ul><iframe src="about:blank"></iframe>' +
      '<video src="clip.mp4" autoplay></video></main>';
    stage.querySelector('ul')!.scrollTop = 120;
    slidePhonePage(() => {
      stage.querySelector('ul')!.textContent = 'thread';
      showThread(true);
    });
    // Not before the frame: the layout is as it was.
    expect(copy()).toBeNull();

    page.frame();
    const still = copy()!;
    // In the layout, whose own page shows the change.
    expect(still.parentElement).toBe(stage);
    expect(stage.querySelector('ul')!.textContent).toBe('thread');
    expect(still.querySelector('ul')!.textContent).toBe('room');
    expect(still.querySelector('ul')!.scrollTop).toBe(120);
    // Out of reach: of input, and of what looks the layout or its parts up.
    expect(still.getAttribute('aria-hidden')).toBe('true');
    expect(still.hasAttribute('inert')).toBe(true);
    expect(document.querySelectorAll(`[${PHONE_STAGE}], [data-phone-top-bar]`)).toHaveLength(2);
    expect(still.querySelector('header')!.style.visibility).toBe('hidden');
    expect(document.querySelectorAll('#room, [data-testid="room"]')).toHaveLength(1);
    // It loads and plays nothing: a frame and a video are blank boxes of their size.
    expect(still.querySelector('iframe')!.getAttributeNames()).toEqual(['style']);
    expect(still.querySelector('video')!.getAttributeNames()).toEqual(['style']);
    expect(still.querySelector('video')!.style.width).toBe('0px');

    // What else ends in the copy is not the slide.
    endAnimation(still.querySelector('ul'), 'spin');
    expect(copy()).toBe(still);
    endAnimation(still.querySelector('main'), 'phone-page-under-out');
    expect(copy()).toBeNull();
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('keeps in the copy only the pictures the page has loaded, and loads no other', async () => {
    const page = browser();
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    stage.innerHTML =
      '<img src="loaded.png" alt="Loaded"><img src="loading.png" srcset="loading-2x.png 2x" alt="Loading">' +
      '<iframe srcdoc="<p>preview</p>" sandbox=""></iframe><video poster="poster.png"><source src="clip.mp4"></video>' +
      '<picture><source srcset="loaded.webp"><img src="loaded.png"></picture>';
    // As a browser has it: the copy of a loaded picture shows at once, one still loading does not.
    const loaded = function loaded(this: HTMLImageElement) {
      return this.getAttribute('src') === 'loaded.png';
    };
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(loaded);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function width(
      this: HTMLImageElement
    ) {
      return loaded.call(this) ? 40 : 0;
    });
    try {
      slidePhonePage(() => showThread(true));
      page.frame();
      const still = copy()!;
      const [kept, blank] = still.querySelectorAll('img');
      expect(kept!.outerHTML).toBe('<img src="loaded.png" alt="Loaded">');
      expect(blank!.getAttributeNames()).toEqual(['style']);
      expect(blank!.style.height).toBe('0px');
      expect(still.querySelector('iframe')!.getAttributeNames()).toEqual(['sandbox', 'style']);
      expect(still.querySelector('video')!.getAttributeNames()).toEqual(['style']);
      expect(still.querySelector('video source')!.hasAttribute('src')).toBe(false);
      // A picture's own source stays: without it the picture would load another.
      expect(still.querySelector('picture')!.innerHTML).toBe(
        '<source srcset="loaded.webp"><img src="loaded.png">'
      );
      await page.finish();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('leaves the fields of the page as they are, and copies nothing typed', async () => {
    const page = browser();
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    stage.innerHTML =
      '<form id="ask"></form><label for="secret">Key</label>' +
      '<input type="radio" name="keep" value="once"><input type="radio" name="keep" value="day">' +
      '<input id="secret" type="text" name="secret" form="ask"><input type="password"><textarea></textarea>' +
      '<input type="checkbox" checked>';
    const [once, day] = stage.querySelectorAll<HTMLInputElement>('[name="keep"]');
    day!.checked = true;
    const typed = stage.querySelectorAll<HTMLInputElement>('#secret, [type="password"], textarea');
    typed.forEach((field) => Object.assign(field, { value: 'typed-secret' }));

    slidePhonePage(() => showThread(true));
    page.frame();
    const still = copy()!;
    // The copy's fields are no part of the page's radio groups or forms, and label none of them.
    expect(still.querySelectorAll('[name], [form], [for], [id]')).toHaveLength(0);
    expect(stage.querySelector<HTMLFormElement>('#ask')!.elements).toHaveLength(1);
    expect([once!.checked, day!.checked]).toEqual([false, true]);
    // It looks as the page did, but for what was typed.
    const fields = Array.from(still.querySelectorAll<HTMLInputElement>('input, textarea'));
    expect(fields.map((field) => field.type)).toEqual([
      'radio',
      'radio',
      'text',
      'password',
      'textarea',
      'checkbox',
    ]);
    expect(fields.map((field) => field.checked ?? false)).toEqual([
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(fields.slice(2, 5).map((field) => field.value)).toEqual(['', '', '']);
    expect(still.outerHTML).not.toContain('typed-secret');

    await page.finish();
    expect([once!.checked, day!.checked]).toEqual([false, true]);
    expect(Array.from(typed).map((field) => field.value)).toEqual(Array(3).fill('typed-secret'));
  });

  it('leaves no slide behind when a change fails: the next one slides', async () => {
    const page = browser();
    const after = vi.fn();
    slidePhonePage(() => {
      throw new Error('change failed');
    });
    slidePhonePage(after);
    expect(() => page.frame()).toThrow('change failed');
    expect(copy()).toBeNull();
    expect(root.dataset.pageSlide).toBeUndefined();

    // The drawer comes out at once, and the next change slides.
    const set = vi.fn();
    movePhoneNavDrawer(true, set);
    expect(set).toHaveBeenCalledWith(true);
    slidePhonePage(() => showThread(true));
    expect(page.request).toHaveBeenCalledTimes(2);
    page.frame();
    expect(page.plays).toEqual(['forward']);
    await page.finish();
    expect(copy()).toBeNull();
  });

  it.each([
    ['is removed (signed out)', (stage: Element) => stage.remove()],
    [
      'is a phone layout no more (turned sideways)',
      (stage: Element) => stage.removeAttribute(PHONE_STAGE),
    ],
    ['is hidden', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('ends the slide that plays at once when the layout %s', async (_, leave) => {
    const page = browser();
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    slidePhonePage(() => showThread(true));
    page.frame();
    expect(root.dataset.pageSlide).toBe('forward');
    expect(copy()).not.toBeNull();

    leave(stage);
    // What watches the layout hears of it before the next frame.
    await new Promise((resolve) => {
      setTimeout(resolve);
    });
    expect(root.dataset.pageSlide).toBeUndefined();
    expect(root.dataset.pageSlideHeld).toBeUndefined();
    expect(stage.querySelector('[data-page-slide-copy]')).toBeNull();

    // The next change slides again, on the layout that is there then.
    stage.setAttribute(PHONE_STAGE, '');
    document.body.append(stage);
    slidePhonePage(() => showThread(false));
    expect(page.request).toHaveBeenCalledTimes(2);
    page.frame();
    expect(page.plays).toEqual(['forward', 'back']);
    await page.finish();
  });

  it('changes the page at once in a hidden tab, which plays no slide', () => {
    const page = browser();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const change = vi.fn();
      slidePhonePage(change);
      expect(change).toHaveBeenCalledWith(false);
      expect(page.request).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('holds the slide at its start until the page that slides in has been drawn', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    page.frame();
    // The frame that draws the page is long: the slide waits it out, and starts with the next.
    expect(root.dataset.pageSlideHeld).toBe('');
    page.frame();
    expect(root.dataset.pageSlideHeld).toBe('');
    page.frame();
    expect(root.dataset.pageSlideHeld).toBeUndefined();
    expect(root.dataset.pageSlide).toBe('forward');
    expect(page.plays).toEqual(['forward']);
    await page.finish();

    // A slide that ends while it is held is held no more.
    slidePhonePage(() => showThread(false));
    page.frame();
    expect(root.dataset.pageSlideHeld).toBe('');
    await page.finish();
    expect(root.dataset.pageSlideHeld).toBeUndefined();
    page.frame();
    expect(root.dataset.pageSlideHeld).toBeUndefined();
  });

  it('changes the page without a frame, and ends a slide that never plays: a hidden tab', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const page = browser();
    const change = vi.fn(() => showThread(true));
    slidePhonePage(change);
    vi.advanceTimersByTime(100);
    expect(change).toHaveBeenCalledWith(true);
    expect(root.dataset.pageSlide).toBe('forward');
    expect(copy()).not.toBeNull();
    // The frame, should it still come, changes nothing.
    page.frame();
    expect(change).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(copy()).toBeNull();
    expect(root.dataset.pageSlide).toBeUndefined();
    // The next change slides again.
    slidePhonePage(() => showThread(false));
    expect(page.request).toHaveBeenCalledTimes(2);
  });

  it('changes the page at once outside the phone layout', () => {
    const page = browser();
    document.body.replaceChildren();
    const change = vi.fn();
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
    expect(page.request).not.toHaveBeenCalled();
  });

  it('changes the page at once for someone who asked for reduced motion', () => {
    const page = browser();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const change = vi.fn();
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
    expect(page.request).not.toHaveBeenCalled();
  });

  it('plays nothing when the list gives way to a page: the drawer slides away on its own', async () => {
    const page = browser();
    showList(true);
    const change = vi.fn(() => showList(false));
    slidePhonePage(change);
    // The frame has not come yet: the list stays, and nothing turns off the
    // drawer's own slide.
    expect(change).not.toHaveBeenCalled();
    expect(root.dataset.pageSlide).toBeUndefined();

    page.frame();
    expect(change).toHaveBeenCalledWith(true);
    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();

    await page.finish();
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('plays nothing either when the list gives way to a thread that fills the page', async () => {
    const page = browser();
    showList(true);
    slidePhonePage(() => {
      showList(false);
      showThread(true);
    });
    page.frame();
    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
    await page.finish();
  });

  it('slides forward when a thread fills the page', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    page.frame();
    expect(root.dataset.pageSlide).toBe('forward');
    await page.finish();
  });

  // A navigation back to the list, as the browser's back: a person brings it out with
  // `movePhoneNavDrawer`, which plays no slide.
  it('slides back when a thread closes, and when a navigation brings the list back', async () => {
    const page = browser();
    showThread(true);
    slidePhonePage(() => showThread(false));
    page.frame();
    expect(root.dataset.pageSlide).toBe('back');
    await page.finish();

    slidePhonePage(() => showList(true));
    page.frame();
    expect(root.dataset.pageSlide).toBe('back');
    await page.finish();
  });

  it('plays nothing when the change leaves the page as deep as it was', async () => {
    const page = browser();
    const change = vi.fn();
    slidePhonePage(change);
    expect(root.dataset.pageSlide).toBe('');
    page.frame();
    expect(change).toHaveBeenCalledWith(true);
    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('takes changes that come while it waits for the frame into the same slide, in order', async () => {
    const page = browser();
    showList(true);
    const order: string[] = [];
    slidePhonePage(() => {
      order.push('list away');
      showList(false);
    });
    slidePhonePage(() => order.push('room'));
    expect(order).toEqual([]);
    expect(page.request).toHaveBeenCalledTimes(1);

    page.frame();
    expect(order).toEqual(['list away', 'room']);
    // The list went away: the drawer's slide shows it, not the page's.
    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
    await page.finish();
  });

  it('changes the page at once while a slide plays', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    page.frame();

    const change = vi.fn(() => showThread(false));
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
    expect(page.request).toHaveBeenCalledTimes(1);
    // The slide that plays keeps its direction.
    expect(root.dataset.pageSlide).toBe('forward');
    await page.finish();

    // The next change slides again.
    slidePhonePage(() => showThread(true));
    expect(page.request).toHaveBeenCalledTimes(2);
    page.frame();
    await page.finish();
  });
});

describe('slidePhonePage, where its copy would not fit', () => {
  it('plays nothing under a dialog that stays open, which the copy would cover', async () => {
    const page = browser();
    overlay.open = true;
    const change = vi.fn(() => showThread(true));
    slidePhonePage(change);
    page.frame();

    expect(change).toHaveBeenCalledWith(true);
    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('slides when the dialog goes with the change, as a search that opens a thread does', async () => {
    const page = browser();
    overlay.open = true;
    slidePhonePage(() => {
      overlay.open = false;
      showThread(true);
    });
    page.frame();

    expect(page.plays).toEqual(['forward']);
    await page.finish();
  });

  it('plays nothing when the change leaves the phone layout, as signing out does', async () => {
    const page = browser();
    showThread(true);
    slidePhonePage(() => {
      document.body.replaceChildren();
      showThread(false);
    });
    page.frame();

    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
  });
});

describe('afterWaitingSlide', () => {
  it('runs a change at once when no slide waits for its frame', () => {
    browser();
    const change = vi.fn();
    afterWaitingSlide(change);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('runs a change after those that wait, so the last word on the page is its own', async () => {
    const page = browser();
    slidePhonePage(() => showList(true));
    afterWaitingSlide(() => showList(false));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);

    page.frame();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    // The list never showed: nothing slides.
    expect(page.plays).toEqual([]);
    await page.finish();
  });
});

describe('movePhoneNavDrawer', () => {
  const set = (open: boolean) => showList(open);

  it('brings the list out at once over the page, which stays put', () => {
    const page = browser();
    movePhoneNavDrawer(true, set);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    // Nothing turns off the drawer's own slide, not even for a moment.
    expect(page.request).not.toHaveBeenCalled();
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  /** `set`, which also notes the marker the page has when the drawer comes out. */
  const noting = () => {
    const markers: (string | undefined)[] = [];
    const setNoting = (open: boolean) => {
      markers.push(root.dataset.pageSlide);
      set(open);
    };
    return { markers, set: setNoting };
  };

  it('skips a slide that waits for its frame, whose change still runs, and comes out after it', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    expect(root.dataset.pageSlide).toBe('');
    const drawer = noting();
    movePhoneNavDrawer(true, drawer.set);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);

    // The skipped slide's change runs, and it ends.
    await vi.waitFor(() => expect(store.get(phoneNavDrawerOpenAtom)).toBe(true));
    expect(store.get(conversationUnderThreadAtom)).toBe(true);
    // No slide played, and the drawer came out with no marker to turn off its own slide.
    expect(copy()).toBeNull();
    // The frame it waited for, should it still come, changes nothing.
    page.frame();
    expect(page.plays).toEqual([]);
    expect(drawer.markers).toEqual([undefined]);
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('cuts a slide that plays short and comes out once its marker is gone', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    page.frame();
    expect(page.plays).toEqual(['forward']);
    const drawer = noting();
    movePhoneNavDrawer(true, drawer.set);
    // The copy goes at once, with the slide.
    expect(copy()).toBeNull();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);

    await vi.waitFor(() => expect(store.get(phoneNavDrawerOpenAtom)).toBe(true));
    expect(drawer.markers).toEqual([undefined]);
    // The next change slides again.
    slidePhonePage(() => showThread(false));
    expect(page.request).toHaveBeenCalledTimes(2);
    page.frame();
    await page.finish();
  });

  it('stays away when the phone layout goes before the slide it cut short is over', async () => {
    browser();
    slidePhonePage(() => showThread(true));
    movePhoneNavDrawer(true, set);
    document.body.replaceChildren();
    // The skipped slide runs its change and ends.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(store.get(conversationUnderThreadAtom)).toBe(true);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
  });

  it('puts the list away through slidePhonePage, where nothing slides from the list', async () => {
    const page = browser();
    showList(true);
    movePhoneNavDrawer(false, set);
    // It waits for the frame with the navigation a tap on a link in the list starts.
    expect(page.request).toHaveBeenCalledTimes(1);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    expect(root.dataset.pageSlide).toBeUndefined();

    page.frame();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    expect(page.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
    await page.finish();
  });
});

describe('withPhonePageSlide', () => {
  const stateAt = (key: string, historyAction = 'PUSH') =>
    ({ location: { key }, historyAction } as RouterState);

  /** A router that tells its listeners what `emit` gives it. */
  const routerAt = (key: string) => {
    const listeners = new Set<Listener>();
    const router = {
      state: stateAt(key),
      window,
      subscribe: (listener: Listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Router;
    const emit = (state: RouterState, flushSync = false) =>
      listeners.forEach((listener) =>
        listener(state, { deletedFetchers: [], flushSync, viewTransitionOpts: undefined })
      );
    return { router, emit };
  };

  it('keeps the router as it is but for its listeners', () => {
    const { router } = routerAt('a');
    const sliding = withPhonePageSlide(router);
    expect(sliding.state).toBe(router.state);
    expect(sliding.window).toBe(window);
  });

  it('shows a new location inside a slide, the page changed before the slide plays', async () => {
    const page = browser();
    const { router, emit } = routerAt('a');
    const listener = vi.fn(() => showThread(true));
    withPhonePageSlide(router).subscribe(listener);

    const next = stateAt('b');
    emit(next);
    expect(listener).not.toHaveBeenCalled();

    page.frame();
    expect(listener).toHaveBeenCalledWith(next, expect.objectContaining({ flushSync: true }));
    expect(root.dataset.pageSlide).toBe('forward');
    await page.finish();
  });

  it('passes on what keeps the location as the router gave it', () => {
    const page = browser();
    const { router, emit } = routerAt('a');
    const listener = vi.fn();
    withPhonePageSlide(router).subscribe(listener);

    const same = stateAt('a');
    emit(same);
    expect(listener).toHaveBeenCalledWith(same, expect.objectContaining({ flushSync: false }));
    expect(page.request).not.toHaveBeenCalled();
  });

  it('keeps the order of what the router tells while a location waits for its slide', async () => {
    const page = browser();
    const { router, emit } = routerAt('a');
    const seen: RouterState[] = [];
    withPhonePageSlide(router).subscribe((state) => seen.push(state));

    const moved = stateAt('b');
    const settled = stateAt('b');
    emit(moved);
    emit(settled);
    expect(seen).toEqual([]);

    page.frame();
    expect(seen).toEqual([moved, settled]);
    await page.finish();
  });

  it('leaves a step back the browser has shown sliding as it is', () => {
    const page = browser();
    const { router, emit } = routerAt('b');
    const listener = vi.fn();
    withPhonePageSlide(router).subscribe(listener);

    const swiped = new Event('popstate');
    Object.defineProperty(swiped, 'hasUAVisualTransition', { value: true });
    window.dispatchEvent(swiped);
    const back = stateAt('a', 'POP');
    emit(back);
    expect(listener).toHaveBeenCalledWith(back, expect.objectContaining({ flushSync: false }));
    expect(page.request).not.toHaveBeenCalled();

    // The next step back, which the browser did not show, slides.
    window.dispatchEvent(new Event('popstate'));
    emit(stateAt('z', 'POP'));
    expect(page.request).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const { router, emit } = routerAt('a');
    const listener = vi.fn();
    const unsubscribe = withPhonePageSlide(router).subscribe(listener);
    unsubscribe();
    emit(stateAt('b'));
    expect(listener).not.toHaveBeenCalled();
  });
});
