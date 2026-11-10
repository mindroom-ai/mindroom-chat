import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { buildLoginPath } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';

// iOS Safari zooms the page into a text field whose text is smaller than 16 px when the field
// takes the focus, and leaves the page zoomed. The app's fields wrote at 15 px, so on an iPhone
// signing in or searching zoomed the whole app. On a phone (390 by 844, touch) every text field
// writes at 16 px or more: the sign-in fields and the invite dialog's search. At a smaller Page Zoom
// the fields shrink with the page, as the composer does. A desktop keeps the fields' own size.
// Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit. Set TEXT_FIELD_SHOTS=<directory> to save the screens.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'touch-text-field-size-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.TEXT_FIELD_SHOTS;
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const ROOM = 'Design studio';

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** A reader with a room to invite into. */
const seed = async (engine: string) => {
  const username = `ttf_${engine}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await createRoom(HOMESERVER, session.accessToken, { name: ROOM });
  return username;
};

const fontSize = (field: Locator) =>
  field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/**
 * A page in a new context. Chromium on macOS now and then starts a touch context without its touch
 * emulation (a fine pointer that hovers); such a context is replaced, twice at most.
 */
const newPage = async (browser: Browser, options: BrowserContextOptions) => {
  for (let attempt = 1; ; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext(options);
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    const coarse = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
    // eslint-disable-next-line no-await-in-loop
    if (!options.hasTouch || attempt === 3 || (await page.evaluate(coarse))) {
      return { context, page };
    }
    console.log(`context ${attempt} started without touch emulation; replacing it`);
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
};

const SIGN_IN_FIELDS = ['serverInput', 'usernameInput', 'passwordInput'];

/** The sign-in fields' sizes, then the invite search's, on a fresh page of `browser`. */
const sizes = async (
  browser: Browser,
  baseURL: string | undefined,
  options: BrowserContextOptions,
  username: string,
  name: string
) => {
  const { context, page } = await newPage(browser, { ...options, baseURL });
  try {
    await page.goto(buildLoginPath(HOMESERVER, false));
    const found: Record<string, number> = {};
    for (const field of SIGN_IN_FIELDS) {
      const input = page.locator(`input[name="${field}"]`);
      // eslint-disable-next-line no-await-in-loop
      await expect(input).toBeVisible({ timeout: 30_000 });
      // eslint-disable-next-line no-await-in-loop
      found[field] = await fontSize(input);
    }
    await shot(page, `${name}-sign-in`);
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    const entry = page.locator('a[href^="/home/"]').filter({ hasText: ROOM }).first();
    await expect(entry).toBeVisible({ timeout: 60_000 });
    await entry.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Invite', exact: true }).first().click();
    const search = page.getByRole('dialog', { name: 'Invite', exact: true }).getByRole('combobox');
    await expect(search).toBeVisible();
    found.inviteSearch = await fontSize(search);
    await shot(page, `${name}-invite`);
    console.log(`${name}: ${JSON.stringify(found)}`);
    return found;
  } finally {
    await context.close();
  }
};

/** The server field's size on a phone whose Page Zoom is 75 %. */
const zoomedSize = async (browser: Browser, baseURL: string | undefined) => {
  const { context, page } = await newPage(browser, { ...PHONE, baseURL });
  try {
    await page.addInitScript(() => {
      const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem('settings', JSON.stringify({ ...stored, pageZoom: 75 }));
    });
    await page.goto(buildLoginPath(HOMESERVER, false));
    const input = page.locator('input[name="serverInput"]');
    await expect(input).toBeVisible({ timeout: 30_000 });
    return await fontSize(input);
  } finally {
    await context.close();
  }
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const username = await seed(engine);
  const phone = await sizes(browser, baseURL, PHONE, username, `${engine}-phone`);
  for (const [field, size] of Object.entries(phone)) {
    expect
      .soft(size, `${engine}: ${field} writes at 16 px or more on a phone`)
      .toBeGreaterThanOrEqual(16);
  }
  const desktop = await sizes(browser, baseURL, DESKTOP, username, `${engine}-desktop`);
  // A desktop keeps the size the fields were designed with, smaller than the phone's.
  expect(desktop.serverInput, `${engine}: the desktop keeps its own size`).toBeLessThan(16);
  // 75 % of the 16 px root size.
  expect(await zoomedSize(browser, baseURL), `${engine}: fields follow Page Zoom`).toBe(12);
};

test('text fields on touch screens write at the root size (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await run(browser, baseURL, 'chromium');
});

test('text fields on touch screens write at the root size (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
