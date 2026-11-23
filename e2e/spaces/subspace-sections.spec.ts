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

// A space lists its own rooms followed by inline collapsible sections for every non-empty joined
// descendant sub-space in pre-order DFS (skipping empty organizer headers while still showing
// their populated descendants). Collapsing a section hides its rooms, persists across reload,
// keeps the currently selected room visible, and shows a compact unread dot while any hidden room
// has unread messages. Clicking a room in any section opens it under the parent space route,
// keyboard room-stepping crosses sections, and visiting a sub-space directly still shows Back to
// the parent. Set SUBSPACES_SECTIONS_SHOTS (or SUBSPACES_MENU_SHOTS) to capture screenshots.
const PASSWORD = 'subspace-sections-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.SUBSPACES_SECTIONS_SHOTS ?? process.env.SUBSPACES_MENU_SHOTS;
const PARENT = 'Field Notes';
const PARENT_ROOMS = ['Book Swap', 'Garden Club', 'Harbor Plans'];
const DESIGN = 'Design Team';
const DESIGN_ROOMS = ['Design Review', 'Icon Sketches'];
const ORGANIZER = 'Operations';
const RESEARCH = 'Research Group';
const RESEARCH_ROOMS = ['Field Interviews', 'Reading List'];
const ALL_ROOMS = [...PARENT_ROOMS, ...DESIGN_ROOMS, ...RESEARCH_ROOMS];
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const register = async (name: string) => {
  const username = `sss_${name}_${RUN}`;
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

type Seed = {
  username: string;
  parent: string;
  design: string;
  organizer: string;
  research: string;
  roomIds: Record<string, string>;
};
const seeds = new Map<string, Promise<Seed>>();

/**
 * One account per engine: Field Notes -> (own rooms, Design Team, empty Operations -> Research
 * Group). Reading List stays unread for unread-dot checks; tests avoid opening it.
 */
const seed = async (engine: string): Promise<Seed> => {
  const viewer = await register(`viewer_${engine}`);
  const peer = await register(`peer_${engine}`);
  const token = viewer.accessToken;
  const roomIds: Record<string, string> = {};
  const space = async (name: string) => createPrivateSpace(HOMESERVER, token, { name, topic: '' });
  const rooms = async (spaceId: string, names: string[], unread?: string) => {
    for (const name of names) {
      const roomId = await createPrivateRoom(HOMESERVER, token, {
        name,
        topic: 'Weekly notes and decisions',
        invite: [peer.userId],
      });
      roomIds[name] = roomId;
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
  const organizer = await space(ORGANIZER);
  const research = await space(RESEARCH);
  await addRoomToSpace(HOMESERVER, token, parent, design);
  await addRoomToSpace(HOMESERVER, token, parent, organizer);
  await addRoomToSpace(HOMESERVER, token, organizer, research);
  await rooms(parent, PARENT_ROOMS);
  await rooms(design, DESIGN_ROOMS);
  await rooms(research, RESEARCH_ROOMS, 'Reading List');
  await setAccountData(HOMESERVER, token, viewer.userId, 'io.mindroom.spaces', {
    sidebar: [parent],
  });
  return { username: viewer.username, parent, design, organizer, research, roomIds };
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
const roomPath = (space: string, roomId: string) =>
  new RegExp(`/${escaped(space)}/${escaped(roomId)}/?$`);

const list = (page: Page) => page.getByTestId('resizable-page-nav');
// A row's name also holds its unread count; the rooms' names share no words.
const roomRow = (page: Page, name: string) => list(page).getByRole('link', { name });
const sectionButton = (page: Page, categoryId: string) =>
  list(page).locator(`[data-category-id="${categoryId}"]`);

/** The list shows exactly these rooms of the seeded hierarchy. */
const expectRooms = async (page: Page, shown: string[]) => {
  for (const name of ALL_ROOMS) {
    if (shown.includes(name)) await expect(roomRow(page, name), name).toBeVisible();
    else await expect(roomRow(page, name), name).toHaveCount(0);
  }
};

const checkDesktop = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP, language);
  const rootId = `${seeded.parent}|room`;
  const designId = `${seeded.parent}|subspace|${seeded.design}`;
  const organizerId = `${seeded.parent}|subspace|${seeded.organizer}`;
  const researchId = `${seeded.parent}|subspace|${seeded.research}`;

  await page.locator(`[data-id="${seeded.parent}"]`).first().click();
  await expect(page).toHaveURL(lobbyPath(seeded.parent));
  await expect(list(page).locator('[data-subspaces-menu]')).toHaveCount(0);

  // Parent Rooms plus populated sub-spaces render inline; the empty organizer header is hidden.
  await expect(sectionButton(page, rootId)).toBeVisible();
  await expect(sectionButton(page, designId)).toBeVisible();
  await expect(sectionButton(page, organizerId)).toHaveCount(0);
  await expect(sectionButton(page, researchId)).toBeVisible();
  await expectRooms(page, ALL_ROOMS);

  // An English sub-space header reads left to right in Arabic too.
  const designText = sectionButton(page, designId).getByText(DESIGN, { exact: true });
  expect(await designText.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/subspace-sections-${engine}-${language ?? 'en'}.png` });
  }

  // Collapsing Research Group hides its rooms and shows the unread dot; Design Team has no unread.
  await sectionButton(page, researchId).click();
  await expect(sectionButton(page, researchId)).toHaveAttribute('aria-expanded', 'false');
  await expect(sectionButton(page, researchId).locator('[data-unread]')).toHaveCount(1);
  await expect(sectionButton(page, researchId)).toHaveAttribute('aria-label', new RegExp(RESEARCH));
  await sectionButton(page, designId).click();
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expect(sectionButton(page, designId).locator('[data-unread]')).toHaveCount(0);
  await expectRooms(page, PARENT_ROOMS);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/subspace-sections-collapsed-${engine}-${language ?? 'en'}.png`,
    });
  }

  // Collapsed state persists across reload.
  await page.reload();
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(sectionButton(page, researchId)).toHaveAttribute('aria-expanded', 'false');
  await expect(sectionButton(page, researchId).locator('[data-unread]')).toHaveCount(1);
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expectRooms(page, PARENT_ROOMS);

  // Opening a room in a sub-space keeps the parent space route; collapsing keeps it visible.
  await sectionButton(page, designId).click();
  await roomRow(page, 'Design Review').click();
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));
  await sectionButton(page, designId).click();
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expectRooms(page, [...PARENT_ROOMS, 'Design Review']);

  // Direct sub-space URL still shows Back to the parent space.
  await page.goto(`/${encodeURIComponent(seeded.design)}/lobby/`);
  await expect(page).toHaveURL(lobbyPath(seeded.design));
  await expectRooms(page, DESIGN_ROOMS);
  await list(page)
    .getByRole('button', { name: new RegExp(PARENT) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${escaped(seeded.parent)}/`));
  await context.close();
};

const checkKeyboard = async (browser: Browser, engine: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP);
  const designId = `${seeded.parent}|subspace|${seeded.design}`;

  await page.goto(`/${encodeURIComponent(seeded.parent)}/lobby/`);
  await expectRooms(page, ALL_ROOMS);
  await roomRow(page, 'Harbor Plans').click();
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Harbor Plans']!));

  // Alt+ArrowDown steps across Rooms -> Design Team -> Research Group (past empty Operations).
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Icon Sketches']!));
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Field Interviews']!));

  // Alt+ArrowUp steps back across the same section boundaries.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Icon Sketches']!));
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Harbor Plans']!));

  // Collapsing Design Team via keyboard makes Alt+ArrowDown skip straight to Research Group.
  await sectionButton(page, designId).focus();
  await page.keyboard.press('Enter');
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Field Interviews']!));
  await context.close();
};

const checkPhone = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, PHONE, language);
  const designId = `${seeded.parent}|subspace|${seeded.design}`;
  const organizerId = `${seeded.parent}|subspace|${seeded.organizer}`;

  await page.locator(`[data-id="${seeded.parent}"]`).first().tap();
  await expect(page).toHaveURL(spacePath(seeded.parent));
  await expect(sectionButton(page, organizerId)).toHaveCount(0);
  await expectRooms(page, ALL_ROOMS);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/subspace-sections-phone-${engine}-${language ?? 'en'}.png`,
    });
  }

  await sectionButton(page, designId).tap();
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expectRooms(page, [...PARENT_ROOMS, ...RESEARCH_ROOMS]);
  await sectionButton(page, designId).tap();
  await expectRooms(page, ALL_ROOMS);

  // Tapping a room inside a sub-space opens it under the parent space route.
  await roomRow(page, 'Design Review').tap();
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));

  // Direct sub-space URL still shows Back to the parent space on a phone.
  await page.goto(`/${encodeURIComponent(seeded.design)}/`);
  await expect(page).toHaveURL(spacePath(seeded.design));
  await expectRooms(page, DESIGN_ROOMS);
  await list(page)
    .getByRole('button', { name: new RegExp(PARENT) })
    .tap();
  await expect(page).toHaveURL(spacePath(seeded.parent));
  await expectRooms(page, ALL_ROOMS);
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

test('a parent shows inline collapsible sub-space sections with persistence and unread dots', async ({
  browser,
}) => {
  await checkDesktop(browser, 'chromium');
});

test('inline sub-space sections in Arabic', async ({ browser }) => {
  await checkDesktop(browser, 'chromium', 'ar');
});

test('keyboard room-stepping crosses inline sub-space sections', async ({ browser }) => {
  await checkKeyboard(browser, 'chromium');
});

test('on a phone sub-space sections collapse inline and back returns to the parent', async ({
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
  test('inline sections on a desktop', () =>
    inWebKit((browser) => checkDesktop(browser, 'webkit')));
  test('keyboard stepping across sections', () =>
    inWebKit((browser) => checkKeyboard(browser, 'webkit')));
  test('inline sections on a phone', () => inWebKit((browser) => checkPhone(browser, 'webkit')));
});
