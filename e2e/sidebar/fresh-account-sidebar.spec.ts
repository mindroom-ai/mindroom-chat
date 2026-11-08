import {
  expect,
  test,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { activeAccountButton, chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, sendRoomMessage, setAccountData } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A fresh account's sidebar (Bas, 2026-11-06): the six rail buttons a person can hide in
// Settings > Sidebar (Threads, Canvases, Explore Community, Create Space, Search, Local MindRoom)
// are off until the account turns them on, and the THREADS category starts collapsed until the
// person opens it. Each hidden page stays reachable the way its switch's description says:
// Threads, Canvases (once the account has a canvas, as for its button), Explore Community, Create
// Space and Search from Home's options menu, Create Space and Search from the command palette and
// its shortcut too, Local MindRoom in Settings. Checked with 26 rooms and three threads, classic scrollbars, on a 1280 by 800 desktop
// and a 390 by 844 touch phone, in Chromium and WebKit. Set SIDEBAR_DEFAULTS_SHOTS=<directory>
// to save the fresh sidebar's screenshots.

const PASSWORD = 'fresh-account-sidebar-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.SIDEBAR_DEFAULTS_SHOTS;
// The deployment's settings come from a routed config.json, which a service worker would answer
// itself after a reload (WebKit).
const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  serviceWorkers: 'block',
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
};
type Layout = 'desktop' | 'phone';
const LAYOUTS: Record<Layout, BrowserContextOptions> = { desktop: DESKTOP, phone: PHONE };

const FIRST_ROOM = 'Budget Review';
const ROOM_NAMES = [
  FIRST_ROOM,
  'Design Critique',
  'Field Notes',
  'Hiring Loop',
  'Incident Review',
  'Launch Checklist',
  'Market Research',
  'Office Logistics',
  'Onboarding',
  'Partner Updates',
  'Press Kit',
  'Quarterly Goals',
  'Release Train',
  'Research Digest',
  'Roadmap',
  'Sales Pipeline',
  'Security Review',
  'Support Escalations',
  'Team Retro',
  'Travel Planning',
  'User Interviews',
  'Vendor Contracts',
  'Weekly Sync',
  'Writing Desk',
  'Yearly Planning',
  'Zoning Permits',
];
const FIRST_THREAD = 'Shortlist for the venue';
const THREAD_TITLES = [
  FIRST_THREAD,
  'Draft agenda for Thursday',
  'Questions from the partner call',
];

/** The six switches, by the rail button each one shows. */
const RAIL_BUTTONS = [
  'Threads',
  'Canvases',
  'Explore Community',
  'Create Space',
  'Open command palette',
  'MindRoom',
];
const THREADS_SWITCH = 'Show Threads in the sidebar';
const SWITCHES = [
  THREADS_SWITCH,
  'Show Canvases in the sidebar',
  'Show Explore Community in the sidebar',
  'Show Create Space in the sidebar',
  'Show Search in the sidebar',
  'Show Local MindRoom in the sidebar',
];

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type Seeded = DisposableUser & { firstRoom: string };

/** Pins a canvas in the account's first room, which gives the Canvases button something to list. */
const pinCanvas = (user: Seeded) =>
  setAccountData(HOMESERVER, user.accessToken, user.userId, 'io.mindroom.pinned_canvases', {
    canvases: [{ room_id: user.firstRoom, event_id: '$fresh-account-canvas' }],
  });

/**
 * A new account with 26 rooms and three threads in the first one, with a pinned canvas unless
 * `canvas` is false; `settings` is stored as its `io.mindroom.settings`.
 */
const seedAccount = async (
  name: string,
  { settings, canvas = true }: { settings?: Record<string, boolean>; canvas?: boolean } = {}
): Promise<Seeded> => {
  const user = await registerDisposableUser(`fresh_${name}_${RUN}`, PASSWORD);
  const rooms: string[] = [];
  for (let start = 0; start < ROOM_NAMES.length; start += 6) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(
      ROOM_NAMES.slice(start, start + 6).map((roomName) =>
        createPrivateRoom(HOMESERVER, user.accessToken, { name: roomName, topic: '' })
      )
    );
    rooms.push(...batch);
  }
  const [threadRoom] = rooms;
  if (!threadRoom) throw new Error('No room was created');
  for (const title of THREAD_TITLES) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, user.accessToken, threadRoom, {
      msgtype: 'm.text',
      body: title,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, user.accessToken, threadRoom, {
      msgtype: 'm.text',
      body: `Notes on ${title.toLowerCase()} are in the shared folder.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  const seeded = { ...user, firstRoom: threadRoom };
  if (canvas) await pinCanvas(seeded);
  if (settings) {
    await setAccountData(
      HOMESERVER,
      user.accessToken,
      user.userId,
      'io.mindroom.settings',
      settings
    );
  }
  return seeded;
};

/** The deployment offers canvases and Local MindRoom; the slot has no provisioning service. */
const routeDeployment = async (context: BrowserContext) => {
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        // Local MindRoom pairs only accounts on the provisioning service's own homeserver.
        sidebar: { ...config.sidebar, mindRoomProvisioningUrl: HOMESERVER },
        mindroom: { ...config.mindroom, canvas: { enabled: true } },
      },
    });
  });
  await context.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const threadsCategory = (page: Page) =>
  page.getByTestId('thread-nav-category').getByRole('button', { name: 'Threads', exact: true });

/** Home with every seeded room listed. */
const openHome = async (page: Page) => {
  // Pressing Home while Home shows folds a desktop's list away instead.
  if (new URL(page.url()).pathname !== '/home/') {
    // A phone keeps the rail in its navigation drawer.
    const menu = page.locator('#phone-nav-menu-button');
    if ((await menu.count()) > 0 && (await menu.getAttribute('aria-expanded')) !== 'true') {
      await menu.click();
    }
    await rail(page).getByRole('button', { name: 'Home', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/home\/$/);
  await expect(page.getByText(FIRST_ROOM, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
};

const signIn = async (page: Page, user: DisposableUser) => {
  // A step that cannot happen fails on its own, not at the end of the whole test.
  page.setDefaultTimeout(90_000);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: user.username,
    password: PASSWORD,
  });
  await expect(activeAccountButton(page)).toBeVisible({
    timeout: 120_000,
  });
  await openHome(page);
};

const homeMenuEntry = (page: Page, entry: string) =>
  page.getByRole('menu').getByRole('menuitem', { name: entry, exact: true });

/** Chooses an entry of Home's options menu. */
const chooseFromHomeMenu = async (page: Page, entry: string) => {
  await page.getByRole('button', { name: 'Home Options', exact: true }).click();
  await homeMenuEntry(page, entry).click();
};

/** Opens Settings at one of its pages. */
const openSettingsPage = async (page: Page, name: string) => {
  await chooseFromAccountMenu(page, 'Settings');
  await page.getByRole('button', { name, exact: true }).click();
};

/**
 * Everything a fresh account should find, on one signed-in page. The account has no canvas until
 * this pins one.
 */
const checkFreshAccount = async (page: Page, layout: Layout, user: Seeded) => {
  // The rail shows none of the six buttons, though the deployment offers all of them.
  for (const name of RAIL_BUTTONS) {
    // eslint-disable-next-line no-await-in-loop
    await expect(rail(page).getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await openSettingsPage(page, 'Sidebar');
  for (const name of SWITCHES) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('switch', { name: THREADS_SWITCH })).toHaveCount(0);

  // THREADS starts collapsed; once opened it stays open, after a reload too.
  await expect(threadsCategory(page)).toHaveAttribute('aria-expanded', 'false', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('thread-nav-list')).toHaveCount(0);
  await threadsCategory(page).click();
  await expect(threadsCategory(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByTestId('thread-nav-list').getByText(FIRST_THREAD, { exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(activeAccountButton(page)).toBeVisible({
    timeout: 120_000,
  });
  await expect(threadsCategory(page)).toHaveAttribute('aria-expanded', 'true', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('thread-nav-list')).toBeVisible();

  // Home's options menu lists every hidden button; Canvases waits for a canvas, as its button does.
  await page.getByRole('button', { name: 'Home Options', exact: true }).click();
  for (const entry of ['Threads', 'Explore Community', 'Create Space', 'Search']) {
    // eslint-disable-next-line no-await-in-loop
    await expect.soft(homeMenuEntry(page, entry)).toBeVisible();
  }
  await expect.soft(homeMenuEntry(page, 'Canvases')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await pinCanvas(user);
  await expect(async () => {
    await page.getByRole('button', { name: 'Home Options', exact: true }).click();
    try {
      await expect(homeMenuEntry(page, 'Canvases')).toBeVisible({ timeout: 2_000 });
    } finally {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
  }).toPass({ timeout: 60_000 });
  // Its rail button stays hidden by the switch.
  await expect(rail(page).getByRole('button', { name: 'Canvases', exact: true })).toHaveCount(0);

  await chooseFromHomeMenu(page, 'Threads');
  await expect(page).toHaveURL(/\/threads\/$/);
  await openHome(page);
  await chooseFromHomeMenu(page, 'Canvases');
  await expect(page).toHaveURL(/\/canvases\/$/);
  await expect(page.getByTestId('canvases-view')).toBeVisible();
  await openHome(page);
  await chooseFromHomeMenu(page, 'Explore Community');
  await expect(page).toHaveURL(/\/explore\//);
  await openHome(page);

  // Create Space and Search: Home's options menu, on a desktop and a phone alike.
  const createDialog = page.getByRole('dialog', { name: 'Create Space' });
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await chooseFromHomeMenu(page, 'Create Space');
  await expect(createDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(createDialog).toHaveCount(0);
  await chooseFromHomeMenu(page, 'Search');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox')).toBeFocused();

  // The palette also creates a space; a desktop opens it with its shortcut too.
  if (layout === 'desktop') {
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await pressPaletteShortcut(page);
    await expect(palette).toBeVisible();
  }
  await palette.getByRole('tablist').getByRole('tab', { name: 'Actions', exact: true }).click();
  await palette.getByRole('combobox').fill('Create Space');
  await palette.getByRole('option').filter({ hasText: 'Create Space' }).first().click();
  await expect(createDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(createDialog).toHaveCount(0);

  // Local MindRoom: its Settings page.
  await openSettingsPage(page, 'Local MindRoom');
  await expect(
    page.getByText('Pair this chat account with your local MindRoom process', { exact: true })
  ).toBeVisible();
};

for (const layout of ['desktop', 'phone'] as const) {
  test(`a fresh account's hidden rail pages stay reachable (Chromium, ${layout})`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(360_000);
    const user = await seedAccount(`c${layout[0]}`, { canvas: false });
    const context = await browser.newContext({ ...LAYOUTS[layout], baseURL });
    await routeDeployment(context);
    const page = await context.newPage();
    await signIn(page, user);
    await checkFreshAccount(page, layout, user);
    await context.close();
  });

  test(`a fresh account's hidden rail pages stay reachable (WebKit, ${layout})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(360_000);
    const user = await seedAccount(`w${layout[0]}`, { canvas: false });
    await onWebKitPage({ ...LAYOUTS[layout], baseURL }, async (page) => {
      await routeDeployment(page.context());
      await signIn(page, user);
      await checkFreshAccount(page, layout, user);
    });
  });
}

test('an account that stored its switches keeps them', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const user = await seedAccount('stored', {
    settings: { showThreadsInSidebar: true, showSearchInSidebar: true },
  });
  const context = await browser.newContext({ ...DESKTOP, baseURL });
  await routeDeployment(context);
  const page = await context.newPage();
  await signIn(page, user);
  for (const name of RAIL_BUTTONS) {
    const shown = name === 'Threads' || name === 'Open command palette';
    // eslint-disable-next-line no-await-in-loop
    await expect(rail(page).getByRole('button', { name, exact: true })).toHaveCount(shown ? 1 : 0);
  }
  // Home's menu lists only the pages whose buttons are hidden.
  await page.getByRole('button', { name: 'Home Options', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Canvases', exact: true })).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Explore Community', exact: true })
  ).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Create Space', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Threads', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Search', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await context.close();
});

test('screenshots of a fresh account sidebar', async ({ browser, baseURL }) => {
  test.skip(!SHOTS, 'Set SIDEBAR_DEFAULTS_SHOTS to a directory');
  test.setTimeout(360_000);
  for (const layout of ['desktop', 'phone'] as const) {
    // eslint-disable-next-line no-await-in-loop
    const user = await seedAccount(`s${layout[0]}`, { canvas: false });
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext({ ...LAYOUTS[layout], baseURL, colorScheme: 'light' });
    // eslint-disable-next-line no-await-in-loop
    await routeDeployment(context);
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    // eslint-disable-next-line no-await-in-loop
    await signIn(page, user);
    // eslint-disable-next-line no-await-in-loop
    await page.getByTestId('thread-nav-category').scrollIntoViewIfNeeded({ timeout: 60_000 });
    // The pointer rests on the rail's empty middle, so no row shows its hover.
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(33, (LAYOUTS[layout].viewport?.height ?? 800) / 2);
    // Let the thread index and the rail settle before the picture.
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(3_000);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: `${SHOTS}/fresh-sidebar-${layout}.png` });
    // Home's options menu of an account without a canvas yet.
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: 'Home Options', exact: true }).click();
    // eslint-disable-next-line no-await-in-loop
    await expect(page.getByRole('menu')).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: `${SHOTS}/home-menu-${layout}.png` });
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
});
