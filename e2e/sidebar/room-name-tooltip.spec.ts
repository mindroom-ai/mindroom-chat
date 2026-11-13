import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A room row whose name is cut off shows the whole name in a tooltip while a mouse rests on it,
// as the rail's space buttons do. A tap on a touch screen opens the room and shows no tooltip.
// 26 rooms in Home, three with long names, on a desktop (1280 by 800, classic scrollbars), a
// touch tablet and a phone (390 by 844), in English and Arabic, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// ROOM_NAME_TOOLTIP_SHOTS=<directory> for screenshots.
const PASSWORD = 'room-name-tooltip-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.ROOM_NAME_TOOLTIP_SHOTS;
const LONG = 'Weekly sync with the platform infrastructure reliability working group';
const LONG_ROOMS = [
  LONG,
  'Quarterly planning for the customer onboarding experience redesign',
  'Notes from the design review of the new billing and invoicing flow',
];
const OTHER_ROOMS = [
  'Book Swap',
  ...Array.from({ length: 22 }, (_, index) => `Team room ${index + 1}`),
];
// Beside the long name in the A to Z list, so it is rendered while that row is in view.
const SHORT = 'Team room 22';
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const TABLET: BrowserContextOptions = {
  viewport: { width: 1024, height: 768 },
  hasTouch: true,
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
let seeded: Promise<string> | undefined;

const seed = async (): Promise<string> => {
  const username = `rnt_${RUN}`;
  const { access_token: token } = await matrixFetch<{ access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  for (const name of [...LONG_ROOMS, ...OTHER_ROOMS]) {
    await createPrivateRoom(HOMESERVER, token, { name, topic: 'Weekly notes and decisions' });
  }
  return username;
};

const signIn = async (page: Page, language?: string) => {
  seeded ??= seed();
  const username = await seeded;
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
  await page.goto('/home/');
};

const list = (page: Page) => page.getByTestId('resizable-page-nav');
const row = (page: Page, name: string) => list(page).getByRole('link', { name });
const tooltip = (page: Page) => page.getByRole('tooltip');

/** Whether the row's name is cut off, as the reader sees it. */
const cutOff = (page: Page, name: string) =>
  row(page, name)
    .getByText(name, { exact: true })
    .evaluate((element) => element.scrollWidth > element.clientWidth + 1);

const hoverShowsFullName = async (page: Page, shot: string) => {
  const longRow = row(page, LONG);
  await expect(longRow).toBeVisible({ timeout: 30_000 });
  expect(await cutOff(page, LONG)).toBe(true);
  await longRow.hover();
  await expect(tooltip(page)).toHaveText(LONG);
  await expect(tooltip(page)).toBeInViewport({ ratio: 1 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png` });

  // The tooltip leaves with the pointer, and a name shown whole gets none.
  await page.mouse.move(640, 790);
  await expect(tooltip(page)).toHaveCount(0);
  expect(await cutOff(page, SHORT)).toBe(false);
  await row(page, SHORT).hover();
  await page.waitForTimeout(1_000);
  await expect(tooltip(page)).toHaveCount(0);
};

const checkDesktop = async (browser: Browser) => {
  const context = await browser.newContext(DESKTOP);
  // A missing control fails its step quickly instead of the whole test's timeout.
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  await signIn(page);
  await hoverShowsFullName(page, 'room-name-tooltip-desktop');
  // Toward the line's end: to the right of the row.
  await row(page, LONG).hover();
  await expect(tooltip(page)).toBeVisible();
  const rowBox = (await row(page, LONG).boundingBox())!;
  const tipBox = (await tooltip(page).boundingBox())!;
  expect(tipBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1);
  await context.close();
};

const checkRightToLeft = async (browser: Browser) => {
  const context = await browser.newContext(DESKTOP);
  // A missing control fails its step quickly instead of the whole test's timeout.
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  await signIn(page, 'ar');
  await hoverShowsFullName(page, 'room-name-tooltip-arabic');
  await row(page, LONG).hover();
  await expect(tooltip(page)).toBeVisible();
  // The English name reads left to right, and the tooltip opens toward the line's end, which is
  // to the left of the row in Arabic.
  const text = tooltip(page).getByText(LONG, { exact: true });
  expect(await text.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
  const rowBox = (await row(page, LONG).boundingBox())!;
  const tipBox = (await tooltip(page).boundingBox())!;
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(rowBox.x + 1);
  await context.close();
};

const checkTaps = async (browser: Browser) => {
  // A touch tablet keeps the list beside the room, so a tooltip would stay on screen.
  const tablet = await browser.newContext(TABLET);
  // A missing control fails its step quickly instead of the whole test's timeout.
  tablet.setDefaultTimeout(30_000);
  const page = await tablet.newPage();
  await signIn(page);
  await expect(row(page, LONG)).toBeVisible({ timeout: 30_000 });
  expect(await cutOff(page, LONG)).toBe(true);
  await row(page, LONG).tap();
  await expect(page).toHaveURL(/\/home\/.+/);
  await expect(row(page, LONG)).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(tooltip(page)).toHaveCount(0);
  await tablet.close();

  const phone = await browser.newContext(PHONE);
  // A missing control fails its step quickly instead of the whole test's timeout.
  phone.setDefaultTimeout(30_000);
  const phonePage = await phone.newPage();
  await signIn(phonePage);
  await expect(row(phonePage, LONG)).toBeVisible({ timeout: 30_000 });
  await row(phonePage, LONG).tap();
  await expect(phonePage.getByRole('button', { name: 'Back' })).toBeVisible();
  await phonePage.waitForTimeout(1_000);
  await expect(tooltip(phonePage)).toHaveCount(0);
  await phone.close();
};

const inWebKit = async (check: (browser: Browser) => Promise<void>) => {
  const browser = await launchWebKit();
  try {
    await check(browser);
  } finally {
    await browser.close();
  }
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

test('a cut-off room name shows in full while the mouse rests on its row', async ({ browser }) => {
  await checkDesktop(browser);
});

test('in Arabic the tooltip opens toward the line end and keeps the name left to right', async ({
  browser,
}) => {
  await checkRightToLeft(browser);
});

test('a tap on a touch screen shows no tooltip', async ({ browser }) => {
  await checkTaps(browser);
});

test.describe('WebKit', () => {
  test.beforeEach(() => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  });
  test('the tooltip on hover', () => inWebKit(checkDesktop));
  test('the tooltip in Arabic', () => inWebKit(checkRightToLeft));
  test('no tooltip on a tap', () => inWebKit(checkTaps));
});
