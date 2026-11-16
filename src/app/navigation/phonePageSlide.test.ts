// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { conversationUnderThreadAtom } from './conversationCover';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import { PHONE_STAGE, slidePhonePage, withPhonePageSlide } from './phonePageSlide';

type Router = Parameters<typeof withPhonePageSlide>[0];
type RouterState = Router['state'];
type Listener = Parameters<Router['subscribe']>[0];

const store = getImperativeJotaiStore();
const root = document.documentElement;

/** The browser's side of a slide: it takes the page's picture, then asks for the change. */
const browser = () => {
  let update: (() => void) | undefined;
  let end: () => void = () => undefined;
  const skipTransition = vi.fn();
  const start = vi.fn((callback: () => void) => {
    update = callback;
    const finished = new Promise<void>((resolve) => {
      end = resolve;
    });
    return { finished, ready: Promise.resolve(), skipTransition };
  });
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
  return {
    start,
    skipTransition,
    /** The picture is taken: the page changes. */
    takePicture: () => {
      const run = update;
      update = undefined;
      run?.();
    },
    /** The slide has played to its end. */
    finish: async () => {
      end();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
};

const showList = (shown: boolean) => store.set(phoneNavDrawerOpenAtom, shown);
const showThread = (shown: boolean) => store.set(conversationUnderThreadAtom, shown);

beforeEach(() => {
  const stage = document.createElement('div');
  stage.setAttribute(PHONE_STAGE, '');
  document.body.append(stage);
  showList(false);
  showThread(false);
});

afterEach(async () => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
  // A slide a test left playing ends, so the next test starts with none.
  delete root.dataset.pageSlide;
});

describe('slidePhonePage', () => {
  it('changes the page at once in a browser without view transitions', () => {
    const change = vi.fn();
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
  });

  it('changes the page at once outside the phone layout', () => {
    const page = browser();
    document.body.replaceChildren();
    const change = vi.fn();
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
    expect(page.start).not.toHaveBeenCalled();
  });

  it('changes the page at once for someone who asked for reduced motion', () => {
    const page = browser();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const change = vi.fn();
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
    expect(page.start).not.toHaveBeenCalled();
  });

  it('slides forward when the list gives way to a page', async () => {
    const page = browser();
    showList(true);
    const change = vi.fn(() => showList(false));
    slidePhonePage(change);
    // The picture of the list is not taken yet: the list stays.
    expect(change).not.toHaveBeenCalled();
    expect(root.dataset.pageSlide).toBe('');

    page.takePicture();
    expect(change).toHaveBeenCalledWith(true);
    expect(root.dataset.pageSlide).toBe('forward');
    expect(page.skipTransition).not.toHaveBeenCalled();

    await page.finish();
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('slides forward when a thread fills the page', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    page.takePicture();
    expect(root.dataset.pageSlide).toBe('forward');
    await page.finish();
  });

  it('slides back when a thread closes, and when the list comes back', async () => {
    const page = browser();
    showThread(true);
    slidePhonePage(() => showThread(false));
    page.takePicture();
    expect(root.dataset.pageSlide).toBe('back');
    await page.finish();

    slidePhonePage(() => showList(true));
    page.takePicture();
    expect(root.dataset.pageSlide).toBe('back');
    await page.finish();
  });

  it('plays nothing when the change leaves the page as deep as it was', async () => {
    const page = browser();
    const change = vi.fn();
    slidePhonePage(change);
    page.takePicture();
    expect(change).toHaveBeenCalledWith(true);
    expect(page.skipTransition).toHaveBeenCalledTimes(1);
    expect(root.dataset.pageSlide).toBe('');
    await page.finish();
    expect(root.dataset.pageSlide).toBeUndefined();
  });

  it('takes changes that come while it waits for the picture into the same slide, in order', async () => {
    const page = browser();
    showList(true);
    const order: string[] = [];
    slidePhonePage(() => {
      order.push('list away');
      showList(false);
    });
    slidePhonePage(() => order.push('room'));
    expect(order).toEqual([]);
    expect(page.start).toHaveBeenCalledTimes(1);

    page.takePicture();
    expect(order).toEqual(['list away', 'room']);
    expect(root.dataset.pageSlide).toBe('forward');
    await page.finish();
  });

  it('changes the page at once while a slide plays', async () => {
    const page = browser();
    slidePhonePage(() => showThread(true));
    page.takePicture();

    const change = vi.fn(() => showThread(false));
    slidePhonePage(change);
    expect(change).toHaveBeenCalledWith(false);
    expect(page.start).toHaveBeenCalledTimes(1);
    // The slide that plays keeps its direction.
    expect(root.dataset.pageSlide).toBe('forward');
    await page.finish();

    // The next change slides again.
    slidePhonePage(() => showThread(true));
    expect(page.start).toHaveBeenCalledTimes(2);
    page.takePicture();
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

    page.takePicture();
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
    expect(page.start).not.toHaveBeenCalled();
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

    page.takePicture();
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
    expect(page.start).not.toHaveBeenCalled();

    // The next step back, which the browser did not show, slides.
    window.dispatchEvent(new Event('popstate'));
    emit(stateAt('z', 'POP'));
    expect(page.start).toHaveBeenCalledTimes(1);
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
