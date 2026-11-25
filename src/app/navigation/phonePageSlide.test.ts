// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readDeepTraceSnapshot, setDeepTraceEnabled } from '../diagnostics/deepTrace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { conversationUnderThreadAtom } from './conversationCover';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import {
  PHONE_PAGE,
  PHONE_STAGE,
  afterWaitingSlide,
  capturePhoneSwipePreview,
  captureStageSnapshot,
  claimInteractivePhoneSlide,
  clearPhoneSwipePreviews,
  createThreadBackSwipeScene,
  createThreadForwardSwipeScene,
  isInteractivePhoneSlideClaimed,
  movePhoneNavDrawer,
  rekeyPhoneSwipePreviewThread,
  setActivePhoneSwipeContext,
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
/** Router subscriptions created during a test, cleaned up in afterEach. */
const unsubscribes: Array<() => void> = [];

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
  while (unsubscribes.length > 0) unsubscribes.pop()?.();
  clearPhoneSwipePreviews();
  setActivePhoneSwipeContext(undefined);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete root.dataset.pageSlide;
  delete root.dataset.pageSlideHeld;
});

describe('slidePhonePage', () => {
  it('records an unmatched start until the shield is removed', async () => {
    const page = browser();
    await setDeepTraceEnabled(true, localStorage);
    const events = async () =>
      (await readDeepTraceSnapshot()).events.filter(({ name }) =>
        name.startsWith('navigation.phone_slide.')
      );
    try {
      slidePhonePage(() => showThread(true));
      page.frame();
      expect((await events()).map(({ name }) => name)).toEqual([
        'navigation.phone_slide.forward.start',
      ]);
      await page.finish();
      expect(await events()).toMatchObject([
        { name: 'navigation.phone_slide.forward.start' },
        { name: 'navigation.phone_slide.forward.end', data: { duration_ms: expect.any(Number) } },
      ]);
    } finally {
      await setDeepTraceEnabled(false, localStorage);
    }
  });
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

  it('keeps the boxes of marked rows outside the clip without copying their contents', () => {
    const page = browser();
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    stage.innerHTML =
      '<div data-page-slide-clip>' +
      '<div class="card" data-page-slide-row="above"><span>Above the clip</span></div>' +
      '<div class="card" data-page-slide-row="visible"><span>Still visible</span></div>' +
      '<div data-page-slide-row="gutter"><span>In the gutter</span></div>' +
      '<div class="card" data-page-slide-row="below"><span>Below the clip</span></div></div>' +
      '<div data-page-slide-row="other"><span>Outside the clip container</span></div>';
    const view = stage.querySelector('[data-page-slide-clip]')!;
    vi.stubGlobal('innerHeight', 844);
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      if (this === stage) return new DOMRect(0, 0, 390, 844);
      if (this === view) return new DOMRect(0, 180, 390, 470);
      const y = { above: -800, visible: 300, gutter: 1200, below: 1550 }[
        this.getAttribute('data-page-slide-row') ?? ''
      ];
      return new DOMRect(0, y ?? 2000, 380.5, 42.25);
    });
    try {
      slidePhonePage(() => showThread(true));
      page.frame();
      const still = copy()!;
      for (const at of ['above', 'below']) {
        const row = still.querySelector<HTMLElement>(`[data-page-slide-row="${at}"]`)!;
        expect(row.childNodes).toHaveLength(0);
        expect(row.className).toBe('card');
        expect([row.style.boxSizing, row.style.width, row.style.height]).toEqual([
          'border-box',
          '380.5px',
          '42.25px',
        ]);
      }
      expect(still.querySelector('[data-page-slide-row="visible"] > span')?.textContent).toBe(
        'Still visible'
      );
      expect(still.querySelector('[data-page-slide-row="gutter"] > span')?.textContent).toBe(
        'In the gutter'
      );
      expect(still.querySelector('[data-page-slide-row="other"] > span')?.textContent).toBe(
        'Outside the clip container'
      );
    } finally {
      rect.mockRestore();
    }
  });

  it('copies a clip with no layout box as an empty shell on Back', async () => {
    const page = browser();
    showThread(true);
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    stage.innerHTML =
      '<div data-page-slide-clip style="display:none">' +
      '<div data-page-slide-row><span>Hidden</span></div></div>';
    slidePhonePage(() => showThread(false));
    page.frame();
    const shell = copy()?.querySelector<HTMLElement>('[data-page-slide-clip]');
    expect(shell?.childElementCount).toBe(0);
    expect(shell?.style.height).toBe('0px');
    expect(page.plays).toEqual(['back']);
    await page.finish();
    expect(copy()).toBeNull();
  });

  it('draws in the copy the pictures the page shows, and loads none', async () => {
    const page = browser();
    const stage = document.querySelector(`[${PHONE_STAGE}]`)!;
    stage.innerHTML =
      '<img class="avatar" src="blob:held" srcset="blob:held 2x" loading="lazy" alt="Held" width="80">' +
      '<canvas width="30" height="10"></canvas>' +
      '<img src="loaded.png" srcset="loaded-2x.png 2x" alt="Loaded"><img src="wide.png" alt="Wide">' +
      '<img src="far.png" alt="Far"><img src="hidden.png" alt="Hidden"><img src="blob:loading" alt="Loading">' +
      '<iframe srcdoc="<p>preview</p>" sandbox=""></iframe><video poster="poster.png"><source src="clip.mp4"></video>' +
      '<picture><source srcset="loaded.webp"><img src="loaded.png"></picture>';
    const shown = Array.from(stage.querySelectorAll('img'));
    // As a browser lays them out, on a screen of twice its pixels: 40 by 20, the wide picture
    // 160 by 160, one of no size, and one scrolled out of the layout, far below it.
    const box = (element: Element) =>
      ({ Wide: [160, 160], Hidden: [0, 0] })[element.getAttribute('alt') ?? ''] ?? [40, 20];
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function width(
      this: HTMLElement
    ) {
      return box(this)[0]!;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(
      this: HTMLElement
    ) {
      return box(this)[1]!;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(
      this: Element
    ) {
      const [width, height] = this === stage ? [390, 844] : box(this);
      return new DOMRect(0, this.getAttribute('alt') === 'Far' ? 2000 : 0, width, height);
    });
    vi.stubGlobal('devicePixelRatio', 2);
    // jsdom draws nothing on a canvas: what each would draw.
    const draws: [HTMLCanvasElement, unknown, unknown[]][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function context(
      this: HTMLCanvasElement
    ) {
      return {
        drawImage: (from: unknown, ...at: unknown[]) => draws.push([this, from, at]),
      } as unknown as CanvasRenderingContext2D;
    });
    // As a browser has it: the page has loaded all its pictures but one.
    const loaded = function loaded(this: HTMLImageElement) {
      return this.getAttribute('src') !== 'blob:loading';
    };
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(loaded);
    // Their own sizes: the avatar 400 by 400, the one from the network 1000 by 200, the wide one
    // 8000 by 400, the others 40 by 40.
    const sizes: Record<string, [number, number]> = {
      Held: [400, 400],
      Loaded: [1000, 200],
      Wide: [8000, 400],
    };
    const size = (picture: HTMLImageElement): [number, number] =>
      loaded.call(picture) ? (sizes[picture.alt] ?? [40, 40]) : [0, 0];
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function width(
      this: HTMLImageElement
    ) {
      return size(this)[0];
    });
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(function height(
      this: HTMLImageElement
    ) {
      return size(this)[1];
    });
    try {
      slidePhonePage(() => showThread(true));
      page.frame();
      const still = copy()!;
      // In the page's own document, as the layout is.
      expect(still.ownerDocument).toBe(document);
      // Each picture the page shows is a canvas of its size, its styles kept, drawn from the
      // page's own picture: nothing to load or decode, and nothing lost where its address is.
      // The page's own canvas is drawn in its copy.
      const canvases = Array.from(still.querySelectorAll('canvas'));
      expect(canvases.map((canvas) => canvas.getAttribute('class'))).toEqual([
        'avatar',
        null,
        null,
        null,
        null,
      ]);
      const pictures = canvases.filter((_, index) => index !== 1);
      expect(pictures[3]!.parentElement!.tagName).toBe('PICTURE');
      expect(pictures.map(({ style }) => [style.width, style.height])).toEqual([
        ['40px', '20px'],
        ['40px', '20px'],
        ['160px', '160px'],
        ['40px', '20px'],
      ]);
      for (const picture of pictures) {
        const names = picture.getAttributeNames().filter((name) => name !== 'class');
        expect(names.sort()).toEqual(['height', 'style', 'width']);
      }
      // In their own shape, neither side sharper than the screen shows its box, and never
      // sharper than their own: the wide one too, whose height its width keeps down.
      expect(canvases.map(({ width, height }) => [width, height])).toEqual([
        [40, 40],
        [30, 10],
        [80, 16],
        [320, 16],
        [40, 40],
      ]);
      const [held, network, wide, , , , inPicture] = shown;
      expect(draws).toEqual(
        [held, stage.querySelector('canvas'), network, wide, inPicture].map((from, index) => [
          canvases[index],
          from,
          [0, 0, canvases[index]!.width, canvases[index]!.height],
        ])
      );
      // One scrolled out of the layout, one of no size and one still loading: blank boxes.
      const blanks = Array.from(still.querySelectorAll('img'));
      expect(blanks.map((blank) => blank.getAttributeNames())).toEqual([
        ['style'],
        ['style'],
        ['style'],
      ]);
      expect(blanks.map(({ style }) => style.height)).toEqual(['20px', '0px', '20px']);
      expect(still.querySelector('iframe')!.getAttributeNames()).toEqual(['sandbox', 'style']);
      expect(still.querySelector('video')!.getAttributeNames()).toEqual(['style']);
      expect(still.querySelectorAll('source[src], source[srcset]')).toHaveLength(0);
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
    // React writes a controlled field's value into its markup too (`value=` / a textarea's text).
    typed.forEach((field) => Object.assign(field, { defaultValue: 'typed-secret' }));
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
    void movePhoneNavDrawer(true, set);
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

  it('plays no slide when the page is hidden while the change waits for its frame', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const page = browser();
    const change = vi.fn(() => showThread(true));
    slidePhonePage(change);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      // No frame comes to a hidden page: the change runs without one.
      vi.advanceTimersByTime(100);
      expect(change).toHaveBeenCalledTimes(1);
      expect(copy()).toBeNull();
      expect(root.dataset.pageSlide).toBeUndefined();
      expect(page.plays).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
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
    void movePhoneNavDrawer(true, set);
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
    void movePhoneNavDrawer(true, drawer.set);
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
    void movePhoneNavDrawer(true, drawer.set);
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
    void movePhoneNavDrawer(true, set);
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
    void movePhoneNavDrawer(false, set);
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
    ({ location: { key }, historyAction }) as RouterState;

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
        listener(state, {
          deletedFetchers: [],
          newErrors: null,
          flushSync,
          viewTransitionOpts: undefined,
        })
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
    unsubscribes.push(withPhonePageSlide(router).subscribe(listener));

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
    unsubscribes.push(withPhonePageSlide(router).subscribe(listener));

    const same = stateAt('a');
    emit(same);
    expect(listener).toHaveBeenCalledWith(same, expect.objectContaining({ flushSync: false }));
    expect(page.request).not.toHaveBeenCalled();
  });

  it('keeps the order of what the router tells while a location waits for its slide', async () => {
    const page = browser();
    const { router, emit } = routerAt('a');
    const seen: RouterState[] = [];
    unsubscribes.push(withPhonePageSlide(router).subscribe((state) => seen.push(state)));

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
    unsubscribes.push(withPhonePageSlide(router).subscribe(listener));

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

describe('interactive swipe snapshots, preview cache, scenes, and async handoff', () => {
  const SESSION = 'session-1';
  const ROOM = '!room:example.org';
  const THREAD = '$thread-1';

  const makeStage = (label: string, scrollTop = 0) => {
    const stage = document.querySelector<HTMLElement>(`[${PHONE_STAGE}]`)!;
    stage.replaceChildren();
    const topBar = document.createElement('div');
    topBar.setAttribute('data-phone-top-bar', '');
    topBar.textContent = 'Top Bar';
    const page = document.createElement('div');
    page.setAttribute(PHONE_PAGE, '');
    page.textContent = label;
    const scroller = document.createElement('div');
    scroller.className = 'scroller';
    scroller.scrollTop = scrollTop;
    page.append(scroller);
    stage.append(topBar, page);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      top: 0,
      left: 0,
      right: 390,
      bottom: 844,
      toJSON: () => ({}),
    });
    return { stage, topBar, page, scroller };
  };

  const stateAt = (key: string, historyAction = 'PUSH') =>
    ({ location: { key }, historyAction }) as RouterState;

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
        listener(state, {
          deletedFetchers: [],
          newErrors: null,
          flushSync,
          viewTransitionOpts: undefined,
        })
      );
    return { router, emit };
  };

  it('redacts [contenteditable] drafts and strips swipe chrome/translate in captureStageSnapshot', () => {
    const { stage, page } = makeStage('Room');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p><span>secret composer draft</span></p>';
    page.append(editor);

    stage.setAttribute('data-swipe-stage', 'back');
    page.setAttribute('data-swiping', '');
    page.setAttribute('data-swipe-shadow', '');
    page.style.translate = '120px 0';

    const leftoverPreview = document.createElement('div');
    leftoverPreview.setAttribute('data-swipe-preview', 'under');
    leftoverPreview.textContent = 'stale preview';
    const leftoverDim = document.createElement('div');
    leftoverDim.setAttribute('data-swipe-dim', 'back');
    stage.append(leftoverPreview, leftoverDim);

    const { copy: snap } = captureStageSnapshot(stage);

    expect(snap.querySelector('[contenteditable="true"]')?.textContent).toBe('');
    // Live composer draft must stay untouched.
    expect(editor.textContent).toBe('secret composer draft');
    expect(snap.hasAttribute('data-swipe-stage')).toBe(false);
    expect(snap.querySelector('[data-swiping]')).toBeNull();
    expect(snap.querySelector('[data-swipe-shadow]')).toBeNull();
    expect(snap.querySelector('[data-swipe-preview]')).toBeNull();
    expect(snap.querySelector('[data-swipe-dim]')).toBeNull();
    expect(snap.querySelector<HTMLElement>(`[${PHONE_PAGE}]`)?.style.translate).toBe('');
  });

  it('retains room preview during slidePhonePage (1 -> 2) and reuses it on interactive back swipe', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Room Overview', 145);
    setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM });

    slidePhonePage(() => {
      showThread(true);
      setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM, threadId: THREAD });
      page.textContent = 'Thread View';
    });
    pageMock.frame();
    await pageMock.finish();

    const onCommit = vi.fn();
    const scene = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-thread',
      onCommit,
      dirSign: 1,
    });
    expect(scene).not.toBeNull();

    const under = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]');
    expect(under).not.toBeNull();
    expect(under?.textContent).toContain('Room Overview');
    expect(under?.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(145);

    scene!.update(195, 0.5);
    expect(page.style.translate).toBe('195px');
    expect(under?.style.translate).toBe(`${-0.3 * 390 * 0.5}px`);
    expect(stage.querySelector<HTMLElement>('[data-swipe-dim="back"]')?.style.opacity).toBe('0.06');

    // Cancel drag: cleans up styles/preview without committing and preserves cache for retry.
    await scene!.settle(false, 0, 195);
    scene!.cleanup(false);

    expect(onCommit).not.toHaveBeenCalled();
    expect(stage.hasAttribute('data-swipe-stage')).toBe(false);
    expect(stage.querySelector('[data-swipe-preview]')).toBeNull();
    expect(stage.querySelector('[data-swipe-dim]')).toBeNull();
    expect(page.style.translate).toBe('');
    expect(page.hasAttribute('data-swiping')).toBe(false);
    expect(page.hasAttribute('data-swipe-shadow')).toBe(false);

    // Retry still hits the retained room preview!
    const retry = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-thread',
      onCommit,
      dirSign: 1,
    });
    expect(stage.querySelector('[data-swipe-preview="under"]')?.textContent).toContain(
      'Room Overview'
    );
    retry!.cleanup(false);
  });

  it('falls back to themed backdrop on viewport resize, session/room mismatch, or clearPhoneSwipePreviews', () => {
    const { stage } = makeStage('Room Overview');
    const origWidth = window.innerWidth;
    try {
      capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });

      // Session mismatch -> backdrop fallback.
      const wrongSession = createThreadBackSwipeScene({
        key: { sessionId: 'other-session', roomId: ROOM, threadId: THREAD },
        fromLocationKey: 'k1',
        onCommit: vi.fn(),
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      wrongSession!.cleanup(false);

      // Re-capture and check room mismatch -> backdrop fallback.
      capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });
      const wrongRoom = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: '!other:example.org', threadId: THREAD },
        fromLocationKey: 'k1',
        onCommit: vi.fn(),
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      wrongRoom!.cleanup(false);

      // Re-capture and resize viewport -> backdrop fallback.
      capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });
      Object.defineProperty(window, 'innerWidth', { value: origWidth + 50, configurable: true });
      const resized = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
        fromLocationKey: 'k1',
        onCommit: vi.fn(),
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      resized!.cleanup(false);

      // Re-capture and explicitly clear -> backdrop fallback.
      capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });
      clearPhoneSwipePreviews();
      const cleared = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
        fromLocationKey: 'k1',
        onCommit: vi.fn(),
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      cleared!.cleanup(false);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
    }
  });

  it('commits back swipe, captures departing thread preview, and suppresses async popstate double-slide', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Room Overview');
    capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });
    page.textContent = 'Active Thread Content';
    showThread(true);

    const { router, emit } = routerAt('k-thread');
    const listener = vi.fn(() => showThread(false));
    unsubscribes.push(withPhonePageSlide(router).subscribe(listener));

    const onCommit = vi.fn();
    const scene = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-thread',
      onCommit,
      dirSign: 1,
    });
    expect(scene).not.toBeNull();

    scene!.update(260, 260 / 390);
    await scene!.settle(true, 0, 260);
    scene!.commit();
    scene!.cleanup(true);

    expect(onCommit).toHaveBeenCalledTimes(1);
    // Hold overlay covers the stage while async popstate is pending; top page is already clean.
    expect(stage.querySelector('[data-swipe-preview="hold"]')).not.toBeNull();
    expect(page.style.translate).toBe('');
    expect(page.hasAttribute('data-swiping')).toBe(false);

    // Same-key update before popstate arrives must NOT consume the handoff.
    emit(stateAt('k-thread', 'POP'));
    expect(stage.querySelector('[data-swipe-preview="hold"]')).not.toBeNull();

    // Async popstate arrives with the room's location key: flushes synchronously with NO slidePhonePage.
    const next = stateAt('k-room', 'POP');
    emit(next);
    expect(listener).toHaveBeenCalledWith(next, expect.objectContaining({ flushSync: true }));
    expect(pageMock.plays).toEqual([]);
    expect(root.dataset.pageSlide).toBeUndefined();
    // Hold remains until 1 rAF paint frame completes.
    expect(stage.querySelector('[data-swipe-preview="hold"]')).not.toBeNull();

    pageMock.frame();
    expect(stage.querySelector('[data-swipe-preview="hold"]')).toBeNull();

    // Departing thread snapshot was captured on back commit, so forward swipe reuses it!
    const forward = createThreadForwardSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-room',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(stage.querySelector('[data-swipe-preview="over"]')?.textContent).toContain(
      'Active Thread Content'
    );
    forward!.cleanup(false);

    // Subsequent router navigation slides normally again.
    emit(stateAt('k-next', 'PUSH'));
    expect(pageMock.request).toHaveBeenCalled();
  });

  it('drives forward swipe parallax/dim, captures departing room on commit, and restores on cancel', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Thread Detail');
    capturePhoneSwipePreview('thread', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });
    page.textContent = 'Room List';

    const onCommit = vi.fn();
    const scene = createThreadForwardSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-room',
      onCommit,
      dirSign: 1,
    });
    expect(scene).not.toBeNull();

    const over = stage.querySelector<HTMLElement>('[data-swipe-preview="over"]');
    const dim = stage.querySelector<HTMLElement>('[data-swipe-dim="forward"]');
    expect(over).not.toBeNull();
    expect(over?.style.translate).toBe('390px');

    scene!.update(195, 0.5);
    expect(over?.style.translate).toBe('195px');
    expect(page.style.translate).toBe(`${-0.3 * 390 * 0.5}px`);
    expect(dim?.style.opacity).toBe('0.06');

    // Cancel keeps thread preview cached and cleans up cleanly.
    await scene!.settle(false, 0, 195);
    scene!.cleanup(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(stage.querySelector('[data-swipe-preview]')).toBeNull();
    expect(page.style.translate).toBe('');

    // Commit captures room preview and hands off over element as hold.
    const commitScene = createThreadForwardSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-room',
      onCommit,
      dirSign: 1,
    });
    await commitScene!.settle(true, 0, 300);
    commitScene!.commit();
    commitScene!.cleanup(true);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(stage.querySelector('[data-swipe-preview="hold"]')).not.toBeNull();

    // Release hold via nav drawer open (verifies movePhoneNavDrawer is never blocked by handoff).
    const setDrawer = vi.fn((open: boolean) => showList(open));
    void movePhoneNavDrawer(true, setDrawer);
    await vi.waitFor(() => expect(setDrawer).toHaveBeenCalledWith(true));
    expect(stage.querySelector('[data-swipe-preview="hold"]')).toBeNull();
    expect(pageMock.plays).toEqual([]);
  });

  it('auto-releases claimInteractivePhoneSlide on timeout, visibilitychange, and stage disconnect', async () => {
    vi.useFakeTimers();
    const { stage } = makeStage('Room');

    // 1. Timeout auto-cleanup.
    const hold1 = document.createElement('div');
    claimInteractivePhoneSlide({ fromLocationKey: 'k1', holdElement: hold1, timeoutMs: 250 });
    expect(stage.contains(hold1)).toBe(true);
    vi.advanceTimersByTime(250);
    expect(hold1.isConnected).toBe(false);

    // 2. visibilitychange (hidden) auto-cleanup.
    const hold2 = document.createElement('div');
    claimInteractivePhoneSlide({ fromLocationKey: 'k2', holdElement: hold2, timeoutMs: 1000 });
    expect(stage.contains(hold2)).toBe(true);
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(hold2.isConnected).toBe(false);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    // 3. Stage disconnect auto-cleanup.
    const hold3 = document.createElement('div');
    claimInteractivePhoneSlide({ fromLocationKey: 'k3', holdElement: hold3, timeoutMs: 1000 });
    expect(stage.contains(hold3)).toBe(true);
    stage.removeAttribute(PHONE_STAGE);
    await Promise.resolve();
    expect(hold3.isConnected).toBe(false);
  });

  it('excludes scrolled descendants of redacted [contenteditable] drafts from snapshot.scrolled', () => {
    const { stage, page } = makeStage('Room', 145);
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const draftScroll = document.createElement('div');
    draftScroll.scrollTop = 42;
    draftScroll.innerHTML = '<p><span>secret draft text</span></p>';
    editor.append(draftScroll);
    page.append(editor);

    const snapshot = captureStageSnapshot(stage);

    expect(snapshot.copy.textContent).not.toContain('secret draft text');
    expect(snapshot.scrolled.every(([el]) => snapshot.copy.contains(el))).toBe(true);
    expect(snapshot.scrolled).toHaveLength(1);
    expect(snapshot.scrolled[0]?.[1]).toBe(145);
  });

  it('mounts a below-top-bar input shield during async handoff and removes it on release', () => {
    const pageMock = browser();
    const { stage, topBar } = makeStage('Room');
    vi.spyOn(topBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 390,
      height: 52,
      top: 0,
      left: 0,
      right: 390,
      bottom: 52,
      toJSON: () => ({}),
    });
    const { router, emit } = routerAt('k-thread');
    unsubscribes.push(withPhonePageSlide(router).subscribe(vi.fn()));

    const hold = document.createElement('div');
    claimInteractivePhoneSlide({ fromLocationKey: 'k-thread', holdElement: hold });

    const shield = stage.querySelector<HTMLElement>('[data-swipe-hold-shield]');
    expect(shield).not.toBeNull();
    expect(shield?.style.pointerEvents).toBe('auto');
    expect(shield?.style.insetBlockStart).toBe('52px');

    emit(stateAt('k-room', 'POP'));
    // Shield stays until the 1-rAF paint frame completes.
    expect(stage.querySelector('[data-swipe-hold-shield]')).not.toBeNull();

    pageMock.frame();
    expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
    expect(stage.querySelector('[data-swipe-preview="hold"]')).toBeNull();
  });

  it('mounts the input shield from the start of settle, whichever way it settles, and removes it on cancel cleanup or when the handoff ends', async () => {
    const pageMock = browser();
    const { stage, topBar } = makeStage('Thread');
    vi.spyOn(topBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 390,
      height: 52,
      top: 0,
      left: 0,
      right: 390,
      bottom: 52,
      toJSON: () => ({}),
    });
    const { router, emit } = routerAt('k-thread');
    unsubscribes.push(withPhonePageSlide(router).subscribe(vi.fn()));

    // The settle's animations end when the test says so.
    const finishers: Array<() => void> = [];
    const fakeAnimate = vi.fn(() => {
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      finishers.push(finish);
      return { finished, cancel: vi.fn() } as unknown as Animation;
    });
    const origAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = fakeAnimate;
    const settleEnds = async (settling: Promise<void>) => {
      finishers.splice(0).forEach((finish) => finish());
      await settling;
    };
    const shields = () => stage.querySelectorAll<HTMLElement>('[data-swipe-hold-shield]');
    const key = { sessionId: SESSION, roomId: ROOM, threadId: THREAD };

    try {
      const swipes = [
        { createScene: createThreadBackSwipeScene, from: 'k-thread', to: 'k-room' },
        { createScene: createThreadForwardSwipeScene, from: 'k-room', to: 'k-thread-again' },
      ];
      for (const { createScene, from, to } of swipes) {
        // Released short of the threshold: shielded while it settles back, until cleanup.
        const cancelled = createScene({
          key,
          fromLocationKey: from,
          onCommit: vi.fn(),
          dirSign: 1,
        });
        cancelled!.update(100, 100 / 390);
        expect(shields()).toHaveLength(0);
        const settlingBack = cancelled!.settle(false, 200, 100);
        await Promise.resolve();
        expect(fakeAnimate).toHaveBeenCalled();
        expect(shields()).toHaveLength(1);
        expect(shields()[0]?.style.pointerEvents).toBe('auto');
        expect(shields()[0]?.style.insetBlockStart).toBe('52px');
        await settleEnds(settlingBack);
        expect(shields()).toHaveLength(1);
        cancelled!.cleanup(false);
        expect(shields()).toHaveLength(0);

        // Released past it: shielded while it settles, and the handoff keeps that shield.
        const onCommit = vi.fn();
        const committed = createScene({ key, fromLocationKey: from, onCommit, dirSign: 1 });
        committed!.update(260, 260 / 390);
        const settling = committed!.settle(true, 200, 260);
        await Promise.resolve();
        expect(shields()).toHaveLength(1);
        const settleShield = shields()[0];
        await settleEnds(settling);
        committed!.commit();
        committed!.cleanup(true);
        expect(onCommit).toHaveBeenCalledOnce();
        expect(isInteractivePhoneSlideClaimed()).toBe(true);
        // No gap and no second shield.
        expect(shields()).toHaveLength(1);
        expect(shields()[0]).toBe(settleShield);

        // The route commits: the shield goes with the handoff, a frame later.
        emit(stateAt(to, 'POP'));
        expect(shields()).toHaveLength(1);
        pageMock.frame();
        expect(isInteractivePhoneSlideClaimed()).toBe(false);
        expect(shields()).toHaveLength(0);
      }
    } finally {
      HTMLElement.prototype.animate = origAnimate;
    }
  });

  it('aborts commit and discards captured preview if active thread or location changes mid-settle', async () => {
    browser();
    const { stage, page } = makeStage('Thread A');
    const { router, emit } = routerAt('k-a');
    unsubscribes.push(withPhonePageSlide(router).subscribe(vi.fn()));
    setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM, threadId: '$thread-a' });

    let finishAnim!: () => void;
    const animPromise = new Promise<void>((resolve) => {
      finishAnim = resolve;
    });
    const fakeAnimate = vi.fn(
      () =>
        ({
          finished: animPromise,
          cancel: vi.fn(),
        }) as unknown as Animation
    );
    const origAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = fakeAnimate;

    try {
      const onCommit = vi.fn();
      const scene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-a' },
        fromLocationKey: 'k-a',
        onCommit,
        dirSign: 1,
      });
      expect(scene).not.toBeNull();

      scene!.update(260, 260 / 390);
      const settlePromise = scene!.settle(true, 150, 260);

      // Route switches to thread B mid-settle while RoomView stays mounted.
      setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM, threadId: '$thread-b' });
      emit(stateAt('k-b', 'PUSH'));

      finishAnim();
      await settlePromise;
      scene!.commit();
      scene!.cleanup(true);

      expect(onCommit).not.toHaveBeenCalled();
      expect(stage.querySelector('[data-swipe-preview]')).toBeNull();
      expect(stage.querySelector('[data-swipe-hold-shield]')).toBeNull();
      expect(page.style.translate).toBe('');

      // No stale thread-a preview was left behind.
      setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM });
      const forward = createThreadForwardSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-a' },
        fromLocationKey: 'k-b',
        onCommit: vi.fn(),
        dirSign: 1,
      });
      expect(stage.querySelector('[data-swipe-preview="over-backdrop"]')).not.toBeNull();
      forward!.cleanup(false);
    } finally {
      HTMLElement.prototype.animate = origAnimate;
    }
  });

  it('binds roomPreview to the entered threadId, keeps and displays it across height-only resizes, and invalidates on width resize', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Room Overview', 145);
    setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM });

    slidePhonePage(() => {
      showThread(true);
      setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' });
      page.textContent = 'Thread 1';
    });
    pageMock.frame();
    await pageMock.finish();

    // Thread 2 in the same room must NOT reuse Thread 1's room preview.
    setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM, threadId: '$thread-2' });
    const t2Scene = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-2' },
      fromLocationKey: 'k-t2',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
    t2Scene!.cleanup(false);

    const expectUnderPreview = (expectedText: string, expectedScrollTop: number) => {
      const scene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' },
        fromLocationKey: 'k-t1',
        onCommit: vi.fn(),
        dirSign: 1,
      });
      const under = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]');
      expect(under?.textContent).toContain(expectedText);
      expect(under?.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(expectedScrollTop);
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).toBeNull();
      scene!.cleanup(false);
    };

    // Thread 1 hits the room preview before resize.
    setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' });
    expectUnderPreview('Room Overview', 145);

    const origWidth = window.innerWidth;
    const origHeight = window.innerHeight;
    const setStageHeight = (height: number) => {
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 390,
        height,
        top: 0,
        left: 0,
        right: 390,
        bottom: height,
        toJSON: () => ({}),
      });
    };
    try {
      // Full height -> keyboard-open height (iOS --app-height shrink and Android innerHeight
      // resize): the preview stays retained and is displayed.
      setStageHeight(844 - 280);
      expectUnderPreview('Room Overview', 145);

      Object.defineProperty(window, 'innerHeight', { value: origHeight - 280, configurable: true });
      window.dispatchEvent(new Event('resize'));
      expectUnderPreview('Room Overview', 145);

      // Keyboard-open height -> full height: capture while keyboard is open, then dismiss it.
      const { page: keyboardPage } = makeStage('Keyboard Room Overview', 95);
      setStageHeight(844 - 280);
      capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' });
      keyboardPage.textContent = 'Thread 1';

      Object.defineProperty(window, 'innerHeight', { value: origHeight, configurable: true });
      setStageHeight(844);
      window.dispatchEvent(new Event('resize'));
      expectUnderPreview('Keyboard Room Overview', 95);

      // Width resize (even if rotated back to original width): preview invalidated immediately!
      Object.defineProperty(window, 'innerWidth', { value: origWidth + 200, configurable: true });
      window.dispatchEvent(new Event('resize'));
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
      window.dispatchEvent(new Event('resize'));

      const afterRotateBack = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' },
        fromLocationKey: 'k-t1',
        onCommit: vi.fn(),
        dirSign: 1,
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      expect(stage.querySelector('[data-swipe-preview="under"]')).toBeNull();
      afterRotateBack!.cleanup(false);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: origHeight, configurable: true });
    }
  });

  it('refreshes inline --room-header-height on mounted previews before restoring scroll offsets', () => {
    const { stage, page, scroller } = makeStage('Short Area Room', 120);
    const area = document.createElement('div');
    area.setAttribute('data-test-area', 'with-inset');
    area.style.setProperty('--room-header-height', '0px');
    const header = document.createElement('div');
    header.setAttribute('data-room-header', 'true');
    area.append(header, scroller);

    const plainParent = document.createElement('div');
    plainParent.setAttribute('data-test-area', 'without-inset');
    const plainHeader = document.createElement('div');
    plainHeader.setAttribute('data-room-header', 'true');
    plainParent.append(plainHeader);

    page.append(area, plainParent);

    let clonedHeaderHeight = 0;
    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.getAttribute('data-room-header') === 'true' ? clonedHeaderHeight : 0;
      });
    const origScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const headerHeightAtScrollRestore: string[] = [];
    const scrollTopSpy = vi
      .spyOn(Element.prototype, 'scrollTop', 'set')
      .mockImplementation(function (this: Element, value: number) {
        if (this.classList.contains('scroller') && this.closest('[data-page-slide-copy]')) {
          const clonedArea = this.closest<HTMLElement>('[data-test-area="with-inset"]');
          headerHeightAtScrollRestore.push(
            clonedArea?.style.getPropertyValue('--room-header-height') ?? ''
          );
        }
        origScrollTop.set!.call(this, value);
      });

    try {
      capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: THREAD });
      page.textContent = 'Thread View';

      // Mounted at full height: cloned header becomes visible (48px), updating the inset before
      // scroll restoration while leaving headers without an inline inset untouched.
      clonedHeaderHeight = 48;
      const tallScene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
        fromLocationKey: 'k-tall',
        onCommit: vi.fn(),
        dirSign: 1,
      });
      const underTall = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]');
      const tallArea = underTall?.querySelector<HTMLElement>('[data-test-area="with-inset"]');
      const tallPlain = underTall?.querySelector<HTMLElement>('[data-test-area="without-inset"]');
      expect(tallArea?.style.getPropertyValue('--room-header-height')).toBe('48px');
      expect(tallPlain?.style.getPropertyValue('--room-header-height')).toBe('');
      expect(underTall?.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(120);
      expect(headerHeightAtScrollRestore).toEqual(['48px']);
      tallScene!.cleanup(false);

      // Mounted again at a short height: cloned header collapses back to 0px before scroll restore.
      clonedHeaderHeight = 0;
      const shortScene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
        fromLocationKey: 'k-short',
        onCommit: vi.fn(),
        dirSign: 1,
      });
      const underShort = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]');
      const shortArea = underShort?.querySelector<HTMLElement>('[data-test-area="with-inset"]');
      expect(shortArea?.style.getPropertyValue('--room-header-height')).toBe('0px');
      expect(underShort?.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(120);
      expect(headerHeightAtScrollRestore).toEqual(['48px', '0px']);
      shortScene!.cleanup(false);
    } finally {
      scrollTopSpy.mockRestore();
      offsetHeightSpy.mockRestore();
    }
  });

  it('rekeys a retained preview from local-echo threadId to confirmed threadId and ignores mismatches', () => {
    const { stage, page } = makeStage('Room Before Send', 60);
    const localId = `~${ROOM}:txn1`;
    const confirmedId = '$confirmed-1';
    capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: localId });
    page.textContent = 'New Thread';

    const expectBackdropFor = (threadId: string) => {
      const scene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId },
        fromLocationKey: `k-${threadId}`,
        onCommit: vi.fn(),
        dirSign: 1,
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      expect(stage.querySelector('[data-swipe-preview="under"]')).toBeNull();
      scene!.cleanup(false);
    };

    // Mismatched session, room, threadId, or empty nextThreadId leave the preview untouched.
    rekeyPhoneSwipePreviewThread(
      'room',
      { sessionId: 'other-session', roomId: ROOM, threadId: localId },
      confirmedId
    );
    rekeyPhoneSwipePreviewThread(
      'room',
      { sessionId: SESSION, roomId: '!other:example.org', threadId: localId },
      confirmedId
    );
    rekeyPhoneSwipePreviewThread(
      'room',
      { sessionId: SESSION, roomId: ROOM, threadId: '$other' },
      confirmedId
    );
    rekeyPhoneSwipePreviewThread(
      'room',
      { sessionId: SESSION, roomId: ROOM, threadId: localId },
      ''
    );
    expectBackdropFor(confirmedId);

    rekeyPhoneSwipePreviewThread(
      'room',
      { sessionId: SESSION, roomId: ROOM, threadId: localId },
      confirmedId
    );
    expectBackdropFor(localId);

    const confirmedScene = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: confirmedId },
      fromLocationKey: 'k-confirmed',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    const under = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]');
    expect(under?.textContent).toContain('Room Before Send');
    expect(under?.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(60);
    expect(stage.querySelector('[data-swipe-preview="backdrop"]')).toBeNull();
    confirmedScene!.cleanup(false);
  });

  it('preserves loaded images inside a horizontally translated page via horizontalShiftPx', async () => {
    const { stage, page } = makeStage('Thread With Avatar');
    const img = document.createElement('img');
    img.src = 'https://example.org/avatar.png';
    Object.defineProperties(img, {
      complete: { value: true, configurable: true },
      naturalWidth: { value: 64, configurable: true },
      naturalHeight: { value: 64, configurable: true },
      offsetWidth: { value: 32, configurable: true },
      offsetHeight: { value: 32, configurable: true },
    });
    // Image's resting box is [100..132], shifted +320px to [420..452] outside stage width 390.
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      x: 420,
      y: 100,
      width: 32,
      height: 32,
      top: 100,
      left: 420,
      right: 452,
      bottom: 132,
      toJSON: () => ({}),
    });
    page.append(img);

    const drawImage = vi.fn();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);

    try {
      // Without shift compensation, the translated image appears off-screen and stays blank.
      const unshifted = captureStageSnapshot(stage);
      expect(unshifted.copy.querySelector('canvas')).toBeNull();
      expect(drawImage).not.toHaveBeenCalled();

      // With horizontalShiftPx = 320, resting coordinates [100..132] are inside [0..390] and drawn.
      const shifted = captureStageSnapshot(stage, { horizontalShiftPx: 320 });
      expect(shifted.copy.querySelector('canvas')).not.toBeNull();
      expect(drawImage).toHaveBeenCalledTimes(1);

      // End-to-end via createThreadBackSwipeScene settle(true, 0, 320): retained thread preview keeps canvas!
      drawImage.mockClear();
      const scene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
        fromLocationKey: 'k-thread',
        onCommit: vi.fn(),
        dirSign: 1,
      });
      await scene!.settle(true, 0, 320);
      scene!.commit();
      scene!.cleanup(true);
      expect(drawImage).toHaveBeenCalledTimes(1);
    } finally {
      getContextSpy.mockRestore();
    }
  });

  it('never caches or matches a wildcard roomPreview without threadId', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Room Overview');

    // Direct capture without threadId must not cache a wildcard entry.
    capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM });
    const noThreadMatch = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' },
      fromLocationKey: 'k-t1',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
    noThreadMatch!.cleanup(false);

    // slidePhonePage (1 -> 2) where destination threadId is unknown must not cache a wildcard entry.
    setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM });
    slidePhonePage(() => {
      showThread(true);
      page.textContent = 'Unknown Thread';
    });
    pageMock.frame();
    await pageMock.finish();

    const unknownDest = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-2' },
      fromLocationKey: 'k-t2',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
    unknownDest!.cleanup(false);

    // Capturing roomPreview for T1 must never match T2.
    capturePhoneSwipePreview('room', { sessionId: SESSION, roomId: ROOM, threadId: '$thread-1' });
    const t2Miss = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: '$thread-2' },
      fromLocationKey: 'k-t2',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
    t2Miss!.cleanup(false);
  });

  it('removes [contenteditable] draft media before document.adoptNode runs', () => {
    const { stage, page } = makeStage('Room');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>secret</p><img src="https://example.org/draft-image.png" />';
    page.append(editor);

    let imgCountAtAdopt = -1;
    let editableHtmlAtAdopt = 'unset';
    const origAdopt = document.adoptNode.bind(document);
    const adoptSpy = vi.spyOn(document, 'adoptNode').mockImplementation((node) => {
      if (node instanceof Element) {
        imgCountAtAdopt = node.querySelectorAll('img').length;
        editableHtmlAtAdopt = node.querySelector('[contenteditable="true"]')?.innerHTML ?? '';
      }
      return origAdopt(node);
    });

    try {
      const { copy: snap } = captureStageSnapshot(stage);
      expect(adoptSpy).toHaveBeenCalledTimes(1);
      expect(imgCountAtAdopt).toBe(0);
      expect(editableHtmlAtAdopt).toBe('');
      expect(snap.querySelector('img')).toBeNull();
      expect(snap.querySelector('[contenteditable="true"]')?.innerHTML).toBe('');
      // Live composer draft remains untouched.
      expect(editor.querySelectorAll('img')).toHaveLength(1);
      expect(editor.textContent).toBe('secret');
    } finally {
      adoptSpy.mockRestore();
    }
  });

  it('reports isInteractivePhoneSlideClaimed and stops touchstart propagation on the hold shield', () => {
    const { stage } = makeStage('Room');
    const release = claimInteractivePhoneSlide({
      fromLocationKey: 'k-thread',
      holdElement: document.createElement('div'),
    });
    expect(isInteractivePhoneSlideClaimed()).toBe(true);

    const windowTouchStart = vi.fn();
    window.addEventListener('touchstart', windowTouchStart);
    try {
      const shield = stage.querySelector<HTMLElement>('[data-swipe-hold-shield]');
      expect(shield).not.toBeNull();
      shield!.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
      expect(windowTouchStart).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('touchstart', windowTouchStart);
      release();
    }
    expect(isInteractivePhoneSlideClaimed()).toBe(false);
  });

  it('skips [data-phone-overlay-layer] children during thread back and forward interactive drags', () => {
    const { stage, page } = makeStage('Thread Content');
    const drawerPanel = document.createElement('div');
    drawerPanel.setAttribute('data-phone-overlay-layer', '');
    const drawerScrim = document.createElement('div');
    drawerScrim.setAttribute('data-phone-overlay-layer', '');
    stage.append(drawerScrim, drawerPanel);

    const backScene = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-thread',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(backScene).not.toBeNull();
    backScene!.update(120, 0.3);

    expect(page.hasAttribute('data-swiping')).toBe(true);
    expect(page.style.translate).toBe('120px');
    expect(drawerPanel.hasAttribute('data-swiping')).toBe(false);
    expect(drawerPanel.style.translate).toBe('');
    expect(drawerScrim.hasAttribute('data-swiping')).toBe(false);
    expect(drawerScrim.style.translate).toBe('');
    backScene!.cleanup(false);

    const forwardScene = createThreadForwardSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-room',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(forwardScene).not.toBeNull();
    forwardScene!.update(120, 0.3);

    expect(page.hasAttribute('data-swiping')).toBe(true);
    expect(page.style.translate).not.toBe('');
    expect(drawerPanel.hasAttribute('data-swiping')).toBe(false);
    expect(drawerPanel.style.translate).toBe('');
    expect(drawerScrim.hasAttribute('data-swiping')).toBe(false);
    expect(drawerScrim.style.translate).toBe('');
    forwardScene!.cleanup(false);
  });

  it('captures roomPreview on 1 -> 2 slide from Space All threads when returnToSpaceThreads is set', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Space All Threads', 85);
    setActivePhoneSwipeContext({
      sessionId: SESSION,
      roomId: '!space:example.org',
      isSpaceThreads: true,
    });

    slidePhonePage(() => {
      showThread(true);
      setActivePhoneSwipeContext({
        sessionId: SESSION,
        roomId: ROOM,
        threadId: THREAD,
        returnToSpaceThreads: true,
      });
      page.textContent = 'Thread View';
    });
    pageMock.frame();
    await pageMock.finish();

    const scene = createThreadBackSwipeScene({
      key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
      fromLocationKey: 'k-thread',
      onCommit: vi.fn(),
      dirSign: 1,
    });
    expect(scene).not.toBeNull();
    const under = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]');
    expect(under?.textContent).toContain('Space All Threads');
    expect(under?.querySelector<HTMLElement>('.scroller')?.scrollTop).toBe(85);
    scene!.cleanup(false);
  });

  it('rejects Space All threads capture without returnToSpaceThreads or across sessions, and clears stale roomPreview', async () => {
    const pageMock = browser();
    const { stage, page } = makeStage('Room Overview');
    const slideIntoThread = async (
      label: string,
      departing: Parameters<typeof setActivePhoneSwipeContext>[0],
      returnToSpaceThreads?: boolean
    ) => {
      showThread(false);
      page.textContent = label;
      setActivePhoneSwipeContext(departing);
      slidePhonePage(() => {
        showThread(true);
        setActivePhoneSwipeContext({
          sessionId: SESSION,
          roomId: ROOM,
          threadId: THREAD,
          ...(returnToSpaceThreads ? { returnToSpaceThreads: true } : {}),
        });
        page.textContent = 'Thread View';
      });
      pageMock.frame();
      await pageMock.finish();
    };
    const expectBackdrop = (fromLocationKey: string) => {
      const scene = createThreadBackSwipeScene({
        key: { sessionId: SESSION, roomId: ROOM, threadId: THREAD },
        fromLocationKey,
        onCommit: vi.fn(),
        dirSign: 1,
      });
      expect(stage.querySelector('[data-swipe-preview="backdrop"]')).not.toBeNull();
      scene!.cleanup(false);
    };

    // Entering a thread from an overlay over Space All threads (no returnToSpaceThreads) must
    // neither capture Space All threads nor retain an earlier room preview.
    await slideIntoThread('Room Overview', { sessionId: SESSION, roomId: ROOM });
    await slideIntoThread('Space All Threads', {
      sessionId: SESSION,
      roomId: '!space:example.org',
      isSpaceThreads: true,
    });
    expectBackdrop('k-overlay');

    // Cross-session isSpaceThreads must never capture even with returnToSpaceThreads.
    await slideIntoThread('Room Overview Again', { sessionId: SESSION, roomId: ROOM });
    await slideIntoThread(
      'Other Account Space Threads',
      {
        sessionId: 'https://other.org::@bob:other.org',
        roomId: '!space:other.org',
        isSpaceThreads: true,
      },
      true
    );
    expectBackdrop('k-cross');

    // Entering from an unmatched surface without swipe context clears any stale roomPreview.
    await slideIntoThread('Room Overview Third', { sessionId: SESSION, roomId: ROOM });
    await slideIntoThread('Activity', undefined);
    expectBackdrop('k-activity');
  });

  const addCanvas = (parent: HTMLElement, width = 48, height = 32) => {
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    parent.append(canvas);
    return canvas;
  };
  const mockCanvas2d = () =>
    vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const expectDisposed = (el: HTMLElement, canvas: HTMLCanvasElement) =>
    expect([canvas.width, canvas.height, el.childElementCount]).toEqual([0, 0, 0]);
  const key = { sessionId: SESSION, roomId: ROOM, threadId: THREAD };
  const openScene = (
    create: typeof createThreadBackSwipeScene | typeof createThreadForwardSwipeScene,
    fromLocationKey = 'k-thread'
  ) => create({ key, fromLocationKey, onCommit: vi.fn(), dirSign: 1 })!;

  it('retains roomPreview canvas on cancel for retry and disposes on commit release or stale claim', async () => {
    const pageMock = browser();
    const ctxSpy = mockCanvas2d();
    try {
      const { stage, page } = makeStage('Room Overview', 145);
      addCanvas(page);
      capturePhoneSwipePreview('room', key);
      const { router, emit } = routerAt('k-thread');
      unsubscribes.push(withPhonePageSlide(router).subscribe(vi.fn()));

      const cancelled = openScene(createThreadBackSwipeScene);
      const under = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]')!;
      const canvas = under.querySelector('canvas')!;
      await cancelled.settle(false, 0, 120);
      cancelled.cleanup(false);
      expect([canvas.width, canvas.height]).toEqual([48, 32]);
      expect(under.childElementCount).toBeGreaterThan(0);

      const cancelAnim = vi.fn();
      under.getAnimations = vi.fn(() => [{ cancel: cancelAnim } as unknown as Animation]);
      const retry = openScene(createThreadBackSwipeScene);
      expect(stage.querySelector('[data-swipe-preview="under"]')).toBe(under);
      await retry.settle(true, 0, 260);
      retry.commit();
      retry.cleanup(true);
      expect([canvas.width, canvas.height]).toEqual([48, 32]);
      emit(stateAt('k-room', 'POP'));
      pageMock.frame();
      expect(cancelAnim).toHaveBeenCalledOnce();
      expectDisposed(under, canvas);

      const stale = captureStageSnapshot(stage);
      const staleCanvas = stale.copy.querySelector('canvas')!;
      claimInteractivePhoneSlide({
        fromLocationKey: 'k-stale',
        holdElement: stale.copy,
        holdSnapshot: stale,
      });
      expectDisposed(stale.copy, staleCanvas);
      expect(stale.scrolled).toHaveLength(0);
    } finally {
      ctxSpy.mockRestore();
    }
  });

  it('disposes evicted previews on replace, resize, and clear, deferring disposal while mounted', () => {
    const ctxSpy = mockCanvas2d();
    const { stage, page } = makeStage('Room Overview');
    addCanvas(page);
    const origWidth = window.innerWidth;
    const mountCaptured = () => {
      capturePhoneSwipePreview('room', key);
      const scene = openScene(createThreadBackSwipeScene, 'k1');
      const el = stage.querySelector<HTMLElement>('[data-swipe-preview="under"]')!;
      return { scene, el, canvas: el.querySelector('canvas')! };
    };
    try {
      const a = mountCaptured();
      a.scene.cleanup(false);
      capturePhoneSwipePreview('room', key);
      expectDisposed(a.el, a.canvas);

      const b = mountCaptured();
      b.scene.cleanup(false);
      Object.defineProperty(window, 'innerWidth', { value: origWidth + 100, configurable: true });
      window.dispatchEvent(new Event('resize'));
      expectDisposed(b.el, b.canvas);

      const c = mountCaptured();
      c.scene.cleanup(false);
      clearPhoneSwipePreviews();
      expectDisposed(c.el, c.canvas);

      const d = mountCaptured();
      clearPhoneSwipePreviews();
      expect([d.canvas.width, d.canvas.height]).toEqual([48, 32]);
      expect(d.el.childElementCount).toBeGreaterThan(0);
      d.scene.cleanup(false);
      expectDisposed(d.el, d.canvas);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
      ctxSpy.mockRestore();
    }
  });

  it('settles matched snapshots via CSS translate transition without WAAPI .animate(), snapping on 0ms/reduced motion', async () => {
    const pageMock = browser();
    const { stage } = makeStage('Snapshot View');
    const { router, emit } = routerAt('k-0');
    unsubscribes.push(withPhonePageSlide(router).subscribe(vi.fn()));

    const animated: HTMLElement[] = [];
    const finishers: Array<() => void> = [];
    const origAnimate = HTMLElement.prototype.animate;
    const origMatchMedia = window.matchMedia;
    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement) {
      animated.push(this);
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((r) => {
        finish = r;
      });
      finishers.push(finish);
      return { finished, cancel: vi.fn() } as unknown as Animation;
    });
    const finishAll = async (p: Promise<void>) => {
      finishers.splice(0).forEach((fn) => fn());
      await p;
    };

    try {
      const fallback = openScene(createThreadBackSwipeScene, 'k-0');
      const backdrop = stage.querySelector<HTMLElement>('[data-swipe-preview="backdrop"]')!;
      await finishAll(fallback.settle(false, 200, 130));
      expect(animated).toContain(backdrop);
      fallback.cleanup(false);

      for (const [kind, selector, create, from, to] of [
        ['room', '[data-swipe-preview="under"]', createThreadBackSwipeScene, 'k-0', 'k-1'],
        ['thread', '[data-swipe-preview="over"]', createThreadForwardSwipeScene, 'k-1', 'k-2'],
      ] as const) {
        capturePhoneSwipePreview(kind, key);

        animated.length = 0;
        const scene = openScene(create, from);
        const clone = stage.querySelector<HTMLElement>(selector)!;
        const settling = scene.settle(false, 200, 130);
        expect(animated).not.toContain(clone);
        expect(animated.length).toBeGreaterThan(0);
        expect(clone.hasAttribute('data-swiping')).toBe(false);
        expect(clone.style.transition).toBe('translate 200ms cubic-bezier(0.2, 0, 0, 1)');
        await finishAll(settling);
        expect(clone.style.transition).toBe('');
        scene.cleanup(false);

        const aborted = openScene(create, from);
        const abortClone = stage.querySelector<HTMLElement>(selector)!;
        const abortSettle = aborted.settle(false, 200, 130);
        aborted.cleanup(false);
        expect(abortClone.style.transition).toBe('');
        await finishAll(abortSettle);

        const zero = openScene(create, from);
        const zeroClone = stage.querySelector<HTMLElement>(selector)!;
        await zero.settle(true, 0, 260);
        expect([zeroClone.style.transition, zeroClone.style.translate]).toEqual(['', '0px']);
        zero.cleanup(false);

        window.matchMedia = ((q: string) => ({
          matches: q.includes('reduce'),
        })) as typeof window.matchMedia;
        const reduced = openScene(create, from);
        const reducedClone = stage.querySelector<HTMLElement>(selector)!;
        await reduced.settle(true, 200, 260);
        expect([reducedClone.style.transition, reducedClone.style.translate]).toEqual(['', '0px']);
        reduced.cleanup(false);
        window.matchMedia = origMatchMedia;

        animated.length = 0;
        const committed = openScene(create, from);
        const commitClone = stage.querySelector<HTMLElement>(selector)!;
        const commitSettle = committed.settle(true, 200, 260);
        expect(animated).not.toContain(commitClone);
        await finishAll(commitSettle);
        committed.commit();
        committed.cleanup(true);
        expect(commitClone.style.transition).toBe('');
        emit(stateAt(to, 'POP'));
        pageMock.frame();
      }
    } finally {
      window.matchMedia = origMatchMedia;
      HTMLElement.prototype.animate = origAnimate;
    }
  });

  it('disposes non-retained slidePhonePage snapshots on completion, early exit, and error while keeping retained previews', async () => {
    const pageMock = browser();
    const ctxSpy = mockCanvas2d();
    const { page } = makeStage('Room');
    addCanvas(page, 64, 48);
    const origAdopt = document.adoptNode.bind(document);
    let last!: { copy: HTMLElement; canvas: HTMLCanvasElement };
    const adoptSpy = vi.spyOn(document, 'adoptNode').mockImplementation((node) => {
      const adopted = origAdopt(node);
      if (adopted instanceof HTMLElement && adopted.querySelector('canvas')) {
        last = { copy: adopted, canvas: adopted.querySelector('canvas')! };
      }
      return adopted;
    });
    const slideRetained = () => {
      showThread(false);
      setActivePhoneSwipeContext({ sessionId: SESSION, roomId: ROOM });
      slidePhonePage(() => {
        showThread(true);
        setActivePhoneSwipeContext(key);
      });
      pageMock.frame();
      return last;
    };
    try {
      slidePhonePage(() => showThread(true));
      pageMock.frame();
      const nonRetained = last;
      await pageMock.finish();
      expectDisposed(nonRetained.copy, nonRetained.canvas);

      slidePhonePage(() => undefined);
      pageMock.frame();
      expectDisposed(last.copy, last.canvas);

      slidePhonePage(() => {
        throw new Error('boom');
      });
      expect(() => pageMock.frame()).toThrow('boom');
      expectDisposed(last.copy, last.canvas);

      const retained = slideRetained();
      await pageMock.finish();
      expect([retained.canvas.width, retained.canvas.height]).toEqual([64, 48]);
      expect(retained.copy.childElementCount).toBeGreaterThan(0);

      const evictedMidSlide = slideRetained();
      clearPhoneSwipePreviews();
      expect([evictedMidSlide.canvas.width, evictedMidSlide.canvas.height]).toEqual([64, 48]);
      await pageMock.finish();
      expectDisposed(evictedMidSlide.copy, evictedMidSlide.canvas);
    } finally {
      adoptSpy.mockRestore();
      ctxSpy.mockRestore();
    }
  });
});
