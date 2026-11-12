import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A message's More Options menu and reaction picker open above its toolbar when the message is
// in the lower half of the window, the place of the newest messages, instead of beside it over
// the member list or past the window's edge; one taller than the room on its side scrolls there,
// below a phone's status bar. Each case runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'menu-placement-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MESSAGE_MENU_SHOTS;

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

const register = async (name: string) => {
  const username = `mmp_${name}_${RUN}`;
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
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

type Box = { top: number; bottom: number; left: number; right: number };

const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });

/** The pop-out around `item`: the nearest ancestor that is fixed in the window. */
const popOutOf = (item: Locator): Promise<Box> =>
  item.evaluate((element) => {
    let node: HTMLElement | null = element as HTMLElement;
    while (node && getComputedStyle(node).position !== 'fixed') node = node.parentElement;
    if (!node) throw new Error('No pop-out around the item');
    const { top, bottom, left, right } = node.getBoundingClientRect();
    return { top, bottom, left, right };
  });

/** The room view: the timeline's scroll area, between the room list and the member list. */
const timelineBox = (page: Page): Promise<Box> =>
  page.evaluate(() => {
    let element = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Timeline scroller missing');
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });

const menusOpenAbove = async (
  page: Page,
  name: string,
  viewport: { width: number; height: number },
  // The status bar's height on a phone that draws under it (env(safe-area-inset-top)).
  safeTop = 0
) => {
  const reader = await register(name);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Dock schedule ${name} ${RUN}`,
  });
  let newest = '';
  for (let index = 1; index <= 25; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    newest = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Dock ${index}: the crane crew starts at seven and the tug is booked for noon.`,
    });
  }
  await page.setViewportSize(viewport);
  if (safeTop) {
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: safeTop } });
  }
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const row = page.locator(`[data-message-id="${newest}"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const timeline = await timelineBox(page);

  const openFromToolbar = async (label: string) => {
    await row.hover();
    const button = row.getByRole('button', { name: label });
    await expect(button).toBeVisible();
    const toolbar = await boxOf(button);
    await button.click();
    return toolbar;
  };

  // More Options.
  const toolbar = await openFromToolbar('More Options');
  const copyLink = page.getByRole('menuitem', { name: 'Copy Link' });
  await expect(copyLink).toBeVisible();
  const menu = await popOutOf(copyLink);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-${name}.png` });
  expect(menu.bottom, 'the menu ends above the toolbar').toBeLessThanOrEqual(toolbar.top + 1);
  expect(menu.right, 'the menu stays in the room view').toBeLessThanOrEqual(timeline.right + 1);
  expect(menu.left).toBeGreaterThanOrEqual(timeline.left - 1);
  expect(menu.top, 'the menu stays below the status bar').toBeGreaterThanOrEqual(safeTop);
  // A wheel over the menu brings its last entry into view inside it: the entries neither spill
  // past the menu nor stay clipped.
  const last = page.getByRole('menu').getByRole('menuitem').last();
  await page.mouse.move((menu.left + menu.right) / 2, (menu.top + menu.bottom) / 2);
  await page.mouse.wheel(0, 2_000);
  await expect
    .poll(async () => (await boxOf(last)).bottom, { message: 'the last entry shows in the menu' })
    .toBeLessThanOrEqual(menu.bottom);
  expect((await boxOf(last)).top).toBeGreaterThanOrEqual(menu.top);
  await page.keyboard.press('Escape');
  await expect(copyLink).toBeHidden();

  // The reaction picker.
  const reactionToolbar = await openFromToolbar('Add Reaction');
  // The picker's own field: the members panel beside the room has a search field too.
  const search = page.getByRole('textbox', { name: 'Search or Text Reaction', exact: true });
  await expect(search).toBeVisible();
  const board = await popOutOf(search);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/emoji-${name}.png` });
  expect(board.bottom, 'the picker ends above the toolbar').toBeLessThanOrEqual(
    reactionToolbar.top + 1
  );
  expect(board.right, 'the picker stays in the window').toBeLessThanOrEqual(viewport.width + 1);
  expect(board.left).toBeGreaterThanOrEqual(-1);
  expect(board.top, 'the picker stays below the status bar').toBeGreaterThanOrEqual(safeTop);
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();

  // A right click on a message just above the middle of the window opens the menu below the
  // pointer, in the window, even where the menu is taller than the room below.
  const point = { x: timeline.right - 30, y: viewport.height / 2 - 10 };
  const onMessage = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-message-id]'),
    point
  );
  expect(onMessage, 'a message lies under the pointer').toBe(true);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(copyLink).toBeVisible();
  const below = await popOutOf(copyLink);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu-below-${name}.png` });
  expect(below.top, 'the menu starts below the pointer').toBeGreaterThanOrEqual(point.y);
  expect(below.bottom, 'the menu ends in the window').toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press('Escape');
  await expect(copyLink).toBeHidden();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const DESKTOP = { width: 1280, height: 800 };
const TITLE = 'the newest message opens its menu and reaction picker above its toolbar';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await menusOpenAbove(page, 'c', DESKTOP);
});

// A phone with its keyboard out, as an iPhone 16 leaves the app (393 by 546) under a status bar
// that the page reaches beneath: neither menu fits above the toolbar or below it, and they stay
// clear of the status bar rather than climb beside the toolbar under it.
test(`${TITLE} (Chromium, phone with the keyboard out)`, async ({ page }) => {
  test.setTimeout(180_000);
  await menusOpenAbove(page, 'p', { width: 393, height: 546 }, 59);
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    await menusOpenAbove(await context.newPage(), 'w', DESKTOP);
  } finally {
    await browser.close();
  }
});
