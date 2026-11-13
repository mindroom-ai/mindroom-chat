import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A space that holds sub-spaces lists only its own rooms. A Sub-spaces button near the top of its
// room list opens a menu of the sub-spaces (avatar, name, a dot while one has unread messages);
// choosing one opens that sub-space's room list (its lobby beside it on wide screens), and Back
// returns to the parent. A parent with two sub-spaces and rooms at both levels, on a desktop
// (1280 by 800) and a phone (390 by 844, touch), in English and Arabic, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// SUBSPACES_MENU_SHOTS=<directory> for screenshots.
const PASSWORD = 'subspaces-menu-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.SUBSPACES_MENU_SHOTS;
const PARENT = 'Field Notes';
const PARENT_ROOMS = ['Harbor Plans', 'Garden Club', 'Book Swap'];
const DESIGN = 'Design Team';
const DESIGN_ROOMS = ['Design Review', 'Icon Sketches'];
const RESEARCH = 'Research Group';
const RESEARCH_ROOMS = ['Reading List', 'Field Interviews'];
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const register = async (name: string) => {
  const username = `ssm_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

type Seed = { username: string; parent: string; design: string; research: string };
const seeds = new Map<string, Promise<Seed>>();

/** One account per engine: the parent space, two sub-spaces, rooms at both levels. */
const seed = async (engine: string): Promise<Seed> => {
  const viewer = await register(`viewer_${engine}`);
  const peer = await register(`peer_${engine}`);
  const token = viewer.accessToken;
  const space = async (name: string) => createPrivateSpace(HOMESERVER, token, { name, topic: '' });
  const rooms = async (spaceId: string, names: string[], unread?: string) => {
    for (const name of names) {
      const roomId = await createPrivateRoom(HOMESERVER, token, {
        name,
        topic: 'Weekly notes and decisions',
        invite: [peer.userId],
      });
      await addRoomToSpace(HOMESERVER, token, spaceId, roomId);
      if (name === unread) {
        await joinRoom(HOMESERVER, peer.accessToken, roomId);
        await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'The interview notes from Tuesday are up, have a look when you can.',
        });
      }
    }
  };
  const parent = await space(PARENT);
  const design = await space(DESIGN);
  const research = await space(RESEARCH);
  await addRoomToSpace(HOMESERVER, token, parent, design);
  await addRoomToSpace(HOMESERVER, token, parent, research);
  await rooms(parent, PARENT_ROOMS);
  await rooms(design, DESIGN_ROOMS);
  await rooms(research, RESEARCH_ROOMS, 'Reading List');
  await setAccountData(HOMESERVER, token, viewer.userId, 'io.mindroom.spaces', {
    sidebar: [parent],
  });
  return { username: viewer.username, parent, design, research };
};

const signIn = async (
  browser: Browser,
  engine: string,
  options: BrowserContextOptions,
  language?: string
) => {
  if (!seeds.has(engine)) seeds.set(engine, seed(engine));
  const seeded = await seeds.get(engine)!;
  const context = await browser.newContext(options);
  // A missing control fails its step quickly instead of the whole test's timeout.
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  if (language) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  }
  await page.goto('/home/');
  await expect(page.locator(`[data-id="${seeded.parent}"]`).first()).toBeVisible();
  return { context, page, seeded };
};

const escaped = (value: string) => encodeURIComponent(value).replace(/[!$.]/g, '\\$&');
const spacePath = (space: string) => new RegExp(`/${escaped(space)}/?$`);
const lobbyPath = (space: string) => new RegExp(`/${escaped(space)}/lobby/?$`);

const list = (page: Page) => page.getByTestId('resizable-page-nav');
// A row's name also holds its unread count; the rooms' names share no words.
const roomRow = (page: Page, name: string) => list(page).getByRole('link', { name });
const subspacesButton = (page: Page) => list(page).locator('[data-subspaces-menu]');
const menu = (page: Page) => page.getByRole('menu');
const entry = (page: Page, name: string) =>
  menu(page).getByRole('menuitem', { name: new RegExp(name) });

/** The list shows exactly these rooms of the three spaces. */
const expectRooms = async (page: Page, shown: string[]) => {
  for (const name of [...PARENT_ROOMS, ...DESIGN_ROOMS, ...RESEARCH_ROOMS]) {
    if (shown.includes(name)) await expect(roomRow(page, name), name).toBeVisible();
    else await expect(roomRow(page, name), name).toHaveCount(0);
  }
};

const checkDesktop = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP, language);
  await page.locator(`[data-id="${seeded.parent}"]`).first().click();
  await expect(page).toHaveURL(lobbyPath(seeded.parent));
  // The parent lists only its own rooms.
  await expectRooms(page, PARENT_ROOMS);

  await expect(subspacesButton(page)).toHaveAttribute('aria-haspopup', 'menu');
  await subspacesButton(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('menuitem')).toHaveCount(2);
  await expect(menu(page)).toBeInViewport({ ratio: 1 });
  // A sub-space with unread messages shows a dot, and says so to screen readers.
  await expect(entry(page, RESEARCH).locator('[data-unread]')).toHaveCount(1);
  await expect(entry(page, DESIGN).locator('[data-unread]')).toHaveCount(0);
  // An English name reads left to right in Arabic too.
  const name = entry(page, DESIGN).getByText(DESIGN, { exact: true });
  expect(await name.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/subspaces-menu-${engine}-${language ?? 'en'}.png` });
  }

  await entry(page, DESIGN).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page).toHaveURL(lobbyPath(seeded.design));
  await expectRooms(page, DESIGN_ROOMS);
  // Back returns to the parent.
  await list(page)
    .getByRole('button', { name: new RegExp(PARENT) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${escaped(seeded.parent)}/`));
  await expectRooms(page, PARENT_ROOMS);
  await context.close();
};

const checkKeyboard = async (browser: Browser, engine: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP);
  await page.goto(`/${encodeURIComponent(seeded.parent)}/lobby/`);
  await subspacesButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await expect(subspacesButton(page)).toHaveAttribute('aria-expanded', 'true');
  // The first entry takes focus, and the arrow keys move between the entries.
  await expect(entry(page, DESIGN)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(entry(page, RESEARCH)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(entry(page, DESIGN)).toBeFocused();
  // Escape closes the menu and gives focus back to its row.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(subspacesButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(entry(page, DESIGN)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(entry(page, RESEARCH)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(lobbyPath(seeded.research));
  await expectRooms(page, RESEARCH_ROOMS);
  await context.close();
};

const checkPhone = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, PHONE, language);
  await page.locator(`[data-id="${seeded.parent}"]`).first().tap();
  await expect(page).toHaveURL(spacePath(seeded.parent));
  await expectRooms(page, PARENT_ROOMS);
  await subspacesButton(page).tap();
  await expect(menu(page)).toBeInViewport({ ratio: 1 });
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/subspaces-phone-${engine}-${language ?? 'en'}.png` });
  }
  await entry(page, RESEARCH).tap();
  // A phone shows the sub-space's room list.
  await expect(page).toHaveURL(spacePath(seeded.research));
  await expectRooms(page, RESEARCH_ROOMS);
  await list(page)
    .getByRole('button', { name: new RegExp(PARENT) })
    .tap();
  await expect(page).toHaveURL(spacePath(seeded.parent));
  await expectRooms(page, PARENT_ROOMS);
  // The browser's back then leaves the parent's list, not into the sub-space.
  await page.goBack();
  await expect(page).toHaveURL(/\/home\/$/);
  await context.close();
};

const inWebKit = async (check: (browser: Browser, engine: string) => Promise<void>) => {
  const browser = await launchWebKit();
  try {
    await check(browser, 'webkit');
  } finally {
    await browser.close();
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

test('a parent lists its own rooms and opens a sub-space from its menu', async ({ browser }) => {
  await checkDesktop(browser, 'chromium');
});

test('the sub-spaces menu in Arabic', async ({ browser }) => {
  await checkDesktop(browser, 'chromium', 'ar');
});

test('the sub-spaces menu by keyboard', async ({ browser }) => {
  await checkKeyboard(browser, 'chromium');
});

test('on a phone a sub-space opens its list, and back returns to the parent', async ({
  browser,
}) => {
  await checkPhone(browser, 'chromium');
});

test('on a phone in Arabic', async ({ browser }) => {
  await checkPhone(browser, 'chromium', 'ar');
});

test.describe('WebKit', () => {
  test.beforeEach(() => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  });
  test('the menu on a desktop', () => inWebKit((browser) => checkDesktop(browser, 'webkit')));
  test('the menu by keyboard', () => inWebKit((browser) => checkKeyboard(browser, 'webkit')));
  test('the menu on a phone', () => inWebKit((browser) => checkPhone(browser, 'webkit')));
});
