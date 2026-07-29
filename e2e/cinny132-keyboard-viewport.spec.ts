import { expect, test } from '@playwright/test';

/**
 * CINNY-132 geometry lock, measured by a real layout engine.
 *
 * `src/app/hooks/mobileKeyboardViewportGeometry.test.ts` proves the same
 * invariant in jsdom, but jsdom does no layout: it cannot substitute `var()`,
 * cannot resolve `dvh`, and returns an all-zero `getBoundingClientRect()`. That
 * test therefore has to model the box arithmetic itself. This one does not —
 * Chromium parses the shipped stylesheet, resolves the custom properties the
 * real hook publishes, and reports where the boxes actually landed.
 *
 * What is still faked here, because no desktop browser will do it: the iOS pan
 * itself. `window.visualViewport` is replaced before any app script runs with an
 * object whose `height` and `offsetTop` we drive, and the pan dispatches only
 * `scroll` — never `resize` — because that is what WebKit does when it slides
 * the visual viewport over an unchanged layout viewport. A test that dispatched
 * `resize` would also pass against the pre-fix code.
 *
 * What no CI on Linux can cover: that WebKit reports the offset we assume it
 * does. That needs a physical iOS device.
 */

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

/** iPhone-ish layout viewport. iOS never shrinks this for the keyboard. */
const LAYOUT_VIEWPORT_HEIGHT = 793;
const LAYOUT_VIEWPORT_WIDTH = 390;
/** What is left on screen once the keyboard is up. */
const KEYBOARD_VISUAL_HEIGHT = 457;
/** How far WebKit panned the visual viewport down to reveal the composer. */
const KEYBOARD_PAN_OFFSET = 170;

const VISIBLE_BOTTOM = KEYBOARD_PAN_OFFSET + KEYBOARD_VISUAL_HEIGHT;

type MeasuredBox = {
  position: string;
  top: number;
  height: number;
  bottom: number;
};

declare global {
  interface Window {
    __cinny132Viewport?: {
      pan: (height: number, offsetTop: number) => void;
      resize: (height: number, offsetTop: number) => void;
    };
  }
}

test.use({
  userAgent: IOS_USER_AGENT,
  viewport: { width: LAYOUT_VIEWPORT_WIDTH, height: LAYOUT_VIEWPORT_HEIGHT },
  // This suite asserts numbers, not pixels; a failure is readable from the
  // assertion alone. Video needs a Playwright-bundled ffmpeg that the Nix
  // chromium the rest of the config points at does not ship.
  video: 'off',
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let height: number | null = null;
    let offsetTop = 0;
    const events = new EventTarget();

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: (...args: Parameters<EventTarget['addEventListener']>) =>
          events.addEventListener(...args),
        removeEventListener: (...args: Parameters<EventTarget['removeEventListener']>) =>
          events.removeEventListener(...args),
        dispatchEvent: (event: Event) => events.dispatchEvent(event),
        get width() {
          return window.innerWidth;
        },
        get height() {
          return height ?? window.innerHeight;
        },
        get offsetLeft() {
          return 0;
        },
        get offsetTop() {
          return offsetTop;
        },
        get pageLeft() {
          return window.scrollX;
        },
        get pageTop() {
          return window.scrollY + offsetTop;
        },
        get scale() {
          return 1;
        },
      },
    });

    const apply = (nextHeight: number, nextOffsetTop: number, eventName: string) => {
      height = nextHeight;
      offsetTop = nextOffsetTop;
      events.dispatchEvent(new Event(eventName));
    };

    window.__cinny132Viewport = {
      // WebKit pans without resizing anything, so `scroll` is the only signal.
      pan: (nextHeight, nextOffsetTop) => apply(nextHeight, nextOffsetTop, 'scroll'),
      resize: (nextHeight, nextOffsetTop) => apply(nextHeight, nextOffsetTop, 'resize'),
    };
  });
});

const readBox = (page: import('@playwright/test').Page, selector: string): Promise<MeasuredBox> =>
  page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`No element matched ${target}`);

    const rect = element.getBoundingClientRect();
    return {
      position: window.getComputedStyle(element).position,
      top: rect.top,
      height: rect.height,
      bottom: rect.bottom,
    };
  }, selector);

const waitForPublishedHeight = async (
  page: import('@playwright/test').Page,
  expected: string
): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(expected);
};

test('keeps the shell and the portal host inside the visible window after a scroll-only pan', async ({
  page,
}) => {
  await page.goto('/');
  await waitForPublishedHeight(page, `${LAYOUT_VIEWPORT_HEIGHT}px`);

  await page.evaluate(
    ([height, offsetTop]) => window.__cinny132Viewport?.pan(height, offsetTop),
    [KEYBOARD_VISUAL_HEIGHT, KEYBOARD_PAN_OFFSET]
  );
  await waitForPublishedHeight(page, `${KEYBOARD_VISUAL_HEIGHT}px`);

  // Guard the premise: the layout viewport really is taller than the screen, so
  // a box anchored to it would hang below the keyboard.
  expect(VISIBLE_BOTTOM).toBeLessThan(LAYOUT_VIEWPORT_HEIGHT);
  expect(await page.evaluate(() => window.innerHeight)).toBe(LAYOUT_VIEWPORT_HEIGHT);

  const rootBox = await readBox(page, '#root');
  const portalBox = await readBox(page, '#portalContainer');

  for (const box of [rootBox, portalBox]) {
    expect(box.position).toBe('fixed');
    expect(box.top).toBeCloseTo(KEYBOARD_PAN_OFFSET, 1);
    expect(box.height).toBeCloseTo(KEYBOARD_VISUAL_HEIGHT, 1);
    // Neither host may extend past the keyboard, in either direction.
    expect(box.bottom).toBeCloseTo(VISIBLE_BOTTOM, 1);
  }
});

test('reproduces the pre-fix box on native iOS, where the WebView resizes instead of panning', async ({
  page,
}) => {
  await page.goto('/');
  await waitForPublishedHeight(page, `${LAYOUT_VIEWPORT_HEIGHT}px`);

  // Capacitor sets `Keyboard.resize: 'native'`, so the visual viewport equals
  // the layout viewport and there is no pan to follow.
  await page.evaluate(
    ([height, offsetTop]) => window.__cinny132Viewport?.resize(height, offsetTop),
    [LAYOUT_VIEWPORT_HEIGHT, 0]
  );

  // The hook runs on native iOS too, so these are published pixel values rather
  // than the CSS fallbacks — the identity is arithmetic, not absence.
  await waitForPublishedHeight(page, `${LAYOUT_VIEWPORT_HEIGHT}px`);
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--app-viewport-offset-top')
    )
  ).toBe('0px');

  const rootBox = await readBox(page, '#root');
  const portalBox = await readBox(page, '#portalContainer');

  for (const box of [rootBox, portalBox]) {
    expect(box.top).toBeCloseTo(0, 1);
    expect(box.height).toBeCloseTo(LAYOUT_VIEWPORT_HEIGHT, 1);
  }
});
