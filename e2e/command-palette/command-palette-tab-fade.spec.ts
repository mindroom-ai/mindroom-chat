import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// On a phone the palette's tab row is wider than the screen and scrolls sideways. It fades out
// at each edge it has more tabs beyond: the end at first, both edges in the middle, the start at
// the end. In Arabic the row and its fades are mirrored. Phone 390 by 844 with touch, Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit; a desktop row that
// fits shows no fade. Set COMMAND_PALETTE_TAB_FADE_SHOTS=<directory> for screenshots.
const PASSWORD = 'command-palette-tab-fade-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.COMMAND_PALETTE_TAB_FADE_SHOTS;
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

let seeded: Promise<string> | undefined;

const seed = async (): Promise<string> => {
  const username = `ctf_${RUN}`;
  const { access_token: token } = await matrixFetch<{ access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  for (const name of ['Harbor Plans', 'Garden Club', 'Release Planning']) {
    await createPrivateRoom(HOMESERVER, token, { name, topic: 'Weekly notes and decisions' });
  }
  return username;
};

const openPalette = async (browser: Browser, options: BrowserContextOptions, language?: string) => {
  seeded ??= seed();
  const username = await seeded;
  const context = await browser.newContext(options);
  // A missing control fails its step quickly instead of the whole test's timeout.
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  if (language) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  }
  // The shell listens for the shortcut once the navigation is up.
  await expect(page.getByTestId('resizable-page-nav')).toBeVisible({ timeout: 30_000 });
  await pressPaletteShortcut(page);
  const tablist = page.getByRole('dialog').getByRole('tablist');
  await expect(tablist).toBeVisible();
  return { context, page, tablist };
};

type Fade = { start: boolean; end: boolean };

/**
 * Which edges of the row fade, in reading order: the row says where it has more to show, and
 * paints a sideways mask that runs from the line's start (left to right, in Arabic right to
 * left). A row with nothing beyond its edges paints no mask.
 */
const fades = (tablist: Locator): Promise<Fade | string> =>
  tablist.evaluate((element) => {
    const style = getComputedStyle(element);
    const mask = style.maskImage || style.getPropertyValue('-webkit-mask-image') || 'none';
    const fade = {
      start: element.hasAttribute('data-more-start'),
      end: element.hasAttribute('data-more-end'),
    };
    if (!fade.start && !fade.end) return mask === 'none' ? fade : `unexpected mask ${mask}`;
    const side = style.direction === 'rtl' ? 'left' : 'right';
    return new RegExp(`linear-gradient\\(\\s*to ${side}`).test(mask)
      ? fade
      : `mask ${mask} does not run to the ${side}`;
  });

/** Scrolls the row to a fraction of the way toward its end, in reading order. */
const scrollTo = (tablist: Locator, fraction: number) =>
  tablist.evaluate((element, share) => {
    const range = element.scrollWidth - element.clientWidth;
    const sign = getComputedStyle(element).direction === 'rtl' ? -1 : 1;
    element.scrollLeft = sign * range * share;
  }, fraction);

const checkPhone = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, tablist } = await openPalette(browser, PHONE, language);
  const overflow = await tablist.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeGreaterThan(0);
  const shot = async (name: string) => {
    if (SHOTS) {
      await page.screenshot({
        path: `${SHOTS}/tab-fade-${engine}-${language ?? 'en'}-${name}.png`,
      });
    }
  };

  await expect.poll(() => fades(tablist)).toEqual({ start: false, end: true });
  await shot('start');
  await scrollTo(tablist, 0.5);
  await expect.poll(() => fades(tablist)).toEqual({ start: true, end: true });
  await shot('middle');
  await scrollTo(tablist, 1);
  await expect.poll(() => fades(tablist)).toEqual({ start: true, end: false });
  await shot('end');
  await context.close();
};

const checkDesktop = async (browser: Browser) => {
  const { context, tablist } = await openPalette(browser, DESKTOP);
  expect(await tablist.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
  await expect.poll(() => fades(tablist)).toEqual({ start: false, end: false });
  await context.close();
};

const inWebKit = async (check: (browser: Browser) => Promise<void>) => {
  const browser = await launchWebKit();
  try {
    await check(browser);
  } finally {
    await browser.close();
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(120_000);
});

test('on a phone the tab row fades at the edges it scrolls toward', async ({ browser }) => {
  await checkPhone(browser, 'chromium');
});

test('in Arabic the fades are mirrored', async ({ browser }) => {
  await checkPhone(browser, 'chromium', 'ar');
});

test('a row that fits shows no fade', async ({ browser }) => {
  await checkDesktop(browser);
});

test.describe('WebKit', () => {
  test.beforeEach(() => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  });
  test('the fades on a phone', () => inWebKit((browser) => checkPhone(browser, 'webkit')));
  test('the fades in Arabic', () => inWebKit((browser) => checkPhone(browser, 'webkit', 'ar')));
});
